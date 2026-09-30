const { normalizeRoomType } = require('./canonicalRoomTypes');
const { attachRoomContracts } = require('../residential/roomContractBuilder');

const FEATURE_CATALOG = {
  playroom: { type: 'playroom', targetAreaSqFt: 140, minAreaSqFt: 120, preferredLevel: 1, shrinkRank: 7, featureKind: 'playroom', displayLabel: 'Playroom', placementFamily: 'family_play' },
  study:        { type: 'study',        targetAreaSqFt: 110, minAreaSqFt: 64,  preferredLevel: 1, shrinkRank: 7, featureKind: 'study',       displayLabel: 'Study',       placementFamily: 'quiet_focus' },
  home_office:  { type: 'study',        targetAreaSqFt: 110, minAreaSqFt: 80,  preferredLevel: 1, shrinkRank: 7, featureKind: 'home_office', displayLabel: 'Home Office', placementFamily: 'quiet_focus' },
  gaming_room:  { type: 'gaming_room',  targetAreaSqFt: 130, minAreaSqFt: 95,  preferredLevel: 2, shrinkRank: 7, featureKind: 'gaming_room', displayLabel: 'Gaming Room', placementFamily: 'social_entertainment' },
  gym:          { type: 'gym',          targetAreaSqFt: 125, minAreaSqFt: 90,  preferredLevel: 1, shrinkRank: 7, featureKind: 'gym',         displayLabel: 'Gym',         placementFamily: 'wellness' },
  library:      { type: 'library',      targetAreaSqFt: 110, minAreaSqFt: 80,  preferredLevel: 1, shrinkRank: 7, featureKind: 'library',     displayLabel: 'Library',     placementFamily: 'quiet_focus' },
  movie_room:   { type: 'movie_room',   targetAreaSqFt: 145, minAreaSqFt: 110, preferredLevel: 2, shrinkRank: 7, featureKind: 'movie_room',  displayLabel: 'Movie Room',  placementFamily: 'social_entertainment' },
  wine_cellar:  { type: 'wine_cellar',  targetAreaSqFt:  90, minAreaSqFt: 60,  preferredLevel: 1, shrinkRank: 8, featureKind: 'wine_cellar', displayLabel: 'Wine Cellar', placementFamily: 'specialty_service' },
  music_room:   { type: 'music_room',   targetAreaSqFt: 120, minAreaSqFt: 90,  preferredLevel: 1, shrinkRank: 7, featureKind: 'music_room',  displayLabel: 'Music Room',  placementFamily: 'creative' },
  office:       { type: 'study',        targetAreaSqFt: 110, minAreaSqFt: 80,  preferredLevel: 1, shrinkRank: 7, featureKind: 'home_office', displayLabel: 'Home Office', placementFamily: 'quiet_focus' },
};

const CORE_PROTECTED_TYPES = new Set([
  'primary_bedroom',
  'bedroom',
  'guest_bedroom',
  'primary_bathroom',
  'bathroom',
  'powder_room',
  'laundry',
  'living_room',
  'kitchen',
  'dining_room',
]);

const NEVER_DROP_TYPES = new Set([
  'primary_bedroom',
  'primary_bathroom',
  'laundry',
  'living_room',
  'kitchen',
  'dining_room',
  'stairs',
  'hallway',
  'garage',
]);

const BATHROOM_TEMPLATES = {
  primary: [
    { widthFt: 8, heightFt: 8, areaSqFt: 64 },
    { widthFt: 8, heightFt: 10, areaSqFt: 80 },
    { widthFt: 10, heightFt: 10, areaSqFt: 100 },
  ],
  shared: [
    { widthFt: 5, heightFt: 8, areaSqFt: 40 },
    { widthFt: 6, heightFt: 8, areaSqFt: 48 },
    { widthFt: 6, heightFt: 10, areaSqFt: 60 },
  ],
  guest: [
    { widthFt: 5, heightFt: 8, areaSqFt: 40 },
    { widthFt: 6, heightFt: 8, areaSqFt: 48 },
    { widthFt: 6, heightFt: 10, areaSqFt: 60 },
  ],
  private: [
    { widthFt: 5, heightFt: 8, areaSqFt: 40 },
    { widthFt: 6, heightFt: 8, areaSqFt: 48 },
    { widthFt: 6, heightFt: 10, areaSqFt: 60 },
  ],
  powder: [
    { widthFt: 4, heightFt: 6, areaSqFt: 24 },
    { widthFt: 5, heightFt: 6, areaSqFt: 30 },
    { widthFt: 5, heightFt: 8, areaSqFt: 40 },
  ],
};

function totalTargetArea(rooms) {
  return rooms.reduce((sum, r) => sum + (Number(r.targetAreaSqFt) || 0), 0);
}

function bathroomTemplateForUse(bathroomUse, type) {
  if (type === 'powder_room') return 'powder';
  if (bathroomUse === 'primary') return 'primary';
  if (bathroomUse === 'private') return 'private';
  if (bathroomUse === 'guest') return 'guest';
  return 'shared';
}

function chooseBathroomTemplate(templateKey, requestedTargetAreaSqFt) {
  const options = BATHROOM_TEMPLATES[templateKey] || BATHROOM_TEMPLATES.shared;
  if (!options.length) return null;

  const target = Number(requestedTargetAreaSqFt) || options[0].areaSqFt;
  let best = options[0];
  let bestDelta = Math.abs(best.areaSqFt - target);

  for (const option of options.slice(1)) {
    const delta = Math.abs(option.areaSqFt - target);
    if (delta < bestDelta) {
      best = option;
      bestDelta = delta;
    }
  }

  return best;
}

function room(id, type, level, areaSqFt, opts = {}) {
  const normalizedType = normalizeRoomType(type);
  const minAreaSqFt =
    Number.isFinite(opts.minAreaSqFt)
      ? opts.minAreaSqFt
      : Math.max(24, Math.round(areaSqFt * 0.7));

  const maxAreaSqFt =
    Number.isFinite(opts.maxAreaSqFt)
      ? opts.maxAreaSqFt
      : Math.round(areaSqFt * 1.35);

  const bathroomUse = opts.bathroomUse || null;
  const bathroomTemplateKey = opts.bathroomTemplate || bathroomTemplateForUse(bathroomUse, normalizedType);
  const preferredFootprints =
    opts.preferredFootprints ||
    ((normalizedType === 'bathroom' || normalizedType === 'primary_bathroom' || normalizedType === 'powder_room')
      ? (BATHROOM_TEMPLATES[bathroomTemplateKey] || null)
      : null);

  return {
    id,
    type: normalizedType,
    level,
    targetAreaSqFt: areaSqFt,
    minAreaSqFt,
    maxAreaSqFt,
    priority: Number.isFinite(opts.priority) ? opts.priority : 1,
    shrinkRank: Number.isFinite(opts.shrinkRank) ? opts.shrinkRank : 5,
    fixed: Boolean(opts.fixed),
    bathroomUse,
    bathroomTemplate: bathroomTemplateKey,
    preferredFootprints,
    attachedTo: opts.attachedTo || null,
    closet: opts.closet || null,
    requestedFeature: Boolean(opts.requestedFeature),
    protectFromDrop:
      Boolean(opts.protectFromDrop) ||
      CORE_PROTECTED_TYPES.has(normalizedType) ||
      Boolean(opts.fixed),
    ...opts,
  };
}

function garageAreaSqFt(garageType) {
  switch (garageType) {
    case 'ONE_CAR': return 280;
    case 'TWO_CAR': return 420;
    default: return 0;
  }
}

// Tiny-home minimum area scale: for homes < 900 sqft the layout is so constrained
// that standard minimums cause cascade compression and dropped rooms.
// This scale mirrors the scoreFootprint.js threshold so planning and scoring agree.
function tinyHomeMinScale(totalAreaSqFt) {
  if (!totalAreaSqFt || totalAreaSqFt >= 900) return 1.0;
  return Math.sqrt(Math.max(0.4, totalAreaSqFt / 1200));
}

function sizeTier(totalAreaSqFt) {
  const a = Number(totalAreaSqFt) || 0;
  if (a <= 1000) return 'T1';
  if (a <= 1800) return 'T2';
  if (a <= 2800) return 'T3';
  if (a <= 3800) return 'T4';
  return 'T5';
}

function estimateLevelUsableArea(levelProgram, levelAreaSqFtActual) {
  const fixedArea = levelProgram.rooms.reduce((sum, r) => {
    if (r.fixed || r.type === 'garage' || r.type === 'stairs' || r.type === 'hallway') {
      return sum + (Number(r.targetAreaSqFt) || 0);
    }
    return sum;
  }, 0);

  const circulationReserve = Math.max(0, Math.round(levelAreaSqFtActual * 0.04));
  return Math.max(0, levelAreaSqFtActual - fixedArea - circulationReserve);
}

function estimateCoreNeedForLevel(levelProgram) {
  return levelProgram.rooms.reduce((sum, r) => {
    const area = Number(r.targetAreaSqFt) || 0;
    if (CORE_PROTECTED_TYPES.has(r.type) && !isOptionalFeatureRoom(r)) return sum + area;
    return sum;
  }, 0);
}

function featurePriorityScore(feature) {
  const kind = String(feature?.requestedFeatureKind || feature?.featureKind || normalizeRoomType(feature?.type));
  const type = normalizeRoomType(feature?.type);
  if (kind === 'study' || kind === 'home_office') return 1;
  if (type === 'library') return 2;
  if (type === 'gym') return 3;
  if (type === 'music_room') return 4;
  if (type === 'gaming_room') return 5;
  if (type === 'movie_room') return 6;
  if (type === 'wine_cellar') return 7;
  return 5;
}

function isRequestedFeatureRoom(roomSpec) {
  return Boolean(roomSpec?.requestedFeature);
}

function isOptionalFeatureRoom(roomSpec) {
  return Boolean(roomSpec?.requestedFeature) || Boolean(roomSpec?.isFeatureRoom) || String(roomSpec?.featureSource || '') === 'default';
}

function pruneFeatureRoomsBeforeCompression(levelPrograms, footprint, notes) {
  const levelAreaSqFtActual = Number(footprint.levelAreaSqFtActual) || 0;

  for (const levelProgram of levelPrograms) {
    let assigned = totalTargetArea(levelProgram.rooms);
    const usableArea = estimateLevelUsableArea(levelProgram, levelAreaSqFtActual);
    const coreNeed = estimateCoreNeedForLevel(levelProgram);
    const softFeatureCap = Math.max(0, Math.floor((usableArea - coreNeed) * 0.9));

    const featureRooms = levelProgram.rooms
      .filter((r) => isOptionalFeatureRoom(r))
      .sort((a, b) => {
        const byPriority = featurePriorityScore(a) - featurePriorityScore(b);
        if (byPriority !== 0) return byPriority;
        return (a.targetAreaSqFt || 0) - (b.targetAreaSqFt || 0);
      });

    if (!featureRooms.length) continue;

    const currentFeatureArea = featureRooms.reduce((sum, r) => sum + (Number(r.targetAreaSqFt) || 0), 0);
    const hardLimit = Math.floor(levelAreaSqFtActual * 0.985);

    let featureOverflow = 0;
    if (currentFeatureArea > softFeatureCap) {
      featureOverflow += currentFeatureArea - softFeatureCap;
    }
    if (assigned > hardLimit) {
      featureOverflow += assigned - hardLimit;
    }

    if (featureOverflow <= 0) continue;

    for (const feature of featureRooms) {
      if (featureOverflow <= 0) break;

      const reducible = Math.max(0, (feature.targetAreaSqFt || 0) - (feature.minAreaSqFt || 0));
      if (reducible > 0) {
        const cut = Math.min(reducible, featureOverflow);
        feature.targetAreaSqFt -= cut;
        assigned -= cut;
        featureOverflow -= cut;
      }
    }

    if (featureOverflow <= 0) continue;

    const dropCandidates = [...featureRooms]
      .filter((feature) => !isRequestedFeatureRoom(feature))
      .reverse();

    for (const feature of dropCandidates) {
      if (featureOverflow <= 0) break;

      levelProgram.rooms = levelProgram.rooms.filter((r) => r.id !== feature.id);
      const removedArea = Number(feature.targetAreaSqFt) || 0;
      assigned -= removedArea;
      featureOverflow -= removedArea;
      notes.push(`Dropped feature room "${feature.requestedFeatureLabel || feature.type}" on level ${levelProgram.level}: optional room exceeded level capacity.`);
    }

    if (featureOverflow > 0) {
      notes.push(`Retained requested feature rooms on level ${levelProgram.level} despite tight capacity; core/public rooms must absorb the remaining ${Math.round(featureOverflow)}sqft pressure.`);
    }
  }
}

function makePrimaryBedroom(id, level, stories, scale = 1.0, minScale = 1.0) {
  const baseArea = stories === 1 ? 260 : 230;
  const target = Math.round((baseArea + 36) * scale);
  return room(id, 'primary_bedroom', level, target, {
    minAreaSqFt: Math.round(185 * minScale),
    maxAreaSqFt: 380,
    priority: 1,
    shrinkRank: 2,
    protectFromDrop: true,
    closet: {
      type: 'walk_in',
      widthFt: 6,
      depthFt: 6,
      placement: 'side',
    },
  });
}

function makeSecondaryBedroom(id, level, type = 'bedroom', scale = 1.0, minScale = 1.0) {
  const baseArea = type === 'guest_bedroom' ? 145 : 140;
  const target = Math.round((baseArea + 12) * scale);
  return room(id, type, level, target, {
    minAreaSqFt: Math.round(95 * minScale),
    maxAreaSqFt: 250,
    priority: 1,
    shrinkRank: 3,
    protectFromDrop: true,
    closet: {
      type: 'reach_in',
      depthFt: 2,
      widthFt: 5,
      placement: 'side',
    },
  });
}

function makePrimaryBathroom(id, level, scale = 1.0, minScale = 1.0) {
  const requested = Math.round(95 * scale);
  const template = chooseBathroomTemplate('primary', requested);
  const targetArea = Math.max(requested, template ? template.areaSqFt : 0);

  return room(id, 'primary_bathroom', level, targetArea, {
    minAreaSqFt: Math.max(Math.round(64 * minScale), template ? template.areaSqFt : 0),
    maxAreaSqFt: 160,
    priority: 1,
    shrinkRank: 1,
    bathroomUse: 'primary',
    bathroomTemplate: 'primary',
    preferredFootprints: BATHROOM_TEMPLATES.primary,
    protectFromDrop: true,
  });
}

function makeSharedBathroom(id, level, areaSqFt = 65, use = 'shared', scale = 1.0, minScale = 1.0) {
  const templateKey = use === 'guest' ? 'guest' : 'shared';
  const requested = Math.round(areaSqFt * scale);
  const template = chooseBathroomTemplate(templateKey, requested);
  const targetArea = Math.max(requested, template ? template.areaSqFt : 0);

  return room(id, 'bathroom', level, targetArea, {
    minAreaSqFt: Math.max(Math.round(48 * minScale), template ? template.areaSqFt : 0),
    maxAreaSqFt: 110,
    priority: 1,
    shrinkRank: 4,
    bathroomUse: use,
    bathroomTemplate: templateKey,
    preferredFootprints: BATHROOM_TEMPLATES[templateKey],
    protectFromDrop: true,
  });
}

function makePowderRoom(id, level, minScale = 1.0) {
  const template = chooseBathroomTemplate('powder', 40);
  return room(id, 'powder_room', level, Math.max(40, template ? template.areaSqFt : 0), {
    minAreaSqFt: Math.max(Math.round(32 * minScale), template ? template.areaSqFt : 0),
    maxAreaSqFt: 56,
    priority: 1,
    shrinkRank: 5,
    bathroomUse: 'guest',
    bathroomTemplate: 'powder',
    preferredFootprints: BATHROOM_TEMPLATES.powder,
    protectFromDrop: true,
  });
}

function makePrivateSecondaryBath(id, level, attachedToBedroomId, minScale = 1.0) {
  const template = chooseBathroomTemplate('private', 60);
  return room(id, 'bathroom', level, Math.max(60, template ? template.areaSqFt : 0), {
    minAreaSqFt: Math.max(Math.round(48 * minScale), template ? template.areaSqFt : 0),
    maxAreaSqFt: 90,
    priority: 1,
    shrinkRank: 2,
    bathroomUse: 'private',
    bathroomTemplate: 'private',
    preferredFootprints: BATHROOM_TEMPLATES.private,
    attachedTo: attachedToBedroomId,
    protectFromDrop: true,
  });
}

function addRoom(levelPrograms, level, roomObj) {
  levelPrograms[level - 1].rooms.push(roomObj);
  return roomObj;
}

function normalizeFeatureEntries(requestedFeatureItems = []) {
  const out = [];

  for (const item of requestedFeatureItems || []) {
    const rawKind = String(item?.kind || '');
    const canonicalType = normalizeRoomType(item?.canonicalType || rawKind);
    const featureDef = FEATURE_CATALOG[rawKind] || FEATURE_CATALOG[canonicalType] || null;

    if (canonicalType === 'guest_bedroom') continue;

    if (featureDef) {
      out.push({
        ...featureDef,
        requestedFeatureKind: rawKind || featureDef.featureKind || canonicalType,
        requestedFeatureLabel: item?.displayLabel || featureDef.displayLabel || rawKind || canonicalType,
        featureSource: 'requested',
      });
    } else {
      out.push({
        type: canonicalType || rawKind,
        targetAreaSqFt: 115,
        minAreaSqFt: 80,
        preferredLevel: 1,
        shrinkRank: 7,
        requestedFeatureKind: rawKind || canonicalType,
        requestedFeatureLabel: item?.displayLabel || rawKind || canonicalType,
        featureSource: 'requested',
      });
    }
  }

  return out;
}

function compressRoomsToFit(levelProgram, levelAreaSqFtActual, protectedBathCount = 0, protectedBedCount = 0) {
  const hardLimit = Math.floor(levelAreaSqFtActual * 0.985);
  let assigned = totalTargetArea(levelProgram.rooms);
  if (assigned <= hardLimit) return [];

  const notes = [];

  const isBath = (r) => r.type === 'bathroom' || r.type === 'primary_bathroom' || r.type === 'powder_room';
  const isFullBath = (r) => r.type === 'bathroom' || r.type === 'primary_bathroom';
  const isBed = (r) => r.type === 'bedroom' || r.type === 'primary_bedroom' || r.type === 'guest_bedroom';

  const bathsOnLevel = () => levelProgram.rooms.filter(isFullBath).length;
  const bedsOnLevel = () => levelProgram.rooms.filter(isBed).length;

  // 1) Shrink optional requested features first.
  const featureShrinkables = [...levelProgram.rooms]
    .filter((r) => isOptionalFeatureRoom(r) && !r.fixed && r.targetAreaSqFt > r.minAreaSqFt)
    .sort((a, b) => {
      if ((b.shrinkRank || 0) !== (a.shrinkRank || 0)) return (b.shrinkRank || 0) - (a.shrinkRank || 0);
      return ((b.targetAreaSqFt - b.minAreaSqFt) || 0) - ((a.targetAreaSqFt - a.minAreaSqFt) || 0);
    });

  for (const r of featureShrinkables) {
    if (assigned <= hardLimit) break;
    const reducible = Math.max(0, r.targetAreaSqFt - r.minAreaSqFt);
    if (!reducible) continue;

    const need = assigned - hardLimit;
    const cut = Math.min(reducible, need);
    r.targetAreaSqFt -= cut;
    assigned -= cut;
  }

  // 2) Shrink non-core service rooms before touching core rooms.
  const serviceShrinkables = [...levelProgram.rooms]
    .filter((r) => !r.fixed && !isOptionalFeatureRoom(r) && !CORE_PROTECTED_TYPES.has(r.type) && r.targetAreaSqFt > r.minAreaSqFt)
    .sort((a, b) => {
      if ((b.shrinkRank || 0) !== (a.shrinkRank || 0)) return (b.shrinkRank || 0) - (a.shrinkRank || 0);
      return ((b.targetAreaSqFt - b.minAreaSqFt) || 0) - ((a.targetAreaSqFt - a.minAreaSqFt) || 0);
    });

  for (const r of serviceShrinkables) {
    if (assigned <= hardLimit) break;
    const reducible = Math.max(0, r.targetAreaSqFt - r.minAreaSqFt);
    if (!reducible) continue;

    const need = assigned - hardLimit;
    const cut = Math.min(reducible, need);
    r.targetAreaSqFt -= cut;
    assigned -= cut;
  }

  // 3) Shrink bathrooms before bedrooms, but preserve protected bath count.
  const bathShrinkables = [...levelProgram.rooms]
    .filter((r) => !r.fixed && isBath(r) && r.targetAreaSqFt > r.minAreaSqFt)
    .sort((a, b) => {
      if ((b.shrinkRank || 0) !== (a.shrinkRank || 0)) return (b.shrinkRank || 0) - (a.shrinkRank || 0);
      return ((b.targetAreaSqFt - b.minAreaSqFt) || 0) - ((a.targetAreaSqFt - a.minAreaSqFt) || 0);
    });

  for (const r of bathShrinkables) {
    if (assigned <= hardLimit) break;
    if (isFullBath(r) && bathsOnLevel() <= protectedBathCount && r.targetAreaSqFt <= r.minAreaSqFt) continue;

    const reducible = Math.max(0, r.targetAreaSqFt - r.minAreaSqFt);
    if (!reducible) continue;

    const need = assigned - hardLimit;
    const cut = Math.min(reducible, need);
    r.targetAreaSqFt -= cut;
    assigned -= cut;
  }

  // 4) Only as a late step, shrink core rooms to their true mins.
  const coreShrinkables = [...levelProgram.rooms]
    .filter((r) =>
      !r.fixed &&
      CORE_PROTECTED_TYPES.has(r.type) &&
      !NEVER_DROP_TYPES.has(r.type) &&
      r.targetAreaSqFt > r.minAreaSqFt
    )
    .sort((a, b) => {
      if ((b.shrinkRank || 0) !== (a.shrinkRank || 0)) return (b.shrinkRank || 0) - (a.shrinkRank || 0);
      return ((b.targetAreaSqFt - b.minAreaSqFt) || 0) - ((a.targetAreaSqFt - a.minAreaSqFt) || 0);
    });

  for (const r of coreShrinkables) {
    if (assigned <= hardLimit) break;
    const reducible = Math.max(0, r.targetAreaSqFt - r.minAreaSqFt);
    if (!reducible) continue;

    const need = assigned - hardLimit;
    const cut = Math.min(reducible, need);
    r.targetAreaSqFt -= cut;
    assigned -= cut;
  }

  // 5) Drop requested feature rooms if still over.
  if (assigned > hardLimit) {
    const optionalFeatures = levelProgram.rooms
      .filter((r) => isOptionalFeatureRoom(r))
      .sort((a, b) => {
        if ((b.shrinkRank || 0) !== (a.shrinkRank || 0)) return (b.shrinkRank || 0) - (a.shrinkRank || 0);
        return (b.targetAreaSqFt || 0) - (a.targetAreaSqFt || 0);
      });

    while (optionalFeatures.length && assigned > hardLimit) {
      const dropped = optionalFeatures.shift();
      levelProgram.rooms = levelProgram.rooms.filter((r) => r.id !== dropped.id);
      assigned -= dropped.targetAreaSqFt;
      notes.push(`Dropped feature room "${dropped.requestedFeatureLabel || dropped.type}" on level ${levelProgram.level}: insufficient area.`);
    }
  }

  // 6) Emergency prune service/non-core rooms.
  if (assigned > levelAreaSqFtActual * 1.02) {
    const droppable = levelProgram.rooms
      .filter((r) => !NEVER_DROP_TYPES.has(r.type) && !r.fixed && !r.protectFromDrop && !isOptionalFeatureRoom(r))
      .sort((a, b) => {
        if ((b.shrinkRank || 0) !== (a.shrinkRank || 0)) return (b.shrinkRank || 0) - (a.shrinkRank || 0);
        return (b.targetAreaSqFt || 0) - (a.targetAreaSqFt || 0);
      });

    while (droppable.length && assigned > hardLimit) {
      const candidate = droppable.shift();
      if (isFullBath(candidate) && bathsOnLevel() <= protectedBathCount) continue;
      if (isBed(candidate) && bedsOnLevel() <= protectedBedCount) continue;

      levelProgram.rooms = levelProgram.rooms.filter((r) => r.id !== candidate.id);
      assigned -= candidate.targetAreaSqFt || 0;
      notes.push(`Pruned "${candidate.type}" on level ${levelProgram.level}: footprint too small.`);
    }
  }

  // 7) Viability check. Drop the most fragile optional/service rooms instead of
  // rendering postage-stamp rooms when level pressure is still too high.
  const DROPPABLE_TYPES = new Set([
    'bathroom',
    'powder_room',
    'bedroom',
    'guest_bedroom',
    'mudroom',
    'laundry',
    'study',
    'gym',
    'library',
    'gaming_room',
    'movie_room',
    'wine_cellar',
    'music_room',
  ]);

  const viabilityMin = (r) => {
    if (r.type === 'powder_room') return Math.max(30, Math.round((r.minAreaSqFt || 24) * 1.1));
    if (r.type === 'bathroom' || r.type === 'primary_bathroom') return Math.max(40, Math.round((r.minAreaSqFt || 24) * 1.1));
    if (r.type === 'bedroom' || r.type === 'guest_bedroom') return Math.max(90, Math.round((r.minAreaSqFt || 24) * 1.05));
    return Math.round((r.minAreaSqFt || 24) * 1.2);
  };

  const nonFixedRooms = levelProgram.rooms.filter(
    (r) => !r.fixed && DROPPABLE_TYPES.has(r.type) && !NEVER_DROP_TYPES.has(r.type)
  );
  const totalAssigned = totalTargetArea(levelProgram.rooms);
  const pressureRatio = totalAssigned / Math.max(1, levelAreaSqFtActual);

  if (pressureRatio > 0.88) {
    const viabilityDropCandidates = [...nonFixedRooms].sort((a, b) => {
      if (Boolean(isRequestedFeatureRoom(a)) !== Boolean(isRequestedFeatureRoom(b))) {
        return isRequestedFeatureRoom(a) ? -1 : 1;
      }
      if (Boolean(isOptionalFeatureRoom(a)) !== Boolean(isOptionalFeatureRoom(b))) {
        return isOptionalFeatureRoom(a) ? -1 : 1;
      }
      if ((b.shrinkRank || 0) !== (a.shrinkRank || 0)) return (b.shrinkRank || 0) - (a.shrinkRank || 0);
      return (a.targetAreaSqFt || 0) - (b.targetAreaSqFt || 0);
    });

    for (const r of viabilityDropCandidates) {
      if (r.protectFromDrop || isRequestedFeatureRoom(r)) continue;
      if (isFullBath(r) && bathsOnLevel() <= protectedBathCount) continue;
      if (isBed(r) && bedsOnLevel() <= protectedBedCount) continue;

      const minViable = viabilityMin(r);
      const estimatedActual = r.targetAreaSqFt / pressureRatio;

      if (estimatedActual < minViable) {
        levelProgram.rooms = levelProgram.rooms.filter((x) => x.id !== r.id);
        assigned -= r.targetAreaSqFt || 0;
        notes.push(`Dropped "${r.requestedFeatureLabel || r.type}" on level ${levelProgram.level}: would render below minimum viable size (est. ${Math.round(estimatedActual)}sqft < ${minViable}sqft).`);
      }
    }
  }

  return notes;
}

function distributeSlack(levelPrograms, footprint) {
  for (const levelProgram of levelPrograms) {
    const assignedArea = totalTargetArea(levelProgram.rooms);
    const slack = Math.max(0, footprint.levelAreaSqFtActual - assignedArea);

    if (!slack) continue;

    const requestedFeatures = levelProgram.rooms.filter((r) => isRequestedFeatureRoom(r));
    const living = levelProgram.rooms.find((r) => r.type === 'living_room');
    const kitchen = levelProgram.rooms.find((r) => r.type === 'kitchen');
    const dining = levelProgram.rooms.find((r) => r.type === 'dining_room');
    const featureShare = requestedFeatures.length ? Math.round(slack * 0.12) : 0;
    const publicSlack = Math.max(0, slack - featureShare);

    if (requestedFeatures.length && featureShare > 0) {
      const perFeature = Math.floor(featureShare / requestedFeatures.length);
      let remainder = featureShare - (perFeature * requestedFeatures.length);
      for (const room of requestedFeatures) {
        room.targetAreaSqFt += perFeature + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
      }
    }
    if (living) living.targetAreaSqFt += Math.round(publicSlack * 0.48);
    if (kitchen) kitchen.targetAreaSqFt += Math.round(publicSlack * 0.30);
    if (dining) dining.targetAreaSqFt += Math.round(publicSlack * 0.22);
  }
}

function buildProgramFromBrief(brief, footprint) {
  const stories = brief.stories;
  let roomIdCounter = 1;
  const nextId = (prefix) => `${prefix}_${roomIdCounter++}`;

  const primaryLevel = brief.primaryLevel;
  const levelPrograms = Array.from({ length: stories }, (_, idx) => ({
    level: idx + 1,
    rooms: [],
  }));

  const notes = [];

  // For very small 2-story footprints, aggressively simplify before room creation
  // to prevent undersized rooms and stair alignment issues.
  const levelArea = footprint.levelAreaSqFtActual;
  if (stories === 2) {
    if (levelArea < 400) {
      if (brief.bedrooms > 2) {
        brief = { ...brief, bedrooms: 2 };
        notes.push('Capped bedrooms to 2: footprint too small for 2-story plan.');
      }
      if (brief.bathrooms > 2) {
        brief = { ...brief, bathrooms: 2 };
        notes.push('Capped bathrooms to 2: footprint too small for 2-story plan.');
      }
      if (brief.hasGarage && brief.bedrooms > 1) {
        brief = { ...brief, bedrooms: 1 };
        notes.push('Capped bedrooms to 1: tiny 2-story garage plan cannot fit more.');
      }
    } else if (levelArea < 500 && brief.hasGarage) {
      if (brief.bathrooms > brief.bedrooms) {
        brief = { ...brief, bathrooms: brief.bedrooms };
        notes.push('Capped bathrooms to match bedrooms: compact 2-story garage plan.');
      }
    }
  }

  // Room sizing modifiers from survey + area tier
  const tier = sizeTier(brief.totalAreaSqFt);

  // Ceiling height -> scale up targets so proportions look right in plan view
  const cs = Number(brief.ceilingAreaScale) || 1.0;

  // Budget tier -> luxury homes get larger rooms, entry homes get tighter ones
  const budgetScale =
    brief.budgetTier === 'LUXURY' ? 1.12 :
    brief.budgetTier === 'ENTRY' ? 0.92 : 1.0;

  // Area-tier scale to avoid "same layout, just bigger scale" at higher sqft.
  const tierScaleByArea = {
    T1: 0.86,
    T2: 0.96,
    T3: 1.04,
    T4: 1.14,
    T5: 1.22,
  };
  const tierScale = tierScaleByArea[tier] || 1.0;

  const publicScale =
    tierScale *
    (brief.indoorOutdoor === 'MAXIMUM' ? 1.08 : brief.indoorOutdoor === 'MINIMAL' ? 0.94 : 1.0);

  const privateScale = tierScale * (tier === 'T4' || tier === 'T5' ? 1.05 : 1.0);

  const circulationScale =
    tier === 'T1' ? 0.85 :
    tier === 'T2' ? 0.95 :
    tier === 'T3' ? 1.05 :
    tier === 'T4' ? 1.15 : 1.22;

  const livingBonus =
    (brief.indoorOutdoor === 'MAXIMUM' ? 40 : brief.indoorOutdoor === 'MINIMAL' ? -18 : 0) +
    (brief.naturalLight === 'MAXIMUM' ? 12 : brief.naturalLight === 'MINIMAL' ? -8 : 0);

  const diningBonus =
    (brief.lotContext === 'VIEW' || brief.lotContext === 'WATERFRONT') ? 16 :
    (brief.lotContext === 'URBAN' ? -10 : 0);

  const kitchenBonus =
    brief.naturalLight === 'MAXIMUM' ? 14 :
    brief.naturalLight === 'MINIMAL' ? -10 : 0;

  const scale = cs * budgetScale;
  const minScale = tinyHomeMinScale(brief.totalAreaSqFt);

  const accessBathBonus = (brief.accessibility?.wideDoors) ? 16 : 0;
  const accessBedBonus = (brief.accessibility?.wheelchair) ? 24 : 0;

  const ceilingHeightType = brief.ceilingHeight || 'STANDARD';
  const floorToFloorFt = 
    ceilingHeightType === 'CATHEDRAL' ? 13 : // 12ft + 1ft joist
    ceilingHeightType === 'TALL'      ? 11 : // 10ft + 1ft joist
                                        10;  // 9ft  + 1ft joist
                                        
  const riseFt = 15 / 30.48;  // 15cm rise
  const treadFt = 25 / 30.48; // 25cm tread
  const stairSteps = Math.ceil(floorToFloorFt / riseFt);
  const stairRunFt = (stairSteps - 1) * treadFt;
  const stairWidthFt = 3.5;
  const stairLandingsArea = 12; // sqft
  const rawStairArea = Math.round(stairRunFt * stairWidthFt + stairLandingsArea);

  const stairTargetArea = Math.round(rawStairArea * circulationScale);
  // Level 1 hallway is a proper corridor; level 2 is just a landing off the stairs.
  // Keeping level 2 small avoids the wide hallway strips that consume bedroom space.
  const hallTargetArea   = Math.round(60 * circulationScale); // level 1 (or 1-storey)
  const hall2TargetArea  = Math.round(44 * circulationScale); // level 2: ~4 ft × 11 ft

  if (stories === 2) {
    for (const levelProgram of levelPrograms) {
      levelProgram.rooms.push(room(nextId('stairs'), 'stairs', levelProgram.level, stairTargetArea, {
        fixed: true,
        priority: 1,
        shrinkRank: 0,
        minAreaSqFt: stairTargetArea,
        protectFromDrop: true,
      }));

      const isL2 = levelProgram.level === 2;
      levelProgram.rooms.push(room(nextId('hall'), 'hallway', levelProgram.level, isL2 ? hall2TargetArea : hallTargetArea, {
        fixed: true,
        priority: 1,
        shrinkRank: 8,
        minAreaSqFt: isL2 ? 28 : 48, // level 2: 4 ft × 7 ft minimum
        protectFromDrop: true,
      }));
    }
  } else {
    levelPrograms[0].rooms.push(room(nextId('hall'), 'hallway', 1, hallTargetArea, {
      fixed: true,
      priority: 1,
      shrinkRank: 8,
      minAreaSqFt: 36,
      protectFromDrop: true,
    }));
  }

  if (brief.hasGarage) {
    levelPrograms[0].rooms.push(room(nextId('garage'), 'garage', 1, garageAreaSqFt(brief.garageType), {
      fixed: true,
      priority: 1,
      shrinkRank: 0,
      minAreaSqFt: garageAreaSqFt(brief.garageType),
      protectFromDrop: true,
    }));
  }

  levelPrograms[0].rooms.push(room(
    nextId('living'),
    'living_room',
    1,
    Math.round((brief.openConcept ? 235 : 215) * scale * publicScale) + livingBonus,
    {
      minAreaSqFt: Math.max(150, Math.round(150 * minScale)),
      priority: 1,
      shrinkRank: 6,
      protectFromDrop: true,
    }
  ));

  levelPrograms[0].rooms.push(room(
    nextId('dining'),
    'dining_room',
    1,
    Math.round((brief.openConcept ? 125 : 150) * scale * publicScale) + diningBonus,
    {
      minAreaSqFt: Math.max(85, Math.round(85 * minScale)),
      priority: 1,
      shrinkRank: 6,
      protectFromDrop: true,
    }
  ));

  levelPrograms[0].rooms.push(room(
    nextId('kitchen'),
    'kitchen',
    1,
    Math.round(155 * scale * publicScale) + kitchenBonus,
    {
      minAreaSqFt: Math.max(110, Math.round(110 * minScale)),
      priority: 1,
      shrinkRank: 5,
      protectFromDrop: true,
    }
  ));

  const primaryBed = addRoom(
    levelPrograms,
    primaryLevel,
    makePrimaryBedroom(
      nextId('primarybed'),
      primaryLevel,
      brief.stories,
      (scale * privateScale) + accessBedBonus / 260,
      minScale
    )
  );
  // Apply primary bedroom closet type from per-bedroom config (index 0).
  primaryBed.programId = 'primary';
  if (brief.bedroomClosets?.[0] && primaryBed.closet) {
    primaryBed.closet.type = brief.bedroomClosets[0]; // 'walk_in' or 'reach_in'
  }

  if (brief.primaryEnsuiteRequested !== false) {
    const primaryBath = addRoom(
      levelPrograms,
      primaryLevel,
      makePrimaryBathroom(
        nextId('primarybath'),
        primaryLevel,
        (scale * privateScale) + accessBathBonus / 95,
        minScale
      )
    );
    primaryBath.attachedTo = primaryBed.id;
  }

  const secondaryBedrooms = [];
  let remainingSecondaryBedrooms = Math.max(0, brief.bedrooms - 1);
  const balanceUpperSecondaryBedrooms =
    stories === 2 &&
    primaryLevel === 2 &&
    brief.bedrooms >= 4 &&
    brief.totalAreaSqFt >= 3600;

  // Track secondary bedroom index to map into brief.bedroomClosets (which is indexed from 0=primary).
  let secondaryBedIndex = 0;

  const guestBedroomCount = Number(brief.featureCounts?.guest_bedroom || 0);
  for (let i = 0; i < guestBedroomCount && remainingSecondaryBedrooms > 0; i++) {
    const targetLevel = 1;
    const guestBed = addRoom(
      levelPrograms,
      targetLevel,
      makeSecondaryBedroom(nextId('guestbed'), targetLevel, 'guest_bedroom', scale * privateScale, minScale)
    );
    if (brief.bedroomClosets?.[secondaryBedIndex + 1] && guestBed.closet) {
      guestBed.closet.type = brief.bedroomClosets[secondaryBedIndex + 1];
    }
    secondaryBedrooms.push(guestBed);
    guestBed.programId = `bedroom_${secondaryBedIndex + 2}`;
    remainingSecondaryBedrooms -= 1;
    secondaryBedIndex++;
  }

  for (let i = 0; i < remainingSecondaryBedrooms; i++) {
    const targetLevel = brief.stories === 1
      ? 1
      : (balanceUpperSecondaryBedrooms && i === 0 ? 1 : 2);
    const bed = addRoom(
      levelPrograms,
      targetLevel,
      makeSecondaryBedroom(nextId('bed'), targetLevel, 'bedroom', scale * privateScale, minScale)
    );
    if (brief.bedroomClosets?.[secondaryBedIndex + 1] && bed.closet) {
      bed.closet.type = brief.bedroomClosets[secondaryBedIndex + 1];
    }
    secondaryBedrooms.push(bed);
    bed.programId = `bedroom_${secondaryBedIndex + 2}`;
    secondaryBedIndex++;
  }
  if (balanceUpperSecondaryBedrooms && remainingSecondaryBedrooms > 0) {
    notes.push('Balanced one secondary bedroom onto level 1 to keep the upstairs bedroom cluster circulation-safe.');
  }

  const totalBathroomsRequested = Math.max(1, brief.bathrooms);
  let secondaryBathBudget = Math.max(0, totalBathroomsRequested - Number(brief.primaryEnsuiteRequested !== false));

  const bonusPowderNeeded =
    brief.stories === 2 &&
    brief.bedrooms === brief.bathrooms &&
    primaryLevel === 1;

  let privateSecondaryEnsuites = 0;

  if (brief.privateBathsRequested !== null && brief.privateBathsRequested !== undefined) {
    privateSecondaryEnsuites = Math.min(
      brief.privateBathsRequested,
      secondaryBedrooms.length,
      secondaryBathBudget
    );
  } else {
    if (brief.bathrooms > brief.bedrooms) {
      privateSecondaryEnsuites = Math.min(secondaryBathBudget, secondaryBedrooms.length);
    } else if (brief.bathrooms === brief.bedrooms && primaryLevel === 1) {
      privateSecondaryEnsuites = Math.min(secondaryBathBudget, secondaryBedrooms.length);
    }
  }

  const explicitBedroomChoices = Array.isArray(brief.raw?.bedroomConfigs);
  const privateBedroomIds = new Set((brief.bedroomProgram || []).filter(b => b.privateBath).map(b => b.programId));
  const privateBedrooms = explicitBedroomChoices
    ? secondaryBedrooms.filter(b => privateBedroomIds.has(b.programId))
    : secondaryBedrooms.slice(0, privateSecondaryEnsuites);
  for (const bed of privateBedrooms) {
    addRoom(
      levelPrograms,
      bed.level,
      makePrivateSecondaryBath(nextId('ensuite'), bed.level, bed.id, minScale)
    );
    secondaryBathBudget -= 1;
  }

  const bedsWithoutPrivateBath = secondaryBedrooms.filter(b => !privateBedrooms.includes(b));
  const level1BedsWithoutPrivate = bedsWithoutPrivateBath.filter((b) => b.level === 1);
  const level2BedsWithoutPrivate = bedsWithoutPrivateBath.filter((b) => b.level === 2);
  const needsUpperSharedBath =
    brief.stories === 2 &&
    primaryLevel === 2 &&
    level2BedsWithoutPrivate.length > 0;
  let upperSharedBathAdded = false;

  const needLevel1GuestBath =
    brief.stories === 1 ||
    primaryLevel === 2 ||
    level1BedsWithoutPrivate.length > 0 ||
    bonusPowderNeeded;

  if (needsUpperSharedBath) {
    if (secondaryBathBudget > 0) {
      addRoom(levelPrograms, 2, makeSharedBathroom(nextId('bath'), 2, 68, 'shared', scale, minScale));
      secondaryBathBudget -= 1;
      upperSharedBathAdded = true;
    } else {
      addRoom(levelPrograms, 2, makeSharedBathroom(nextId('bath'), 2, 68, 'shared', scale, minScale));
      notes.push('Added a shared upstairs bathroom to preserve circulation and bedroom usability.');
      upperSharedBathAdded = true;
    }
  }

  const preferPowderOverFullGuestBath =
    needLevel1GuestBath &&
    brief.stories === 2 &&
    primaryLevel === 2 &&
    level2BedsWithoutPrivate.length > 0 &&
    level1BedsWithoutPrivate.length === 0;

  if (needLevel1GuestBath && secondaryBathBudget > 0 && !preferPowderOverFullGuestBath) {
    const guestBathType = bonusPowderNeeded ? 'powder' : 'shared';
    if (guestBathType === 'powder') {
      addRoom(levelPrograms, 1, makePowderRoom(nextId('powder'), 1, minScale));
    } else {
      addRoom(levelPrograms, 1, makeSharedBathroom(nextId('bath'), 1, 56, 'guest', scale, minScale));
    }
    secondaryBathBudget -= 1;
  } else if (bonusPowderNeeded || preferPowderOverFullGuestBath) {
    addRoom(levelPrograms, 1, makePowderRoom(nextId('powder'), 1, minScale));
    if (bonusPowderNeeded) {
      notes.push('Added a guest powder room on level 1 because the primary suite is on level 1 and bedroom/bathroom counts were equal.');
    } else {
      notes.push('Reserved the remaining full-bath budget for the upstairs bedroom floor and converted the level-1 guest bath to a powder room.');
    }
  }

  if (!upperSharedBathAdded && brief.stories === 2 && level2BedsWithoutPrivate.length > 0) {
    if (secondaryBathBudget > 0) {
      addRoom(levelPrograms, 2, makeSharedBathroom(nextId('bath'), 2, 68, 'shared', scale, minScale));
      secondaryBathBudget -= 1;
    } else {
      addRoom(levelPrograms, 2, makeSharedBathroom(nextId('bath'), 2, 68, 'shared', scale, minScale));
      notes.push('Added a shared upstairs bathroom to preserve circulation and bedroom usability.');
    }
  }

  while (secondaryBathBudget > 0) {
    addRoom(levelPrograms, 1, makeSharedBathroom(nextId('bath'), 1, 52, 'guest', scale, minScale));
    secondaryBathBudget -= 1;
  }

  // Safety: 2-story plans must always have at least one bathroom on level 1 for
  // guests. This can be missed when all bath budget is consumed by private ensuites
  // (e.g. 2bed/2bath/1privateBath/primaryLevel=2: budget=1, ensuite takes it, done).
  if (brief.stories === 2) {
    const level1HasBath = (levelPrograms[0]?.rooms || []).some(
      (r) => r.type === 'bathroom' || r.type === 'primary_bathroom' || r.type === 'powder_room'
    );
    if (!level1HasBath) {
      addRoom(levelPrograms, 1, makePowderRoom(nextId('powder'), 1, minScale));
      notes.push('Added a guest powder room on level 1 — public spaces require at least one bathroom for visitors.');
    }
  }

  if (brief.hasGarage) {
    levelPrograms[0].rooms.push(room(nextId('mudroom'), 'mudroom', 1, 64, {
      minAreaSqFt: 48,
      maxAreaSqFt: 96,
      priority: 1,
      shrinkRank: 6,
    }));
  }

  const laundryLevel = Math.min(
    stories,
    brief.laundryLevel || (stories === 1 ? 1 : (brief.primaryLevel === 1 ? 1 : 2))
  );

  levelPrograms[laundryLevel - 1].rooms.push(room(nextId('laundry'), 'laundry', laundryLevel, 64, {
    minAreaSqFt: 48,
    maxAreaSqFt: 96,
    priority: 1,
    shrinkRank: 7,
    protectFromDrop: true,
  }));

  const featureEntries = normalizeFeatureEntries(brief.requestedFeatureItems);
  const hasUpperQuietFocusFeature =
    featureEntries.length > 1 &&
    featureEntries.some((feature) => String(feature?.placementFamily || '') === 'quiet_focus');

  for (const feature of featureEntries) {
    // For 2-story garage plans with primaryLevel=2, level 1 is already packed with
    // garage + core living rooms; feature rooms have no space there and get dropped
    // by pruneFeatureRoomsBeforeCompression. Place them on level 2 instead, where
    // the large storage block gives allocateTwoStoryLevel2 room to fit them.
    const targetLevel = stories === 1 ? 1
      : (brief?.hasGarage && brief?.primaryLevel === 2
          ? (
              hasUpperQuietFocusFeature && String(feature?.placementFamily || '') !== 'quiet_focus'
                ? (feature.preferredLevel || 1)
                : 2
            )
          : (feature.preferredLevel || 1));
    addRoom(levelPrograms, targetLevel, room(
      nextId(feature.type),
      feature.type,
      targetLevel,
      feature.targetAreaSqFt,
      {
        minAreaSqFt: feature.minAreaSqFt,
        priority: 2,
        shrinkRank: feature.shrinkRank,
        requestedFeature: true,
        isFeatureRoom: true,
        featureSource: 'requested',
        requestedFeatureKind: feature.requestedFeatureKind || feature.featureKind || feature.type,
        requestedFeatureLabel: feature.requestedFeatureLabel || feature.displayLabel || feature.type,
        featurePlacementFamily: feature.placementFamily || null,
      }
    ));
  }

  if (
    stories === 1 &&
    brief.totalAreaSqFt <= 1650 &&
    featureEntries.some((feature) => String(feature?.placementFamily || '') === 'quiet_focus')
  ) {
    const l1Rooms = levelPrograms[0]?.rooms || [];
    const trimTargets = [
      ['living_room', 24],
      ['dining_room', 18],
      ['kitchen', 16],
      ['hallway', 12],
    ];
    for (const [type, amount] of trimTargets) {
      const roomSpec = l1Rooms.find((roomSpec) => roomSpec.type === type);
      if (!roomSpec) continue;
      const minArea = Number(roomSpec.minAreaSqFt) || 0;
      roomSpec.targetAreaSqFt = Math.max(minArea, (Number(roomSpec.targetAreaSqFt) || 0) - amount);
    }
    notes.push('Rebalanced core public-room targets to preserve a requested quiet-focus room on a compact single-story footprint.');
  }

  const explicitFeatureCount = featureEntries.length;
  const shouldSkipDefaultUpperLoft =
    stories === 2 &&
    brief.primaryLevel === 2 &&
    brief.bedrooms >= 3 &&
    brief.bathrooms >= 3 &&
    explicitFeatureCount === 0;
  if (explicitFeatureCount === 0 && (brief.allowDefaultFeatureRooms || brief.totalAreaSqFt >= 3000)) {
    if ((tier === 'T4' || tier === 'T5') && brief.bedrooms >= 3) {
      addRoom(levelPrograms, 1, room(nextId('default_flex'), 'study', 1, Math.round(125 * scale), {
        minAreaSqFt: 90,
        priority: 2,
        shrinkRank: 6,
        requestedFeature: false,
        isFeatureRoom: true,
        featureSource: 'default',
        requestedFeatureKind: 'default_flex',
        requestedFeatureLabel: 'Flex Room',
        featurePlacementFamily: 'quiet_focus',
      }));
      notes.push('Added default flex room for large-home tier differentiation.');
    } else if (
      tier === 'T3' &&
      brief.totalAreaSqFt >= 2400 &&
      stories === 2 &&
      brief.bedrooms >= 3 &&
      !shouldSkipDefaultUpperLoft
    ) {
      addRoom(levelPrograms, 2, room(nextId('default_loft'), 'study', 2, Math.round(110 * scale), {
        minAreaSqFt: 80,
        priority: 2,
        shrinkRank: 6,
        requestedFeature: false,
        isFeatureRoom: true,
        featureSource: 'default',
        requestedFeatureKind: 'default_loft',
        requestedFeatureLabel: 'Flex Loft',
        featurePlacementFamily: 'quiet_focus',
      }));
      notes.push('Added upstairs flex/study for mid-large tier differentiation.');
    }
  }

  // Phase 4: trim optional program load before compression so core rooms are not
  // forced to absorb feature pressure.
  pruneFeatureRoomsBeforeCompression(levelPrograms, footprint, notes);

  for (const levelProgram of levelPrograms) {
    const bathsOnThisLevel = levelProgram.rooms.filter(
      (r) => r.type === 'bathroom' || r.type === 'primary_bathroom'
    ).length;

    const bedsOnThisLevel = levelProgram.rooms.filter(
      (r) => r.type === 'bedroom' || r.type === 'primary_bedroom' || r.type === 'guest_bedroom'
    ).length;

    const levelNotes = compressRoomsToFit(
      levelProgram,
      footprint.levelAreaSqFtActual,
      bathsOnThisLevel,
      bedsOnThisLevel
    );

    notes.push(...levelNotes);
  }

  distributeSlack(levelPrograms, footprint);
  attachRoomContracts(levelPrograms, brief);

  return {
    stories: brief.stories,
    levels: levelPrograms,
    notes,
    relaxations: {
      droppedRooms: notes
        .filter((n) => n.startsWith('Dropped') || n.startsWith('Pruned'))
        .map((n) => {
          const m = n.match(/"([^"]+)"/);
          return m ? m[1] : null;
        })
        .filter(Boolean),
      tinyPlanCapped: notes.some((n) => n.startsWith('Capped')),
      addedFallbackBath: notes.some((n) => n.includes('shared upstairs bathroom')),
    },
  };
}

module.exports = {
  buildProgramFromBrief,
};
