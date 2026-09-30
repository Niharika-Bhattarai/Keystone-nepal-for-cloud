'use strict';

// One Content-Security-Policy for the site. This Express app serves every page,
// including through the Vercel address (frontend-keystone/vercel.json passes all
// paths through and adds no policy of its own; test/security-hotfix.test.js).
//
// 'unsafe-inline' is allowed for styles only: React style={{}} props become
// style attributes. Scripts are same-origin only, which is what blocks an
// injected <img onerror> or <script> in a rendered plan from running.
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; form-action 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

const HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Frame-Options': 'DENY',
};

function securityHeaders(req, res, next) {
  for (const [name, value] of Object.entries(HEADERS)) res.setHeader(name, value);
  next();
}

module.exports = { CSP, HEADERS, securityHeaders };
