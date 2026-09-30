'use strict';

// Account routes (all under /api, all behind attachUser).
//
//   GET    /api/me                   account, tier, credits, plan, features
//   PATCH  /api/me                   { name, marketingOptIn }
//   DELETE /api/me                   delete the account and its data
//   GET    /api/me/ledger            credit history
//   GET    /api/projects             list (no plan payloads)
//   POST   /api/projects             { name, survey, planSpec, thumbnail }
//   GET    /api/projects/:id
//   PUT    /api/projects/:id
//   DELETE /api/projects/:id
//   POST   /api/billing/checkout     -> { url }  Stripe Checkout for Pro
//   POST   /api/billing/portal       -> { url }  Stripe customer portal
//   POST   /api/me/devkey            { key } -> Pro for developers (DEV_ACCESS_KEYS)
//   DELETE /api/me/devkey            back to the normal tier

const express = require('express');
const { requireUser } = require('../lib/accounts/auth');
const { loadAccount, requireFeature, featuresFor, PLAN, proSource, openTestingUntil } = require('../lib/accounts/entitlements');
const { getStore } = require('../lib/accounts/store');
const billing = require('../lib/accounts/billing');
const { resumeDeletion } = require('../lib/accounts/lifecycle');

const router = express.Router();
const { MAX_PROJECT_BYTES } = require('../lib/accounts/projectRecords');
const { projectPlanResponse } = require('../lib/accounts/planResponse');
const crypto = require('node:crypto');
const projectView = (req, p) => { const { lastMutation, ...visible } = p; return req.tier === 'pro' ? visible : projectPlanResponse(visible); };
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
router.param('id', (req, res, next, id) => validId(id) ? next() : res.status(400).json({ success: false, message: 'Invalid project identifier.' }));
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

function view(user, tier) {
  const c = user?.credits || { monthly: 0, extra: 0 };
  return {
    user: user ? { uid: user.uid, email: user.email, name: user.name || '', createdAt: user.createdAt, marketingOptIn: Boolean(user.marketingOptIn) } : null,
    tier,
    features: featuresFor(tier),
    credits: { monthly: c.monthly, extra: c.extra, total: c.monthly + c.extra },
    plan: { ...PLAN, status: user?.subscription?.status || null, renewsAt: user?.subscription?.currentPeriodEnd || null, cancelAtPeriodEnd: Boolean(user?.subscription?.cancelAtPeriodEnd), developer: Boolean(user?.devAccess),
      testing: proSource(user) === 'testing' },
    // Open testing, told to everyone (signed out too), so the site can say a new account has Pro's features.
    openTesting: openTestingUntil() ? { until: openTestingUntil() } : null,
  };
}

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  const code = e.code || 'ERROR';
  if (code === 'ACCOUNT_DELETING') return res.status(409).json({ success: false, code, message: e.message });
  if (code === 'CANCEL_PLAN_FIRST') return res.status(409).json({ success: false, code, message: e.message });
  if (code === 'PROJECT_DELETED') return res.status(409).json({ success: false, code, message: e.message });
  if (code === 'PROJECT_CONFLICT') return res.status(409).json({ success: false, code, message: e.message });
  if (code === 'PROJECT_TOO_LARGE') return res.status(413).json({ success: false, code, message: e.message });
  if (code === 'PROJECT_CORRUPT') return res.status(503).json({ success: false, code, message: e.message });
  if (code === 'BILLING_NOT_CONFIGURED') return res.status(503).json({ success: false, code, message: 'Payments are not switched on yet.' });
  if (code === 'NO_BILLING_ACCOUNT') return res.status(409).json({ success: false, code, message: 'There is no billing account yet.' });
  console.error('[account]', req.method, req.path, e);
  return res.status(500).json({ success: false, message: 'Something went wrong. Try again.' });
});

router.get('/me', wrap(async (req, res) => {
  const deletion = req.user ? await getStore().getDeletion(req.user.uid) : null;
  if (deletion) return res.json({ success: true, ...view(null, 'anonymous'), deletion: { state: deletion.state, retryRequired: deletion.state !== 'complete' } });
  const user = await loadAccount(req);
  res.json({ success: true, ...view(user, req.tier) });
}));

router.patch('/me', requireUser, wrap(async (req, res) => {
  await loadAccount(req);
  const patch = {};
  if (req.body?.name !== undefined) patch.name = clean(req.body.name, 80);
  if (req.body?.marketingOptIn !== undefined) patch.marketingOptIn = Boolean(req.body.marketingOptIn);
  const user = await getStore().updateUser(req.user.uid, patch);
  res.json({ success: true, ...view(user, req.tier) });
}));

router.delete('/me', requireUser, wrap(async (req, res) => {
  const store = getStore();
  await store.beginDeletion(req.user.uid);
  const job = await resumeDeletion(store, req.user.uid, req.app.locals.deleteIdentity, req.app.locals.cleanupRenders);
  const complete = job.state === 'complete';
  res.status(complete ? 200 : 202).json({ success: true, deletion: { state: job.state, retryRequired: !complete },
    message: complete ? 'Your account has been deleted.' : 'Deletion is pending. New changes are blocked. Retry to finish removing your account.' });
}));

// Developer key: a signed-in account enters one of DEV_ACCESS_KEYS and gets
// Pro with a monthly photoreal allowance, no payment. For the team while
// testing; switched off when the variable is empty. Attempts are throttled.
const devAttempts = new Map(); // uid -> [timestamps]
function devKeyMatches(key) {
  const keys = String(process.env.DEV_ACCESS_KEYS || '').split(',').map((k) => k.trim()).filter((k) => k.length >= 8);
  const given = Buffer.from(String(key || '').trim());
  return keys.some((k) => { const b = Buffer.from(k); return b.length === given.length && crypto.timingSafeEqual(b, given); });
}
router.post('/me/devkey', requireUser, wrap(async (req, res) => {
  if (!String(process.env.DEV_ACCESS_KEYS || '').trim()) return res.status(404).json({ success: false, message: 'Developer keys are switched off.' });
  const now = Date.now();
  const recent = (devAttempts.get(req.user.uid) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 5) return res.status(429).json({ success: false, message: 'Too many attempts. Wait a minute and try again.' });
  devAttempts.set(req.user.uid, [...recent, now]);
  const user = await loadAccount(req);
  if (!devKeyMatches(req.body?.key)) return res.status(403).json({ success: false, code: 'BAD_KEY', message: 'That developer key is not valid.' });
  const store = getStore();
  if (!user.devAccess) {
    await store.updateUser(req.user.uid, { devAccess: { grantedAt: new Date().toISOString() } });
  }
  // One allowance per UTC calendar month. Re-entering/removing the key cannot
  // refill spent credits, and a developer grant cannot reset a paid allowance.
  const date = new Date(), start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
  const period = { id: `developer:${start}`, start, end, source: 'developer' };
  await store.credit(req.user.uid, { kind: 'reset_monthly', amount: PLAN.photorealPerMonth, period }, 'admin', period.id);
  req.account = undefined;
  const fresh = await loadAccount(req);
  res.json({ success: true, ...view(fresh, req.tier) });
}));

router.delete('/me/devkey', requireUser, wrap(async (req, res) => {
  await loadAccount(req);
  await getStore().updateUser(req.user.uid, { devAccess: null });
  req.account = undefined;
  const fresh = await loadAccount(req);
  res.json({ success: true, ...view(fresh, req.tier) });
}));

router.get('/me/ledger', requireUser, wrap(async (req, res) => {
  await loadAccount(req);
  res.json({ success: true, entries: await getStore().listLedger(req.user.uid) });
}));

router.get('/projects', requireFeature('saveProjects'), wrap(async (req, res) => {
  res.json({ success: true, projects: await getStore().listProjects(req.user.uid) });
}));

function projectBody(req) {
  const b = req.body || {};
  const data = {};
  for (const key of ['survey', 'planSpec', 'studioState']) {
    if (b[key] !== undefined && (b[key] === null || typeof b[key] !== 'object' || Array.isArray(b[key]))) throw new Error('invalid project field');
  }
  if (b.studioState !== undefined) data.studioState = b.studioState;
  if (b.name !== undefined) data.name = clean(b.name, 100) || 'Untitled house';
  if (b.survey !== undefined) data.survey = b.survey;
  if (b.planSpec !== undefined) data.planSpec = b.planSpec;
  if (b.thumbnail !== undefined) data.thumbnail = typeof b.thumbnail === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(b.thumbnail) ? (b.thumbnail.length <= 300_000 ? b.thumbnail : null) : null;
  if (b.summary !== undefined) data.summary = clean(b.summary, 200);
  if (b.svg !== undefined) {
    if (typeof b.svg !== 'string') throw new Error('invalid drawing');
    data.svg = b.svg; // bounded by the complete project byte limit, never silently dropped
  }
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_PROJECT_BYTES) throw Object.assign(new Error('too big'), { code: 'TOO_BIG' });
  return data;
}

function mutation(req, res, update = false) {
  const b = req.body || {};
  if (b.mutationId !== undefined && !validId(b.mutationId)) {
    res.status(400).json({ success: false, message: 'Invalid save identifier.' }); return null;
  }
  if (update && (!Number.isSafeInteger(b.revision) || b.revision < 0)) {
    res.status(428).json({ success: false, code: 'REVISION_REQUIRED', message: 'Reopen this house before saving changes.' }); return null;
  }
  return { expectedRevision: update ? b.revision : 0, mutationId: b.mutationId || crypto.randomUUID() };
}

router.post('/projects', requireFeature('saveProjects'), wrap(async (req, res) => {
  const options = mutation(req, res); if (!options) return;
  let data;
  try { data = projectBody(req); } catch { return res.status(413).json({ success: false, message: 'This project is too large or has invalid fields. Your local draft has been kept.' }); }
  const p = await getStore().saveProject(req.user.uid, null, { name: 'Untitled house', ...data }, options);
  res.status(201).json({ success: true, project: projectView(req, p) });
}));

router.get('/projects/:id', requireFeature('saveProjects'), wrap(async (req, res) => {
  const p = await getStore().getProject(req.user.uid, req.params.id);
  if (!p) return res.status(404).json({ success: false, message: 'Project not found.' });
  res.json({ success: true, project: projectView(req, p) });
}));

router.put('/projects/:id', requireFeature('saveProjects'), wrap(async (req, res) => {
  const options = mutation(req, res, true); if (!options) return;
  let data;
  try { data = projectBody(req); } catch { return res.status(413).json({ success: false, message: 'This project is too large or has invalid fields. Your local draft has been kept.' }); }
  const p = await getStore().saveProject(req.user.uid, req.params.id, data, options);
  if (!p) return res.status(404).json({ success: false, message: 'Project not found. Your local draft has been kept.' });
  res.json({ success: true, project: projectView(req, p) });
}));

router.delete('/projects/:id', requireFeature('saveProjects'), wrap(async (req, res) => {
  const options = mutation(req, res, true); if (!options) return;
  const ok = await getStore().deleteProject(req.user.uid, req.params.id, options.expectedRevision);
  res.status(ok ? 200 : 404).json({ success: ok });
}));

router.post('/billing/checkout', requireUser, wrap(async (req, res) => {
  const user = await loadAccount(req);
  if (req.tier === 'pro') return res.status(409).json({ success: false, code: 'ALREADY_PRO', message: 'You already have Keystone AI Pro.' });
  res.json({ success: true, url: await billing.createCheckout(user) });
}));

router.post('/billing/portal', requireUser, wrap(async (req, res) => {
  const user = await loadAccount(req);
  res.json({ success: true, url: await billing.createPortal(user) });
}));

module.exports = router;
