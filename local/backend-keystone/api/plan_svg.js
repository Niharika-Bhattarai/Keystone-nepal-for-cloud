'use strict';

const { enrichPlanSpec } = require('../lib/buildingModel');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { placeOpenings } = require('../lib/placeOpenings');
const { renderPlanSvg } = require('../lib/renderPlanSvg');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { sanitizePlanInput } = require('../lib/sanitizePlanInput');

module.exports = function planSvgHandler(req, res) {
  const { surveyData = {} } = req.body || {};
  const planSpec = sanitizePlanInput(req.body?.planSpec);
  if (!planSpec) return res.status(400).json({ success: false, error: 'planSpec required' });
  try {
    const updated = enrichPlanSpec(placeOpenings(structuredClone(planSpec), surveyData), {
      brief: normalizeBrief(surveyData),
      footprint: planSpec.buildingModel?.footprint || {},
      archetype: planSpec.archetype || null,
      surveyData,
    });
    const errors = validateEditedPlan(updated, surveyData);
    if (errors.length) return res.status(422).json({
      success: false, error: 'The edit does not produce a valid layout.',
      diagnostics: { validationErrors: errors },
    });
    return res.json({ success: true, svg: renderPlanSvg(updated), planSpec: updated });
  } catch (error) {
    console.error('[plan/svg]', error);
    return res.status(422).json({ success: false, error: 'The edited plan could not be drawn.' });
  }
};
