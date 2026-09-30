'use strict';

// Concrete implementation gaps demonstrated by retained generated models.
// These are not claims of architectural impossibility and apply to both
// candidate producers: legacy must not silently discard the same selection.
function surveyCapabilityGaps(survey={}) {
  const gaps=[];
  const add=(field,message)=>gaps.push({code:'CAPABILITY_NOT_IMPLEMENTED',field,message});
  if(/basement/i.test(String(survey.foundationType||survey.foundation||''))) add('foundationType',
    'The generator does not yet model basement rooms, their stairs and egress. Your basement selection has been retained; an above-grade-only plan would not fulfill it.');
  if(/wheelchair/i.test(String(survey.accessibilityNeeds||''))) add('accessibilityNeeds',
    'The generator does not yet verify wheelchair routes, turning spaces and fixture access. Wide door openings alone do not fulfill this selection.');
  if(/cathedral|vaulted/i.test(String(survey.ceilingHeight||''))) add('ceilingHeight',
    'The generator does not yet model vaulted ceiling surfaces and their stair headroom. A taller flat ceiling would not fulfill this selection.');
  return gaps;
}
function capabilityFailurePayload(survey) {
  const blockers=surveyCapabilityGaps(survey);
  if(!blockers.length) return null;
  return {success:false,complete:false,code:'CAPABILITY_NOT_IMPLEMENTED',message:blockers[0].message,
    diagnostics:{classification:'implementation_gap',blockers,triedCandidateCount:0,
      scope:'Requested capabilities are not implemented; no physical infeasibility has been established.'}};
}
module.exports={surveyCapabilityGaps,capabilityFailurePayload};
