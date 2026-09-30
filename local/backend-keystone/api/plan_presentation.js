'use strict';
const { renderPlanSvg } = require('../lib/renderPlanSvg');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { checkEditedPlan } = require('../lib/planEdit/editChecks');
const { renderElevationPresentations } = require('../lib/renderedElevationStyles');
const { sanitizePlanInput } = require('../lib/sanitizePlanInput');

module.exports = function planPresentationHandler(req, res) {
  const { surveyData = {} } = req.body || {};
  const planSpec = sanitizePlanInput(req.body?.planSpec);
  if (!planSpec || !Array.isArray(planSpec.levels) || !planSpec.levels.length) {
    return res.status(400).json({ success: false, message: 'A generated floor plan is required.' });
  }
  try {
    // A plan edited by hand in the Studio was checked as it was edited; the
    // warnings it kept are the person's call (lib/planEdit). Only what no edit
    // may pass, a stair that no longer works, holds its presentation back.
    const errors = planSpec.edited
      ? checkEditedPlan(planSpec, surveyData).filter((i) => i.severity === 'block').map((i) => i.message)
      : validateEditedPlan(planSpec, surveyData);
    if (errors.length) return res.status(422).json({ success: false, message: 'This plan needs validation before presentation.', diagnostics: errors });
    // Presentation only: never regenerate or enrich (which could reposition objects).
    return res.json({ success: true, svg: renderPlanSvg(planSpec, { style: 'rendered' }), elevations: renderElevationPresentations(planSpec, surveyData) });
  } catch (error) {
    console.error('[plan/presentation]', error);
    return res.status(422).json({ success: false, message: 'Unable to prepare rendered views.' });
  }
};
