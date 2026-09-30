'use strict';

// No support-matrix result is evidence of architectural impossibility.
function classifyGenerationResult({ status, body = {}, options = 0, valid = false, threeDistinct = false }) {
  const code = body.code || body.error?.code;
  if (options && !valid) return 'invalid_delivery';
  if (valid) return threeDistinct ? 'three_valid_distinct_options' : 'option_shortfall';
  if (code === 'BRIEF_INVALID') return 'invalid_input';
  if (code === 'BRIEF_AMBIGUOUS') return 'ambiguous_input';
  if (code === 'PROGRAM_CONFLICT') return 'program_conflict';
  if (code === 'SURVEY_VERSION_NOT_IMPLEMENTED') return 'implementation_gap';
  if (code === 'CAPABILITY_NOT_IMPLEMENTED') return 'implementation_gap';
  if (status >= 500) return 'server_error';
  if (code === 'V2_FALLBACK_DISABLED') return Number(body.diagnostics?.triedCandidateCount) > 0 ? 'search_exhausted' : 'implementation_gap';
  if (code === 'AREA_TOO_SMALL') return 'implementation_gap';
  if (code === 'NO_VALID_LAYOUT') return 'search_exhausted';
  return 'unresolved';
}
function summarizeCoverage(results) {
  const subset = predicate => {
    const rows = results.filter(predicate);
    return { total: rows.length, valid: rows.filter(r => r.valid).length,
      threeDistinct: rows.filter(r => r.valid && r.threeDistinct).length };
  };
  return {
    all: subset(() => true),
    declaredEligible: subset(r => r.preflight?.supported === true),
    knownFeasibleByWitness: subset(r => r.valid || r.historical?.valid === true),
    provenConflict: subset(r => r.classification === 'program_conflict'),
    unresolved: subset(r => !r.valid && !['program_conflict', 'invalid_input', 'ambiguous_input'].includes(r.classification)),
    outcomes: results.reduce((counts, r) => { counts[r.classification] = (counts[r.classification] || 0) + 1; return counts; }, {}),
    correctedDiversity: { metricVersion:require('./residential/v2/diversityMetricV2').METRIC_VERSION, evaluated:results.filter(r=>r.diversityComparison).length,
      threeDistinct:results.filter(r=>r.valid && r.threeDistinctV2).length,
      note:'Measurement comparison only; historical threeDistinct numerator retains v1.' },
    surveyEvidence:{deliveredSetsEvaluated:results.filter(r=>r.fulfillment?.length).length,
      allFieldsVerified:results.filter(r=>r.valid&&r.allFieldsVerified).length,
      note:'Independent incremental field evidence; unimplemented evaluators are unresolved. Historical concept validity is retained separately.'},
    qualityGate: 'current-validator-only; expanded architectural quality gate remains pending',
  };
}
module.exports = { classifyGenerationResult, summarizeCoverage };
