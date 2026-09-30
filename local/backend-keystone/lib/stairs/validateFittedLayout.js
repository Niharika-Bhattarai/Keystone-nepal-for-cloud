'use strict';
const {getStairCodeProfile,ruleFeet}=require('./codeProfiles');
const {NUMERIC_EPSILON_FT:EPS,exactTicks,uniformRiser,withinMaximum}=require('./precision');
const {intersection}=require('../geometry/rectBoolean');
const positive=value=>Number.isFinite(value)&&value>0;
const rectangle=r=>r&&Number.isFinite(r.x)&&Number.isFinite(r.y)&&positive(r.w)&&positive(r.h);
const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const equal=(a,b)=>Math.abs(a-b)<=EPS;

// Recompute dimensional consistency; neither valid:true nor a stored summary
// is evidence. This remains a nominal-flight check, not a headroom/finish or
// construction validator. Those checks need the full physical assembly.
function validateFittedLayout(layout,{core,profile}={}) {
  const rules=getStairCodeProfile(profile);
  const errors=[];
  if(!layout || !['straight','quarter-turn','switchback'].includes(layout.kind)
      || !positive(layout.riseFt)||!positive(layout.riserFt)||!positive(layout.treadFt)
      || !Number.isSafeInteger(layout.risers)||layout.risers<2
      || !Array.isArray(layout.flights)||!layout.flights.length
      || !Array.isArray(layout.landings)) {
    return {valid:false,errors:['Malformed stair layout: finite dimensions, integer risers and fitted flights are required.'],measurements:null};
  }
  if(core!==undefined&&!rectangle(core)) errors.push('Malformed allocated stair core.');
  let riseTicks=null;
  try {
    riseTicks=exactTicks(layout.riseFt);
    if(riseTicks<=0) throw new RangeError('Nonpositive rise');
  } catch {riseTicks=null;errors.push('Floor rise is not a positive exact 1/64-inch datum.');}
  if(riseTicks!==null&&!withinMaximum(uniformRiser(riseTicks,layout.risers),rules.rules.maxRiser.ticks)) errors.push('Finished design riser exceeds the profile maximum.');
  if(!equal(layout.risers*layout.riserFt,layout.riseFt)) errors.push('Riser count and height do not add up to the floor rise.');
  if(layout.treadFt<ruleFeet('minGoing',rules)-EPS) errors.push('Tread going is below the profile minimum.');
  const flights=[];
  let risers=0,z=0;
  for(const [index,flight] of layout.flights.entries()) {
    if(!flight || !rectangle(flight.rect)||!point(flight.from)||!point(flight.to)
        || !Number.isSafeInteger(flight.risers)||flight.risers<2
        || !Number.isFinite(flight.fromZFt)||!Number.isFinite(flight.toZFt)) {
      errors.push(`Flight ${index+1} has malformed geometry.`);continue;
    }
    const dx=Math.abs(flight.to.x-flight.from.x),dy=Math.abs(flight.to.y-flight.from.y);
    if((dx>EPS&&dy>EPS)||(dx<=EPS&&dy<=EPS)) errors.push(`Flight ${index+1} must have axis-aligned, nonzero travel.`);
    const vertical=dy>dx,run=Math.hypot(dx,dy),width=vertical?flight.rect.w:flight.rect.h;
    const start=vertical?flight.rect.y:flight.rect.x,end=start+(vertical?flight.rect.h:flight.rect.w);
    const travel=[vertical?flight.from.y:flight.from.x,vertical?flight.to.y:flight.to.x].sort((a,b)=>a-b);
    const centre=vertical?flight.rect.x+flight.rect.w/2:flight.rect.y+flight.rect.h/2;
    if(!equal(travel[0],start)||!equal(travel[1],end)
      || !equal(vertical?flight.from.x:flight.from.y,centre)||!equal(vertical?flight.to.x:flight.to.y,centre)) errors.push(`Flight ${index+1} travel does not follow its rectangle centreline and ends.`);
    if(!equal(run,(flight.risers-1)*layout.treadFt)) errors.push(`Flight ${index+1} run does not match its independent tread count and going.`);
    const rise=flight.risers*layout.riserFt;
    if(rise>ruleFeet('maxFlightRise',rules)+EPS) errors.push(`Flight ${index+1} exceeds the maximum rise between landings.`);
    if(!equal(flight.fromZFt,z)||!equal(flight.toZFt,z+rise)) errors.push(`Flight ${index+1} elevations are discontinuous or stale.`);
    if(width<ruleFeet('minWidthAboveRails',rules)-EPS) errors.push(`Flight ${index+1} nominal width is below the profile minimum before finishes.`);
    if(!positive(layout.flightWidthFt)||!equal(width,layout.flightWidthFt)) errors.push(`Flight ${index+1} width disagrees with the layout summary.`);
    risers+=flight.risers;z+=rise;
    flights.push({index,runFt:run,nominalWidthFt:width,riseFt:rise,risers:flight.risers});
    for(let other=0;other<index;other++) if(rectangle(layout.flights[other]?.rect)&&intersection(flight.rect,layout.flights[other].rect)) errors.push(`Flight ${index+1} overlaps flight ${other+1} in plan; stacked flights require an explicit assembly model.`);
  }
  if(risers!==layout.risers||!equal(z,layout.riseFt)) errors.push('Independent flight risers do not reach the upper floor.');
  for(const [index,r] of [...layout.flights.map(f=>f?.rect),...layout.landings].entries()) {
    if(!rectangle(r)) {errors.push(`Flight/landing rectangle ${index+1} is malformed.`);continue;}
    if(rectangle(core)&&(r.x<core.x-EPS||r.y<core.y-EPS||r.x+r.w>core.x+core.w+EPS||r.y+r.h>core.y+core.h+EPS)) errors.push('A flight or landing leaves the allocated stair core.');
  }
  return {valid:errors.length===0,errors:[...new Set(errors)],measurements:{riseTicks,
    uniformRiser:riseTicks===null?null:uniformRiser(riseTicks,layout.risers),flights,
    basis:'nominal_fitted_layout; finished faces, landings, headroom, rails and structure remain separate'}};
}
module.exports={validateFittedLayout};
