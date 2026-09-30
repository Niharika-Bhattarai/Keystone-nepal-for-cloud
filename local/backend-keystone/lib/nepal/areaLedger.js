'use strict';

// Orthogonal construction geometry in integer millimetres. A cell is counted once,
// even when several slabs, canopies or reservations cover it. Regulatory treatment
// is supplied by the resolved municipal profile, not inferred from geometry.
function rect(box) {
  const [x1, y1, x2, y2] = Array.isArray(box) ? box :
    [box?.x1, box?.y1, box?.x2, box?.y2];
  if (![x1, y1, x2, y2].every(Number.isSafeInteger) || x1 >= x2 || y1 >= y2)
    throw new TypeError('Rectangle requires ordered, safe integer millimetre coordinates');
  return { x1, y1, x2, y2 };
}
function within(box, x, y) { return box.x1 <= x && x < box.x2 && box.y1 <= y && y < box.y2; }
function areaSqM(boxes, clip = [], addBack = []) {
  const positive = boxes.map(rect), negative = clip.map(rect), override=addBack.map(rect);
  if (!positive.length&&!override.length) return 0;
  const xs = [...new Set([...positive, ...negative,...override].flatMap(b => [b.x1, b.x2]))].sort((a,b) => a-b);
  const ys = [...new Set([...positive, ...negative,...override].flatMap(b => [b.y1, b.y2]))].sort((a,b) => a-b);
  let squareMm = 0;
  for (let i=0; i<xs.length-1; i++) for (let j=0; j<ys.length-1; j++) {
    const x=(xs[i]+xs[i+1])/2, y=(ys[j]+ys[j+1])/2;
    if ((positive.some(b => within(b,x,y)) && !negative.some(b => within(b,x,y))) ||
        override.some(b => within(b,x,y)))
      squareMm += (xs[i+1]-xs[i])*(ys[j+1]-ys[j]);
  }
  if (!Number.isSafeInteger(squareMm)) throw new RangeError('Area exceeds safe millimetre precision');
  return squareMm / 1e6;
}
function assertDisjoint(groups) {
  const entries = Object.entries(groups).flatMap(([kind, boxes]) => boxes.map(box => ({kind, box:rect(box)})));
  for (let i=0; i<entries.length; i++) for (let j=i+1; j<entries.length; j++) {
    // Overlapping pieces within one category are deliberately unioned. Only
    // different regulatory categories must remain disjoint.
    if(entries[i].kind===entries[j].kind)continue;
    const a=entries[i].box, b=entries[j].box;
    if (Math.min(a.x2,b.x2)>Math.max(a.x1,b.x1) && Math.min(a.y2,b.y2)>Math.max(a.y1,b.y1))
      throw new Error(`Area categories overlap: ${entries[i].kind} and ${entries[j].kind}`);
  }
}
function measureAreaLedger({site, levels, coveredGround = [], regulatory = null}) {
  const siteBox=rect(site);
  const siteAreaSqM=areaSqM([siteBox]);
  const rows=levels.map((level, index) => {
    const categories = level.categories || {};
    assertDisjoint(categories);
    const slab = Object.values(categories).flat();
    const voids = level.voids || [];
    const outside = areaSqM(slab,[siteBox]);
    if (outside > 1e-9) throw new Error(`Level ${level.id || index} extends outside site`);
    const grossSqM=areaSqM(slab, voids);
    const detail=Object.fromEntries(Object.entries(categories).map(([key, boxes]) => [key,areaSqM(boxes,voids)]));
    const farSqM=regulatory?.farTreatment ?
      Object.entries(detail).reduce((total,[key,area]) => {
        const treatment=regulatory.farTreatment[key];
        if (treatment === undefined) throw new Error(`FAR treatment unresolved for ${key}`);
        return total + area*treatment;
      },0) : null;
    return {id:level.id || `level-${index+1}`, grossSqM, categoriesSqM:detail,
      voidSqM:areaSqM(slab)-grossSqM, farChargeableSqM:farSqM};
  });
  const groundCoverSqM=areaSqM(Object.values(levels[0]?.categories || {}).flat(),
    levels[0]?.voids || [],coveredGround);
  if(areaSqM(coveredGround,[siteBox])>1e-9)throw new Error('Covered ground area extends outside site');
  return {siteAreaSqM, groundCoverSqM, grossBuiltSqM:rows.reduce((s,r)=>s+r.grossSqM,0),
    farChargeableSqM:regulatory?.farTreatment ? rows.reduce((s,r)=>s+r.farChargeableSqM,0) : null,
    groundCoverageRatio:groundCoverSqM/siteAreaSqM, floors:rows,
    regulatoryStatus:regulatory?.farTreatment ? 'measured_with_adopted_treatment' : 'area_measured_treatment_unresolved'};
}
function evaluateAreaLimits(ledger,profile) {
  const p=profile?.parameters||{};
  const findings=[];
  if(p.maximumCoverageRatio==null)findings.push({code:'COVERAGE_LIMIT_UNRESOLVED',status:'needs_review'});
  else findings.push({code:'GROUND_COVERAGE',status:ledger.groundCoverageRatio<=p.maximumCoverageRatio+1e-10?'pass':'fail',
    measured:ledger.groundCoverageRatio,limit:p.maximumCoverageRatio});
  if(p.maximumFAR==null||ledger.farChargeableSqM==null)
    findings.push({code:'FAR_TREATMENT_UNRESOLVED',status:'needs_review'});
  else findings.push({code:'FAR',status:ledger.farChargeableSqM/ledger.siteAreaSqM<=p.maximumFAR+1e-10?'pass':'fail',
    measured:ledger.farChargeableSqM/ledger.siteAreaSqM,limit:p.maximumFAR});
  return {status:findings.some(f=>f.status==='fail')?'fail':findings.some(f=>f.status==='needs_review')?'needs_review':'pass',findings};
}
module.exports={rect,areaSqM,measureAreaLedger,evaluateAreaLimits};
