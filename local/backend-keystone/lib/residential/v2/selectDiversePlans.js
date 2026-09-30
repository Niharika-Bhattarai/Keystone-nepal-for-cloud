'use strict';

const { checkPairDiversity } = require('./variationDiversityValidator');
const { checkPairDiversityV2, METRIC_VERSION } = require('./diversityMetricV2');

// Find a pairwise-compatible set, rather than letting one greedy pick exclude
// two better alternatives. Rank order breaks ties deterministically.
function selectDiversePlans(ranked, maximum = 4, { metricVersion = 'legacy' } = {}) {
  if (!['legacy', METRIC_VERSION].includes(metricVersion)) throw new Error(`Unknown diversity metric: ${metricVersion}`);
  const checkPair = metricVersion === METRIC_VERSION ? checkPairDiversityV2 : checkPairDiversity;
  maximum = Math.max(1, Math.min(4, maximum));
  const candidates = ranked.slice(0, 72);
  const payloads = candidates.map(c => ({ ...c.planSpec, footprint:c.footprint }));
  const pairs = new Map();
  const compatible = (a,b) => {
    const key = `${Math.min(a,b)}:${Math.max(a,b)}`;
    if (!pairs.has(key)) pairs.set(key, checkPair(payloads[a],payloads[b]));
    return pairs.get(key).valid;
  };
  function find(chosen, remaining, target) {
    if (chosen.length === target) return chosen;
    if (chosen.length + remaining.length < target) return null;
    for (let p=0;p<remaining.length;p++) {
      if (chosen.length + remaining.length-p < target) break;
      const index = remaining[p];
      const next = remaining.slice(p+1).filter(j => compatible(index,j));
      const found = find([...chosen,index],next,target);
      if (found) return found;
    }
    return null;
  }
  const indexes = candidates.map((_,i)=>i);
  for (let target=Math.min(maximum,candidates.length);target>0;target--) {
    const found = find([],indexes,target);
    if (found) return { selected:found.map(i=>candidates[i]), available:candidates.length, requested:maximum, targetMet:found.length>=3, metricVersion };
  }
  return { selected:[], available:0, requested:maximum, targetMet:false, metricVersion };
}

module.exports = { selectDiversePlans };
