'use strict';

// Fixed-window, in-memory rate limiter. Per Cloud Run instance, so the real
// ceiling is limit x instances; set --max-instances to bound it. Kept
// dependency-free on purpose.

function clientKey(req) {
  // Trust the configured Express boundary, never arbitrary client XFF headers.
  if (req.user?.uid) return `user:${req.user.uid}`;
  // Behind the Vercel address every visitor reaches Cloud Run from Vercel's egress,
  // so the preview app names the header Vercel sets to the visitor's address
  // (app.locals.edgeClientHeader). Someone calling the run.app address directly can
  // set it too, which only moves them to another anonymous bucket: this is a
  // fairness limit, and --max-instances bounds the cost.
  const header = req.app?.locals?.edgeClientHeader;
  const edge = header && typeof req.get === 'function' ? String(req.get(header) || '').split(',')[0].trim() : '';
  return (edge && edge.length <= 64 ? `edge:${edge}` : '') || req.ip || req.socket?.remoteAddress || 'unknown';
}

function rateLimit({ windowMs = 60_000, max = 30, name = 'default', message = 'Too many requests. Wait a minute and try again.' } = {}) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  sweep.unref?.();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = `${name}:${clientKey(req)}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.resetAt - now) / 1000)));
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, message });
    }
    return next();
  };
}

module.exports = { rateLimit, clientKey };
