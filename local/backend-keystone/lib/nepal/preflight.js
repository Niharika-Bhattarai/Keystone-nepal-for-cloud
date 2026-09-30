'use strict';
const { normalizeBrief } = require('./normalizeBrief');
const { resolveRulePack } = require('./rules/resolveRulePack');
function isNepalSurvey(survey) { return Boolean(survey && typeof survey === 'object' &&
  (survey.jurisdiction?.country === 'NP' || survey.country === 'NP' ||
    (survey.site && survey.buildingProgram))); }
function preflightNepal(survey) {
  const result = normalizeBrief(survey);
  const blockers = [...result.missing, ...result.invalid, ...result.unsupported];
  const contractReady = !blockers.length;
  const rulePack = contractReady ? resolveRulePack(result.brief) : null;
  const classification = result.missing.length ? 'missing_information' :
    result.invalid.length ? 'infeasible_input' : result.unsupported.length ? 'unsupported' : 'unsupported';
  if (contractReady) blockers.push(...rulePack.blockers.map(b => ({...b,field:'jurisdiction.municipality'})));
  if (contractReady) blockers.push({ code: 'NEPAL_GENERATOR_PENDING', field: 'jurisdiction',
    message: 'Nepal site, structural and Vaastu generation is still being built. The survey is complete, but a trustworthy Nepal plan cannot be generated yet.' });
  return { supported: false, contractReady,
    classification, code: blockers[0].code, blockers, normalizedBrief: result.brief,
    message: blockers[0].message, generationAvailable: false,rulePackVersion:rulePack?.version||null };
}
module.exports = { isNepalSurvey, preflightNepal };
