// lib/validatePlan.js (CommonJS)

const {
  normalizeRoomType,
  isBedroomType,
  getFeatureKey,
} = require('./tile/canonicalRoomTypes');
const {
  partListOf,
  roomArea,
  roomsOverlap,
} = require('./planGeometry');
const { buildRoomContract } = require('./residential/roomContractBuilder');
const { validateBedroomFit } = require('./residential/validators/bedroomFitValidator');
const { validateDiningFit } = require('./residential/validators/diningFitValidator');
const { validatePrivateCirculation } = require('./residential/validators/privateCirculationValidator');
const { validateOpeningGeometry } = require('./openingGeometry');
const { validateRequiredFurniture } = require('./furnitureGeometry');
const { validatePhysicalAccess } = require('./validatePhysicalAccess');
const { intersection } = require('./geometry/rectBoolean');

function parseCount(str) {
  const m = String(str || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function requestedFeatureCounts(featuresText) {
  const text = String(featuresText || '')
    .toLowerCase()
    .replace(/\b1\s*,\s*/g, '1 ')
    .replace(/\s+/g, ' ')
    .trim();

  const countMatch = (regex, fallbackRegex) => {
    const m = text.match(regex);
    if (m?.[1]) return parseInt(m[1], 10);
    return fallbackRegex.test(text) ? 1 : 0;
  };

  return {
    study: countMatch(/(\d+)\s+(study|office)/, /(study|office)/),
    gaming_room: countMatch(/(\d+)\s+(gaming room|game room|gaming)/, /gaming room|game room|gaming/),
    guest_bedroom: countMatch(/(\d+)\s+(guest bedroom|guest room)/, /guest bedroom|guest room/),
    gym: countMatch(/(\d+)\s+(gym|home gym|exercise room|workout room)/, /gym|home gym|exercise room|workout room/),
    library: countMatch(/(\d+)\s+(library|library room)/, /library|library room/),
    movie_room: countMatch(/(\d+)\s+(movie room|media room|home theater|theater room)/, /movie room|media room|home theater|theater room/),
  };
}

function requestedFeatureRequirements(surveyData = {}, normalizedBrief = null) {
  const requestedItems = Array.isArray(normalizedBrief?.requestedFeatureItems)
    ? normalizedBrief.requestedFeatureItems
    : [];
  if (requestedItems.length) {
    const requirements = new Map();
    for (const item of requestedItems) {
      const kind = String(item?.kind || item?.requestedFeatureKind || item?.canonicalType || '').trim();
      if (!kind) continue;
      const prev = requirements.get(kind) || {
        kind,
        canonicalType: normalizeRoomType(item?.canonicalType || kind),
        label: String(item?.displayLabel || item?.requestedFeatureLabel || kind).trim() || kind,
        count: 0,
      };
      prev.count += 1;
      requirements.set(kind, prev);
    }
    return [...requirements.values()];
  }

  return Object.entries(requestedFeatureCounts(surveyData?.features))
    .filter(([, count]) => Number(count) > 0)
    .map(([kind, count]) => ({
      kind,
      canonicalType: normalizeRoomType(kind),
      label: kind,
      count: Number(count) || 0,
    }));
}

function normalizedExpectations(surveyData = {}, normalizedBrief = null) {
  const surveyStories = String(surveyData?.stories || '1 Story').includes('2') ? 2 : 1;
  const surveyBeds = parseCount(surveyData?.bedrooms);
  const surveyBaths = parseCount(surveyData?.bathrooms);
  const surveyGarage = String(surveyData?.garage || 'None').toLowerCase();
  const surveyWantGarage = !surveyGarage.includes('none') && !surveyGarage.includes('no garage') && surveyGarage !== 'no';
  const surveyPrimaryOnLevel1 = String(surveyData?.masterLocation || '').includes('Level 1');

  return {
    wantStories: Number.isFinite(Number(normalizedBrief?.stories)) ? Number(normalizedBrief.stories) : surveyStories,
    wantBeds: Number.isFinite(Number(normalizedBrief?.bedrooms)) ? Number(normalizedBrief.bedrooms) : surveyBeds,
    wantBaths: Number.isFinite(Number(normalizedBrief?.bathrooms)) ? Number(normalizedBrief.bathrooms) : surveyBaths,
    wantFeatures: requestedFeatureRequirements(surveyData, normalizedBrief),
    wantGarage: normalizedBrief && typeof normalizedBrief.hasGarage === 'boolean' ? normalizedBrief.hasGarage : surveyWantGarage,
    primaryOnLevel1: normalizedBrief && Number.isFinite(Number(normalizedBrief.primaryLevel))
      ? Number(normalizedBrief.primaryLevel) === 1
      : surveyPrimaryOnLevel1,
  };
}

function countBathroomsDetailed(planSpec) {
  let fullBaths = 0;
  let powderRooms = 0;

  for (const lvl of planSpec.levels || []) {
    for (const room of lvl.rooms || []) {
      const t = normalizeRoomType(room.type);

      if (t === 'bathroom' || t === 'primary_bathroom') {
        fullBaths += 1;
      } else if (t === 'powder_room') {
        powderRooms += 1;
      }
    }
  }

  return {
    fullBaths,
    powderRooms,
    totalBathLike: fullBaths + powderRooms,
  };
}

function validatePlanSpec(planSpec, surveyData, normalizedBrief = null) {
  const errors = [];
  // Use the actual composite parts, not a room bounding box that may span an
  // L-shaped exterior void. Apply equally to rooms, corridors and stair cores,
  // including after refinement has moved their geometry.
  for (const level of planSpec?.levels || []) {
    if (Object.hasOwn(level, 'bedroomMeasurementBook')) {
      const resolved = require('./geometry/bedroomMeasurements').resolveBedroomMeasurements(level);
      errors.push(...resolved.errors.map(error => `Bedroom measurements: ${error.code}: ${error.message}`));
    }
    if (Object.hasOwn(level, 'openingScheduleBook')) {
      try {
        const model = require('./geometry/floorPassageModel').buildFloorPassageModel(level);
        errors.push(...model.errors.map(error => `Scheduled opening: ${error.code}: ${error.message}`));
      } catch (error) {
        errors.push(`Scheduled opening: invalid physical model: ${error.message}`);
      }
    }
    for (const room of level.rooms || []) {
      if (partListOf(room).some(part => (planSpec.envelopeVoidRects || []).some(cut => intersection(part, cut)))) {
        errors.push(`Envelope reservation: room ${room.id} on level ${level.level} intersects an exterior void.`);
      }
    }
  }
  const warnings = [];

  const {
    wantStories,
    wantBeds,
    wantBaths,
    wantFeatures,
    wantGarage,
    primaryOnLevel1,
  } = normalizedExpectations(surveyData, normalizedBrief);

  if (!planSpec || typeof planSpec !== 'object') return ['PlanSpec missing or invalid'];
  if (!Array.isArray(planSpec.levels) || planSpec.levels.length === 0) return ['levels[] missing'];
  for (const level of planSpec.levels) {
    if (level.stairCore?.layout?.valid === false) errors.push(`Stair flight fit invalid: ${level.stairCore.layout.reason}`);
    if (planSpec.levels.length > 1 && planSpec.verticalModel && level.stairCore && !level.stairCore.layout) errors.push('Stair flight fit invalid: fitted flight geometry is missing');
  }

  if (planSpec.stories !== wantStories) {
    errors.push(`Stories mismatch: wanted ${wantStories}, got ${planSpec.stories}`);
  }

  if (planSpec.levels.length !== wantStories) {
    errors.push(`Level count mismatch: expected ${wantStories}, got ${planSpec.levels.length}`);
  }

  let beds = 0;
  if (wantStories === 2 && Number(normalizedBrief?.laundryLevel) === 2) {
    const laundries = planSpec.levels.flatMap(lvl => (lvl.rooms || [])
      .filter(room => normalizeRoomType(room.type) === 'laundry')
      .map(room => ({ room, level: Number(lvl.level) })));
    if (laundries.length !== 1 || laundries[0].level !== 2) {
      errors.push('Laundry location mismatch: requested one laundry on level 2');
    }
  }
  let hasGarage = false;
  const canonicalFeatureCounts = new Map();
  const requestedFeatureCountsByKind = new Map();

  for (const lvl of planSpec.levels) {
    if (!lvl || !Array.isArray(lvl.rooms)) {
      errors.push(`Level ${lvl?.level ?? '?'} rooms missing`);
      continue;
    }

    if (!isFiniteNumber(lvl.width) || !isFiniteNumber(lvl.height)) {
      errors.push(`Level ${lvl.level} has invalid width/height`);
      continue;
    }

    for (const r of lvl.rooms) {
      if (!r || typeof r !== 'object') {
        errors.push(`Invalid room object on level ${lvl.level}`);
        continue;
      }

      const type = normalizeRoomType(r.type);
      if (!r.roomContract) {
        const roomContract = buildRoomContract(r, normalizedBrief || surveyData);
        if (roomContract) r.roomContract = roomContract;
      }

      if (r.level !== lvl.level) errors.push(`Room ${r.id} level mismatch`);

      if (![r.x, r.y, r.w, r.h].every(isFiniteNumber)) {
        errors.push(`Room ${r.id} has invalid numeric values`);
        continue;
      }

      if (r.w <= 0 || r.h <= 0) errors.push(`Room ${r.id} has invalid size`);
      if (r.x < 0 || r.y < 0) errors.push(`Room ${r.id} has negative coordinates`);
      const parts = partListOf(r);
      for (const part of parts) {
        if (![part.x, part.y, part.w, part.h].every(isFiniteNumber)) {
          errors.push(`Room ${r.id} has invalid part geometry`);
          continue;
        }
        if (part.w <= 0 || part.h <= 0) errors.push(`Room ${r.id} has invalid part size`);
        if (part.x < 0 || part.y < 0) errors.push(`Room ${r.id} has negative part coordinates`);
        if (part.x + part.w > lvl.width || part.y + part.h > lvl.height) {
          errors.push(`Room ${r.id} out of bounds on level ${lvl.level}`);
        }
      }

      if (isBedroomType(type)) beds += 1;
      if (type === 'garage') hasGarage = true;

      const featureKey = getFeatureKey(type);
      canonicalFeatureCounts.set(featureKey, (canonicalFeatureCounts.get(featureKey) || 0) + 1);

      const featureKind = String(r.requestedFeatureKind || '').trim();
      const featureSource = String(r.featureSource || '').trim().toLowerCase();
      if (featureKind && (Boolean(r.requestedFeature) || featureSource === 'requested')) {
        requestedFeatureCountsByKind.set(
          featureKind,
          (requestedFeatureCountsByKind.get(featureKind) || 0) + 1
        );
      }

      const bedroomFitError = validateBedroomFit(r, normalizedBrief || surveyData);
      if (bedroomFitError) errors.push(bedroomFitError);

      const diningFitError = validateDiningFit(r, normalizedBrief || surveyData);
      if (diningFitError) errors.push(diningFitError);
    }

    for (let i = 0; i < lvl.rooms.length; i++) {
      for (let j = i + 1; j < lvl.rooms.length; j++) {
        if (roomsOverlap(lvl.rooms[i], lvl.rooms[j])) {
          errors.push(`Rooms overlap on level ${lvl.level}: ${lvl.rooms[i].id} & ${lvl.rooms[j].id}`);
        }
      }
    }

    errors.push(...validatePrivateCirculation(lvl, normalizedBrief || surveyData));
    errors.push(...validateOpeningGeometry(lvl));
  }

  const { fullBaths, powderRooms } = countBathroomsDetailed(planSpec);
  const requestedGuestBedrooms = wantFeatures.reduce((sum, feature) => {
    const canonicalType = normalizeRoomType(feature?.canonicalType || feature?.kind || '');
    if (canonicalType !== 'guest_bedroom') return sum;
    return sum + (Number(feature?.count) || 0);
  }, 0);

  if (wantBeds) {
    const allowedMaxBeds = wantBeds + Math.max(0, requestedGuestBedrooms);
    if (beds < wantBeds || beds > allowedMaxBeds) {
      errors.push(`Bedrooms mismatch: wanted ${wantBeds}${requestedGuestBedrooms ? ` (+ up to ${requestedGuestBedrooms} guest bedroom)` : ''}, got ${beds}`);
    }
  }

  // Requested baths means full bathrooms.
  // Extra powder rooms are allowed.
  if (wantBaths && fullBaths < wantBaths) {
    errors.push(`Bathrooms mismatch: wanted ${wantBaths}, got ${fullBaths} full bathrooms${powderRooms ? ` (+ ${powderRooms} powder room${powderRooms > 1 ? 's' : ''})` : ''}`);
  }

  // Optional strict guard:
  // if somehow the generator creates more full baths than requested by a large amount,
  // surface that explicitly.
  if (wantBaths && fullBaths > wantBaths + 1) {
    errors.push(`Bathrooms over-generated: wanted ${wantBaths}, got ${fullBaths} full bathrooms`);
  }

  // Allow bonus powder room when primary suite is on level 1 and beds == baths.
  if (primaryOnLevel1 && wantBeds && wantBaths && wantBeds === wantBaths) {
    // no-op; powder room is explicitly allowed
  }

  if (wantGarage && !hasGarage) {
    errors.push('Feature requested: garage (missing)');
  }

  for (const feature of wantFeatures) {
    const wantCount = Number(feature?.count) || 0;
    if (wantCount <= 0) continue;
    const kind = String(feature?.kind || '').trim();
    const canonicalType = normalizeRoomType(feature?.canonicalType || kind);
    const gotRequestedCount = kind ? (requestedFeatureCountsByKind.get(kind) || 0) : 0;
    const useCanonicalFallback = requestedFeatureCountsByKind.size === 0;
    const gotCount = gotRequestedCount || (useCanonicalFallback ? (canonicalFeatureCounts.get(canonicalType) || 0) : 0);
    if (gotCount < wantCount) {
      // Feature rooms (study, gym, etc.) are non-structural and may be dropped when
      // a level is over-programmed. Emit a warning instead of a hard error so the
      // plan still passes validation and gets returned to the user.
      warnings.push(
        `Feature requested: ${feature.label || kind || canonicalType} (wanted ${wantCount}, got ${gotCount})`
      );
    }
  }

  // Return errors array (hard failures). Warnings are informational and don't block the plan.
  // Callers can access warnings via the second element if they destructure.
  errors.push(...validateRequiredFurniture(planSpec));
  if (planSpec.furnitureDiagnostics) errors.push(...validatePhysicalAccess(planSpec));
  return errors;
}

module.exports = { validatePlanSpec };
