'use strict';
const { loadAccount } = require('./entitlements');
// Project every nested option without mutating generator or gallery state.
function projectPlanResponse(value) {
  if (Array.isArray(value)) return value.map(projectPlanResponse);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === 'elevations') return [key, child?.meta ? { meta: projectPlanResponse(child.meta) } : null];
    return [key, projectPlanResponse(child)];
  }));
}
async function planResponse(req, res, next) {
  try {
    await loadAccount(req);
    if (req.tier !== 'pro') {
      const json = res.json.bind(res);
      res.json = body => json(body && body.success !== false
        ? { ...projectPlanResponse(body), elevationsLocked: true } : body);
    }
    next();
  } catch {
    res.status(503).json({ success: false, code: 'ACCOUNTS_UNAVAILABLE', message: 'Account access could not be checked. Try again.' });
  }
}
module.exports = { planResponse, projectPlanResponse };
