'use strict';

// What each kind of visitor may do (owner decision, 2026-09-26).
//
//   anonymous - survey and floor plan, view only
//   free      - + saved projects, quick 3D walkthrough (watermarked),
//               hand edits in the Studio's edit mode (no language model)
//   pro       - $49/month: + elevations, renders, refinements, estimate,
//               downloads, and 3 photoreal houses a month
//
// While OPEN_PRO_UNTIL is set (open testing), signed-in accounts have Pro's
// features without its photoreal houses; see openTestingUntil below.
//
// The server enforces these; the frontend only mirrors them.

const { getStore } = require('./store');
const { localStudio } = require('../nepal/localAccess');

const FEATURES = {
  plan: ['anonymous', 'free', 'pro'],
  saveProjects: ['free', 'pro'],
  quick3d: ['free', 'pro'],
  edit: ['free', 'pro'],
  elevations: ['pro'],
  render: ['pro'],
  refine: ['pro'],
  estimate: ['pro'],
  downloads: ['pro'],
  photoreal: ['pro'],
};
const PLAN = { name: 'Keystone AI Pro', priceUsd: 49, interval: 'month', photorealPerMonth: 3 };
const ACTIVE = new Set(['active', 'trialing']);

// Open testing (owner, 2026-09-29): until OPEN_PRO_UNTIL, every signed-in
// account with an email has Pro's features, free. A date on its own lasts to
// the end of that day (UTC). It grants no photoreal credits, so it never
// spends on renders; remove the variable, or let the date pass, to end it.
function openTestingUntil() {
  const raw = String(process.env.OPEN_PRO_UNTIL || '').trim();
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59Z` : raw);
  return Number.isFinite(t) && t > Date.now() ? new Date(t).toISOString() : null;
}

function paidPro(user) {
  const sub = user?.subscription;
  return sub?.verified === true && sub.approved === true && sub.priceId === process.env.STRIPE_PRICE_PRO &&
    ACTIVE.has(sub.status) && Date.parse(sub.currentPeriodEnd) > Date.now();
}

/** How an account has Pro: 'developer', 'paid', 'testing', or null. */
function proSource(user) {
  if (!user) return null;
  if (user.devAccess) return 'developer'; // developer key (DEV_ACCESS_KEYS), for the team while testing
  if (paidPro(user)) return 'paid';
  if (String(user.email || '').includes('@') && openTestingUntil()) return 'testing';
  return null;
}

function tierOf(user) {
  if (!user) return 'anonymous';
  if (localStudio()) return 'pro';
  return proSource(user) ? 'pro' : 'free';
}

function featuresFor(tier) {
  if (localStudio()) return Object.fromEntries(Object.keys(FEATURES).map(k => [k, !['photoreal', 'render'].includes(k)]));
  return Object.fromEntries(Object.entries(FEATURES).map(([k, tiers]) => [k, tiers.includes(tier)]));
}

// Loads the account (creating it on first sight) and its tier onto the request.
async function loadAccount(req) {
  if (req.account !== undefined) return req.account;
  if (!req.user) { req.account = null; req.tier = 'anonymous'; return null; }
  const store = getStore();
  req.account = await store.ensureUser(req.user.uid, req.user.email);
  req.tier = tierOf(req.account);
  return req.account;
}

function requireFeature(feature) {
  return async (req, res, next) => {
    try {
      await loadAccount(req);
    } catch (e) {
      if (e.code === 'ACCOUNT_DELETING') return res.status(409).json({ success: false, code: e.code, message: e.message });
      console.error('[accounts] load failed', e.message);
      return res.status(503).json({ success: false, message: 'Accounts are unavailable right now.' });
    }
    if (localStudio() && featuresFor(req.tier)[feature]) return next();
    if (!localStudio() && FEATURES[feature]?.includes(req.tier)) return next();
    const code = req.tier === 'anonymous' ? 'SIGN_IN_REQUIRED' : 'UPGRADE_REQUIRED';
    return res.status(req.tier === 'anonymous' ? 401 : 402).json({
      success: false, code, feature,
      message: req.tier === 'anonymous' ? 'Create a free account to use this.' : `This is part of ${PLAN.name}.`,
    });
  };
}

// Plan responses for anyone below Pro keep the elevations' meta block (roof
// style, facing: the 3D model needs it) and drop the drawings.
function withoutElevationDrawings(obj) {
  if (!obj || typeof obj !== 'object' || !obj.elevations) return obj;
  const { meta } = obj.elevations;
  return { ...obj, elevations: meta ? { meta } : undefined };
}

module.exports = { FEATURES, PLAN, tierOf, proSource, openTestingUntil, featuresFor, loadAccount, requireFeature, withoutElevationDrawings };
