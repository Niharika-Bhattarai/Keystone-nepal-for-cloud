'use strict';

const { boundarySegments } = require('./openingGeometry');
const { roomArea } = require('./planGeometry');
const { isOutdoorType } = require('./tile/canonicalRoomTypes');
const { validateBedroomClosets } = require('./closetGeometry');
const { parseFeatureRequests, unrecognizedFeatureRequests } = require('./tile/normalizeBrief');
const { migrateSurvey } = require('./surveyMigration');
const { validateRequestedFeatureRooms } = require('./residential/v2/validators/featureRoomPlacementValidator');
const { validateBedroomSharedBathAccess } = require('./bedroomSharedBathAccess');

function checkSurveyRequirements(plan, brief) {
  const checks = [];
  const levels = plan.levels || [];
  const ground = levels.find(l => Number(l.level) === 1);
  const doors = levels.flatMap(l => l.doors || []);
  const add = (field, fulfilled, message) => checks.push({ field, fulfilled, message });
  const finishedArea = levels.flatMap(l=>l.rooms || []).filter(r=>r.type!=='garage' && !isOutdoorType(r.type))
    .reduce((sum,r)=>sum+roomArea(r),0);
  const targetArea = Number(brief.conditionedAreaSqFt || brief.totalAreaSqFt);
  add('totalArea',Math.abs(finishedArea-targetArea) <= Math.max(120,targetArea*0.08),
    `Finished floor area must stay within the concept tolerance of the requested ${targetArea} sq ft, excluding the garage.`);
  if (brief.shape === 'SQUARE') {
    add('shape', levels.length > 0 && levels.every(l => Number.isFinite(l.width) && Number.isFinite(l.height) && Math.abs(l.width - l.height) < 1e-6) && !(plan.envelopeVoidRects || []).length,
      'A square footprint must have equal width and depth on every level without exterior notches.');
  }
  if (brief.primaryLevel) {
    const primaryLevels = levels.filter(level => level.rooms.some(room => room.type === 'primary_bedroom'));
    add('masterLocation', primaryLevels.length === 1 && Number(primaryLevels[0].level) === Number(brief.primaryLevel),
      'The primary bedroom must be on the floor selected in the survey.');
  }
  if (brief.outdoorType && brief.outdoorType !== 'NONE') {
    // A structure outside the house (level.outdoor), reached by its own door.
    const type = brief.outdoorType.toLowerCase();
    const outdoor = (ground?.outdoor || []).filter(o => o.type === type &&
      (ground.doors || []).some(d => d.outdoorLivingDoor && [d.a, d.b].includes(o.hostRoomId)));
    add('outdoorLiving',outdoor.length>0,'The selected outdoor structure must be present with independent access.');
  }
  if (brief.accessibility?.wideDoors || brief.accessibility?.wheelchair) {
    add('accessibilityNeeds', doors.every(d => d.garageDoor || d.openThreshold || Number(d.width) >= 4),
      'Wide doorways require four-foot door openings throughout the plan.');
  }
  if (brief.indoorOutdoor === 'MAXIMUM') {
    add('indoorOutdoor', Boolean(ground?.doors.some(d => d.indoorOutdoorOpening && d.slidingDoor && Number(d.width) >= 8)),
      'Maximum indoor/outdoor flow requires an eight-foot sliding opening from a ground-floor public room.');
  }
  if (brief.lotWidth || brief.lotDepth) {
    add('lotWidth', !brief.lotWidth || levels.every(l => l.width <= brief.lotWidth), 'The house must fit the selected lot width.');
    add('lotDepth', !brief.lotDepth || levels.every(l => l.height <= brief.lotDepth), 'The house must fit the selected lot depth.');
  }
  if (brief.raw?.kitchenPlacement && ground) {
    const kitchen = ground.rooms.find(r => r.type === 'kitchen');
    const front = plan.facade?.frontEdge || 'bottom';
    const wanted = brief.kitchenRear ? ({ top:'bottom', bottom:'top', left:'right', right:'left' }[front]) : front;
    const fits = kitchen && boundarySegments(kitchen, ground.rooms, true).some(s =>
      wanted === 'top' ? s.dir === 'horizontal' && s.fixed === 0
        : wanted === 'bottom' ? s.dir === 'horizontal' && s.fixed === ground.height
          : wanted === 'left' ? s.dir === 'vertical' && s.fixed === 0
            : s.dir === 'vertical' && s.fixed === ground.width);
    add('kitchenPlacement', Boolean(fits), `The kitchen must reach the ${brief.kitchenRear ? 'rear' : 'front'} facade selected in the survey.`);
  }
  return checks;
}

function validateSurveyRequirements(plan, brief) {
  return [
    ...checkSurveyRequirements(plan, brief).filter(c => !c.fulfilled).map(c => `Survey requirement (${c.field}): ${c.message}`),
    ...validateOriginalSurveyCounts(plan, brief.raw || {}),
    ...validateBedroomBathroomAccess(plan),
    ...validateBedroomSharedBathAccess(plan, brief),
    ...validateBedroomClosets(plan, brief.raw || {}),
    ...unrecognizedFeatureRequests(brief.raw?.features).map(chunk => `Original survey (features): unrecognized selection ${chunk}`),
    // Re-read submitted intent rather than trusting a possibly reduced program.
    ...validateRequestedFeatureRooms(plan, { requestedFeatureItems:
      parseFeatureRequests(migrateSurvey(brief.raw || {}).survey.features) }),
  ];
}

// Independent audit of the submitted counts. This deliberately avoids the
// normalizer, whose historical defaults/caps are still being migrated in P01.
// Shared by production generation, refinement and the independent scoreboard.
function validateOriginalSurveyCounts(plan, survey) {
  const errors = [];
  const count = value => {
    const match = /^(\d+)(?:\s+(?:Beds?|Bedrooms?|Baths?|Bathrooms?|Story|Stories))?$/i.exec(String(value ?? '').trim());
    return match ? Number(match[1]) : null;
  };
  const levels = plan.levels || [];
  const rooms = levels.flatMap(l => l.rooms || []);
  const bedrooms = rooms.filter(r => ['bedroom', 'primary_bedroom'].includes(r.type));
  const bathrooms = rooms.filter(r => ['bathroom', 'primary_bathroom'].includes(r.type));
  const compare = (field, expected, actual) => {
    if (expected !== null && expected !== actual) errors.push(`Original survey (${field}): requested ${expected}, delivered ${actual}.`);
  };
  compare('stories', count(survey.stories), levels.filter(l => l.level >= 1).length);
  compare('bedrooms', count(survey.bedrooms), bedrooms.length);
  compare('bathrooms', count(survey.bathrooms), bathrooms.length);
  const householdIds = new Set(bedrooms.map(r => r.id));
  compare('privateBaths', count(survey.privateBaths), bathrooms.filter(r => householdIds.has(r.attachedTo)).length);
  compare('sharedBathroomCount', count(survey.sharedBathroomCount), bathrooms.filter(r => !r.attachedTo).length);
  if (Array.isArray(survey.bedroomConfigs)) {
    survey.bedroomConfigs.forEach((config, index) => {
      const programId = index === 0 ? 'primary' : `bedroom_${index + 1}`;
      const matching = bedrooms.filter(r => r.programId === programId);
      const bedroom = matching[0];
      if (matching.length !== 1) errors.push(`Original survey (bedroomConfigs.${index}): expected one stable ${programId} identity, delivered ${matching.length}.`);
      else compare(`bedroomConfigs.${index}.privateBath`, config.privateBath === 'Yes' || config.privateBath === true ? 1 : 0, bathrooms.filter(r => r.attachedTo === bedroom.id).length);
    });
  }
  return errors;
}

// A private bathroom needs a real door to its own bedroom, and must not become
// a route into shared space. Walking outward from the bathroom without
// re-entering that bedroom may only reach dead-end private ancillaries of the
// same suite: a closet off an ensuite is part of the suite, a door onward to a
// hall or another bedroom makes the "private" bathroom a pass-through.
const PRIVATE_ANCILLARY_TYPES = new Set(['closet', 'storage']);
const HOUSEHOLD_BEDROOM_TYPES = ['bedroom', 'primary_bedroom', 'guest_bedroom'];

function validateBedroomBathroomAccess(plan) {
  const errors = [];
  for (const level of plan.levels || []) {
    const byId = new Map((level.rooms || []).map(r => [r.id, r]));
    // Exterior openings are not access to shared interior space, so they are
    // resolved away here rather than counted as a neighbouring room.
    const neighbours = id => (level.doors || [])
      .filter(d => d.a === id || d.b === id)
      .map(d => (d.a === id ? d.b : d.a))
      .filter(other => byId.has(other));

    for (const bath of (level.rooms || []).filter(r => ['bathroom', 'primary_bathroom'].includes(r.type) && r.attachedTo)) {
      const bedroom = byId.get(bath.attachedTo);
      if (!bedroom || !HOUSEHOLD_BEDROOM_TYPES.includes(bedroom.type) || !neighbours(bath.id).includes(bedroom.id)) {
        errors.push(`Survey bathroom access: ${bath.id} needs a door to its attached bedroom ${bath.attachedTo}.`);
        continue;
      }
      const suite = new Set([bath.id, bedroom.id]);
      const queue = neighbours(bath.id).filter(id => id !== bedroom.id);
      const seen = new Set(queue);
      let leak = null;
      while (queue.length && !leak) {
        const id = queue.shift();
        if (!PRIVATE_ANCILLARY_TYPES.has(byId.get(id).type)) { leak = id; break; }
        suite.add(id);
        for (const next of neighbours(id)) {
          if (suite.has(next) || seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      if (leak) errors.push(`Survey bathroom access: private bathroom ${bath.id} opens outside its attached bedroom through ${leak}.`);
    }
  }
  return errors;
}

module.exports = { checkSurveyRequirements, validateSurveyRequirements, validateOriginalSurveyCounts, validateBedroomBathroomAccess };
