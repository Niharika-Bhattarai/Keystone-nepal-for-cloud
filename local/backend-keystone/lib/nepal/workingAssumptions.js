'use strict';
// Local concept workflow assumptions. These are not adopted municipal values.
const DEFAULT_SETBACK_MM=1000;
const WORKING_COVERAGE_LIMIT=0.70; // Owner-supplied preliminary limit.
function deriveConceptAssumptions(brief){
  const boundaries=brief.site.boundaries||[];
  const setbacksMm=Array.from({length:4},(_,i)=>
    boundaries[i]?.proposedSetbackMm??DEFAULT_SETBACK_MM);
  return {setbacksMm,coverageLimit:WORKING_COVERAGE_LIMIT,
    source:{setbacks:'1,000 mm geometric working default unless the survey proposes an explicit edge setback',
      coverage:'owner-supplied 70% preliminary maximum, not independently adopted for this parcel'},
    legalStatus:'working_assumptions_pending_parcel_review'};
}
module.exports={DEFAULT_SETBACK_MM,WORKING_COVERAGE_LIMIT,deriveConceptAssumptions};
