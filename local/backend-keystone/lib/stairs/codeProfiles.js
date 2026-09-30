'use strict';

// Versioned model baseline, not a jurisdiction selection. Exceptions requiring
// geometry we do not model are deliberately not used to reduce reservations.
const DEFAULT_PROFILE_ID = 'irc-2021-residential-model-v1';
const SOURCE = 'https://bouldercounty.gov/property-and-land/land-use/building/building-publications/residential-stairways-handrails-ramps-and-guards-b32/';
const MODEL_SOURCE = 'https://codes.iccsafe.org/content/IRC2021P1/chapter-3-building-planning';
const TICKS_PER_INCH = 64;
const TICKS_PER_FOOT = 12 * TICKS_PER_INCH;
const recognized = new WeakSet();
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const definitions = [
  ['maxRiser',7.75,'maximum','R311.7.5.1','Finished riser height'],
  ['minGoing',10,'minimum','R311.7.5.2','Distance between successive nosings'],
  ['maxRiserVariation',0.375,'maximum','R311.7.5.1','Riser range within one flight'],
  ['maxGoingVariation',0.375,'maximum','R311.7.5.2','Going range within one flight'],
  ['minNosing',0.75,'minimum','R311.7.5.3','Closed-riser projection without exceptions'],
  ['maxNosing',1.25,'maximum','R311.7.5.3','Closed-riser projection'],
  ['maxNosingVariation',0.375,'maximum','R311.7.5.3','Nosing projection range'],
  ['maxNosingRadius',9/16,'maximum','R311.7.5.3','Leading-edge radius'],
  ['minWidthAboveRails',36,'minimum','R311.7.1','Clear width above handrails'],
  ['minWidthOneRail',31.5,'minimum','R311.7.1','Clear width at/below one handrail'],
  ['minWidthTwoRails',27,'minimum','R311.7.1','Clear width at/below two handrails'],
  ['maxRailProjection',4.5,'maximum','R311.7.8.2','Projection from either side'],
  ['minHeadroom',80,'minimum','R311.7.2','Vertical clearance over nosing datum/landing'],
  ['maxFlightRise',151,'maximum','R311.7.3','Rise between landings'],
  ['minStraightLandingDepth',36,'minimum','R311.7.6','Straight landing travel depth'],
  ['minRailHeight',34,'minimum','R311.7.8.1','Rail height above nosing datum'],
  ['maxRailHeight',38,'maximum','R311.7.8.1','Rail height above nosing datum'],
  ['minRailWallGap',1.5,'minimum','R311.7.8.3','Wall-to-grip clear gap'],
  ['minCircularGripDiameter',1.25,'minimum','R311.7.8.5','Circular grip diameter'],
  ['maxCircularGripDiameter',2,'maximum','R311.7.8.5','Circular grip diameter'],
  ['minLandingGuardHeight',36,'minimum','R312.1.2','Landing guard height'],
  ['minFlightGuardHeight',34,'minimum','R312.1.2','Open-side stair guard height'],
];
const rules = Object.fromEntries(definitions.map(([id,inches,limit,section,purpose]) => [id, {
  id, ticks:inches*TICKS_PER_INCH, inches, limit, section, purpose,
  sourceUrl:SOURCE, modelSourceUrl:MODEL_SOURCE, edition:'2021 IRC', checkedOn:'2026-09-25',
}]));
const base = freeze({id:DEFAULT_PROFILE_ID, edition:'2021 IRC', applicability:'model_baseline_only', rules,
  handrailTrigger:{risers:4,section:'R311.7.8',sourceUrl:SOURCE,purpose:'At least one handrail for a stairway with four or more risers'},
  unsupportedExceptions:['winder','spiral','alternating_tread','landing_omission','nosing_omission','rail_projection_exception'],
});
recognized.add(base);

// Explicit product choices. They are NOT dimensions quoted from the code.
const PRODUCT_DEFAULTS = freeze({
  source:'Keystone execution plan section 8.1; concept reservations, not structural sizing',
  preferredGoingIn:11, minBetweenRailsIn:36, wideBetweenRailsIn:48,
  nosingIn:1, circularGripDiameterIn:1.5, railHeightIn:36, railWallGapIn:1.5,
  guardHeightIn:36, maxOrdinaryGuardGapIn:3.75, treadThicknessIn:1, closedRiserThicknessIn:0.75,
  turnDepthAtLeastFlightWidth:true, closedRisers:true, landingAtEveryEnd:true,
});
function getStairCodeProfile(id = DEFAULT_PROFILE_ID) {
  if (id === DEFAULT_PROFILE_ID) return base;
  if (id && typeof id === 'object' && recognized.has(id)) return id;
  throw new RangeError(`Unknown stair code profile: ${String(id?.id || id)}`);
}
function createStricterProfile({id, overrides, reason, sourceUrl}, parent = base) {
  parent=getStairCodeProfile(parent);
  if (typeof id!=='string' || !id.trim() || id===parent.id || typeof reason!=='string' || !reason.trim()
      || typeof sourceUrl!=='string' || !sourceUrl.trim() || !overrides || typeof overrides!=='object' || Array.isArray(overrides)) {
    throw new TypeError('A stricter profile needs a new ID, reason, source and rule overrides.');
  }
  const changed={...parent.rules};
  for(const [key,inches] of Object.entries(overrides)) {
    const rule=parent.rules[key];
    if(!rule || !Number.isFinite(inches) || inches<=0 || !Number.isSafeInteger(inches*TICKS_PER_INCH)) throw new TypeError(`Invalid stair rule override: ${key}`);
    if(rule.limit==='maximum'?inches>rule.inches:inches<rule.inches) throw new RangeError(`Override would weaken ${key}`);
    changed[key]={...rule,inches,ticks:inches*TICKS_PER_INCH,sourceUrl,reason,baseSourceUrl:rule.sourceUrl};
  }
  for(const [min,max] of [['minNosing','maxNosing'],['minRailHeight','maxRailHeight'],['minCircularGripDiameter','maxCircularGripDiameter']]) {
    if(changed[min].ticks>changed[max].ticks) throw new RangeError(`Conflicting stair rules: ${min}/${max}`);
  }
  const result=freeze({...parent,id,parentId:parent.id,rules:changed});
  recognized.add(result);
  return result;
}
function ruleFeet(id, profile = base) { return getStairCodeProfile(profile).rules[id].ticks/TICKS_PER_FOOT; }
module.exports={DEFAULT_PROFILE_ID,PRODUCT_DEFAULTS,TICKS_PER_INCH,TICKS_PER_FOOT,getStairCodeProfile,createStricterProfile,ruleFeet};
