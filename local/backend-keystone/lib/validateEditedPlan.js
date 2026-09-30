'use strict';

const { normalizeBrief } = require('./tile/normalizeBrief');
const { validatePlanSpec } = require('./validatePlan');
const { validateConnectivity } = require('./validateConnectivity');
const { validateArchitectPlanV2 } = require('./residential/v2/validateArchitectPlanV2');
const { validateSurveyRequirements } = require('./surveyRequirements');
const { validatePlanStairAssemblies } = require('./stairs/validatePlanStairAssemblies');
const {surveyCapabilityGaps}=require('./surveyCapabilities');

// Run after openings and building metadata have been regenerated. A better
// quality score cannot make an invalid edit acceptable.
function validateEditedPlan(planSpec, surveyData = {}) {
  const brief = normalizeBrief(surveyData);
  return [...new Set([
    ...surveyCapabilityGaps(surveyData).map(gap=>`Survey capability (${gap.field}): ${gap.message}`),
    ...validatePlanStairAssemblies(planSpec),
    ...validatePlanSpec(planSpec, surveyData, brief),
    ...validateConnectivity(planSpec, surveyData),
    ...validateSurveyRequirements(planSpec, brief),
    ...(planSpec.generatorId === 'architect_v2'
      ? validateArchitectPlanV2(planSpec, brief).errors : []),
  ])];
}

module.exports = { validateEditedPlan };
