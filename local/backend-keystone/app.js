'use strict';
const express = require('express');
const compression = require('compression');
const path = require('node:path');
const { securityHeaders } = require('./lib/securityHeaders');
const { rateLimit } = require('./lib/rateLimit');
const { attachUser } = require('./lib/accounts/auth');
const { requireFeature } = require('./lib/accounts/entitlements');
const { planResponse } = require('./lib/accounts/planResponse');
const { getBuildInfo } = require('./lib/buildInfo');

// `render` (optional) wires owned photoreal renders: { jobs, artifacts, urls,
// dispatcher, deleteIdentity, forceOptions }. Without it every render route
// stays unavailable, as before C4c.
function createApp({ handlers = {}, frontendDir = path.resolve(__dirname, '../frontend-keystone/dist'), render = null, runtimeMode = 'local' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (runtimeMode === 'preview') {
    // Cloud Run's front end is the one proxy in front of the container: req.ip is then
    // the address it saw, not the front end's own (one shared address for every
    // visitor, which put all anonymous visitors under one rate limit).
    app.set('trust proxy', 1);
    app.locals.edgeClientHeader = 'x-vercel-forwarded-for';
  }
  app.use(securityHeaders);
  // Cloud Run does not compress responses (Vercel did): without this the site's
  // scripts and the plan SVGs go out at full size (C7 measured 1.8 MB per page).
  app.use(compression());
  app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const limitGenerate = rateLimit({ name: 'generate', max: 12 });
  const limitDraw = rateLimit({ name: 'draw', max: 60 });
  const limitPaid = rateLimit({ name: 'paid', max: 20 });
  const unavailable = (req, res) => res.status(503).json({ success: false,
    code: 'CONVERSION_NOT_READY', message: 'This part of Keystone AI is not available in this preview yet.' });
  // Raw-body boundary retained for later retry-safe Stripe integration.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), unavailable);
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', attachUser);
  app.get(['/health', '/api/health'], (req, res) => res.json({ ok: true, ...getBuildInfo(),
    application: 'keystone-conversion', runtime: runtimeMode, externalServicesEnabled: runtimeMode === 'preview', automaticRepair: 'off', photoreal: render ? render.mode || 'on' : 'off' }));
  const handler = (name, file) => handlers[name] || require(file);
  app.post('/api/plan', limitGenerate, planResponse, handler('plan', './api/plan'));
  app.post('/api/plan/preflight', limitGenerate, handler('preflight', './api/plan_preflight'));
  if(runtimeMode==='local')app.post('/api/nepal/concepts',limitGenerate,require('./api/nepal_concepts'));
  app.post('/api/plan/presentation', limitDraw, planResponse, handler('presentation', './api/plan_presentation'));
  app.post('/api/plan/svg', limitDraw, planResponse, handler('svg', './api/plan_svg'));
  app.post('/api/plan/model', limitDraw, requireFeature('quick3d'), handler('model', './api/plan_model'));
  app.post('/api/plan/dxf', limitPaid, requireFeature('downloads'), handler('dxf', './api/plan_dxf'));
  app.post('/api/plan/refine', limitPaid, requireFeature('refine'), handler('refine', './api/refine'));
  app.post('/api/plan/edit', limitDraw, requireFeature('edit'), handler('edit', './api/plan_edit'));
  app.post('/api/estimate', limitPaid, requireFeature('estimate'), require('./api/estimate'));
  app.post('/api/estimate/xlsx', limitPaid, requireFeature('estimate'), handler('estimate', './api/estimate_xlsx'));
  app.post('/api/render', limitPaid, requireFeature('render'), unavailable);
  // The unowned legacy HQ route is retired; owned renders live under /api/renders.
  app.use('/api/plan/model/hq', limitPaid, requireFeature('photoreal'), unavailable);
  if (render) {
    if (render.mode === 'paused') app.post('/api/renders', (req, res) => res.status(503).json({ success: false, code: 'PHOTOREAL_PAUSED',
      message: 'Photoreal houses are coming soon. Your 3D model is ready to explore in the meantime.' }));
    app.post('/api/renders', limitPaid);
    app.use('/api/renders', limitDraw, require('./api/renders').rendersRouter(render));
    app.locals.cleanupRenders = uid => render.jobs.cleanupOwner(uid, render.artifacts);
    if (render.deleteIdentity) app.locals.deleteIdentity = render.deleteIdentity;
  } else app.use('/api/renders', limitPaid, requireFeature('photoreal'), unavailable);
  app.use('/api/billing', limitPaid, unavailable);
  app.use('/api/me', limitDraw);
  app.use('/api/projects', limitDraw);
  app.use('/api', require('./api/account'));
  app.post('/api/verify', (req, res) => res.status(410).json({ success: false, code: 'PASSKEYS_RETIRED', message: 'Sign in to Keystone AI.' }));
  // Account conversion does not expose a public gallery or training writes.
  app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Not found.' }));
  app.use(express.static(frontendDir));
  app.get(['/', '/case-study', '/how-floor-plans-work', '/b2b-workflow', '/roadmap', '/pricing',
    '/faq', '/privacy', '/terms', '/account', '/signin'], (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    res.status(status).json({ success: false, message: status === 413 ? 'Request is too large.' : status === 400 ? 'Invalid JSON request.' : 'The request could not be completed.' });
  });
  return app;
}
module.exports = { createApp };
