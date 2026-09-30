'use strict';

const { buildRoomContract } = require('../roomContractBuilder');
const { buildRealmGraphV2 } = require('./graph/graphBuilderV2');

function makeIdFactory(prefix = 'v2') {
  let counter = 1;
  return (type) => `${prefix}_${String(type || 'room').replace(/[^\w]+/g, '_')}_${counter++}`;
}

function classifyZone(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'living_room' || normalized === 'dining_room' || normalized === 'kitchen' || normalized === 'loft') return 'public';
  if (
    normalized === 'primary_bedroom' ||
    normalized === 'bedroom' ||
    normalized === 'guest_bedroom' ||
    normalized === 'study' ||
    normalized === 'library' ||
    normalized === 'gym' ||
    normalized === 'gaming_room' ||
    normalized === 'playroom' ||
    normalized === 'movie_room' ||
    normalized === 'music_room'
  ) {
    return 'private';
  }
  if (normalized === 'wine_cellar') return 'service';
  if (normalized === 'stairs' || normalized === 'hallway' || normalized === 'entry') return 'circulation';
  return 'service';
}

function makeSpec(nextId, type, level, extras = {}) {
  const spec = {
    id: nextId(type),
    type,
    level,
    zone: extras.zone || classifyZone(type),
    label: extras.label || null,
    bathroomUse: extras.bathroomUse || null,
    attachedTo: extras.attachedTo || null,
    requestedFeature: false,
    ...extras,
  };
  spec.roomContract = extras.roomContract || buildRoomContract(spec, extras.brief || null);
  return spec;
}

function supportedSpecialFeatures(brief) {
  return (Array.isArray(brief?.requestedFeatureItems) ? brief.requestedFeatureItems : [])
    .map((item) => String(item?.canonicalType || '').trim().toLowerCase())
    .filter((type) => [
      'study',
      'library',
      'gym',
      'gaming_room',
      'playroom',
      'movie_room',
      'music_room',
      'wine_cellar',
      'guest_bedroom',
    ].includes(type));
}

const FEATURE_ROOM_CONFIG = {
  study:   { minAreaSqFt: 100, preferLoft: true,  label: 'Study',   placementFamily: 'quiet_focus' },
  library: { minAreaSqFt: 140, preferLoft: true,  label: 'Library', placementFamily: 'quiet_focus' },
  gym:     { minAreaSqFt: 180, preferLoft: false, label: 'Gym',     placementFamily: 'wellness_edge' },
  gaming_room: { minAreaSqFt: 140, preferLoft: false, label: 'Gaming Room', placementFamily: 'entertainment_edge' },
  playroom: { minAreaSqFt: 140, preferLoft: false, label: 'Playroom', placementFamily: 'family_play' },
  movie_room: { minAreaSqFt: 150, preferLoft: false, label: 'Movie Room', placementFamily: 'entertainment_edge' },
  music_room: { minAreaSqFt: 120, preferLoft: false, label: 'Music Room', placementFamily: 'quiet_focus' },
  wine_cellar: { minAreaSqFt: 80, preferLoft: false, label: 'Wine Cellar', placementFamily: 'service_edge' },
  guest_bedroom: { minAreaSqFt: 130, preferLoft: true, label: 'Guest Bedroom', placementFamily: 'upper_loft_reuse' },
};

function specialFeaturePlacement(featureType, interpretation, brief) {
  const area = Number(brief?.totalAreaSqFt || 0);
  const config = FEATURE_ROOM_CONFIG[featureType] || FEATURE_ROOM_CONFIG.study;
  const pattern = String(interpretation?.housePattern || '');
  const isTwoBedGaragePattern = pattern === 'two_story_upper_primary_with_garage' || pattern === 'two_story_upper_primary_with_garage_study';
  const isThreeBedPattern =
    pattern === 'two_story_upper_primary_with_garage_three_bed' ||
    pattern === 'two_story_upper_primary_three_bed_compact';
  const isThreeBedCompactNoGaragePattern = pattern === 'two_story_upper_primary_three_bed_compact';

  if (
    featureType === 'gym' &&
    isThreeBedPattern &&
    area >= (isThreeBedCompactNoGaragePattern ? 2200 : 2100)
  ) {
    return {
      level: 2,
      placementFamily: 'upper_wellness_swap',
      minFeatureAreaSqFt: config.minAreaSqFt,
    };
  }

  // Loft reuse on the three-bed upper pattern when area is sufficient and feature prefers loft
  if (
    config.preferLoft &&
    isThreeBedPattern &&
    area >= 2200
  ) {
    return {
      level: 2,
      placementFamily: 'upper_loft_reuse',
      minFeatureAreaSqFt: config.minAreaSqFt,
    };
  }

  // The routed 2-bed upper-garage family already has a reusable upper support/loft slot.
  // Library and gym can use that slot cleanly without creating a new lower-floor branch.
  if (
    isTwoBedGaragePattern &&
    ['library', 'gym', 'gaming_room', 'guest_bedroom'].includes(featureType) &&
    area >= Math.max(2000, config.minAreaSqFt * 10)
  ) {
    return {
      level: 2,
      placementFamily: 'upper_support_reuse',
      minFeatureAreaSqFt: config.minAreaSqFt,
    };
  }

  if (featureType === 'wine_cellar') {
    return {
      level: 1,
      placementFamily: 'service_edge',
      minFeatureAreaSqFt: config.minAreaSqFt,
    };
  }

  // Gym: prefer near service side on level 1
  // Study/library: quiet focus on level 1 if not going to loft
  return {
    level: 1,
    placementFamily: config.placementFamily,
    minFeatureAreaSqFt: config.minAreaSqFt,
  };
}

function plannedSpecialFeatureRooms(brief, interpretation) {
  const requested = supportedSpecialFeatures(brief);
  if (!requested.length) return [];

  // Each occurrence is a separate room instance, even when types repeat.
  const isStudyGymCombo =
    requested.length === 2 &&
    requested.includes('study') &&
    requested.includes('gym') &&
    Number(interpretation?.stories) === 2 &&
    Number(interpretation?.bedrooms) === 3 &&
    Number(interpretation?.bathrooms) === 3 &&
    Number(brief?.totalAreaSqFt || 0) >= 3000;
  const isLibraryGymCombo =
    requested.length === 2 &&
    requested.includes('library') &&
    requested.includes('gym') &&
    Number(interpretation?.stories) === 2 &&
    Number(interpretation?.bedrooms) === 3 &&
    Number(interpretation?.bathrooms) === 3 &&
    Number(brief?.totalAreaSqFt || 0) >= 3200;

  if (isStudyGymCombo) {
    return [
      {
        featureType: 'study',
        placement: {
          level: 2,
          placementFamily: 'upper_loft_reuse',
          minFeatureAreaSqFt: FEATURE_ROOM_CONFIG.study.minAreaSqFt,
        },
      },
      {
        featureType: 'gym',
        placement: {
          level: 1,
          placementFamily: 'wellness_edge',
          minFeatureAreaSqFt: FEATURE_ROOM_CONFIG.gym.minAreaSqFt,
        },
      },
    ];
  }
  if (isLibraryGymCombo) {
    return [
      {
        featureType: 'library',
        placement: {
          level: 2,
          placementFamily: 'upper_loft_reuse',
          minFeatureAreaSqFt: FEATURE_ROOM_CONFIG.library.minAreaSqFt,
        },
      },
      {
        featureType: 'gym',
        placement: {
          level: 1,
          placementFamily: 'wellness_edge',
          minFeatureAreaSqFt: FEATURE_ROOM_CONFIG.gym.minAreaSqFt,
        },
      },
    ];
  }

  if (requested.length === 2 && Number(interpretation.stories) === 2 && Number(interpretation.bedrooms) === 3) {
    const upperType = ['study','library','guest_bedroom'].find(type => requested.includes(type));
    const upperIndex = requested.indexOf(upperType);
    if (upperType) return requested.map((featureType, index) => ({ featureType, placement: {
      level: index === upperIndex ? 2 : 1,
      placementFamily: index === upperIndex ? 'upper_loft_reuse' : FEATURE_ROOM_CONFIG[featureType].placementFamily,
      minFeatureAreaSqFt: FEATURE_ROOM_CONFIG[featureType].minAreaSqFt,
    } }));
  }

  return requested.map((featureType) => ({
    featureType,
    placement: specialFeaturePlacement(featureType, interpretation, brief),
  }));
}

function pushSharedBathrooms(target, count, nextId, level, brief) {
  for (let index = 0; index < count; index++) {
    target.push(makeSpec(nextId, 'bathroom', level, {
      bathroomUse: index === 0 ? 'shared' : 'shared_extra',
      brief,
    }));
  }
}

function buildProgramV2(brief, interpretation, footprint = null) {
  if (interpretation.stories === 2 && interpretation.bedrooms === 5 && interpretation.primaryLevel !== 1) {
    // Reuse the existing lower quiet-room position as a real fifth bedroom.
    // (With the primary suite on the main floor, the other four bedrooms are
    // all upstairs: patterns/twoStoryMainPrimary.)
    // Four bedrooms remain upstairs, including the primary; the fifth has
    // independent ground-floor access. Bedroom fit/daylight validators still
    // apply, so a study-sized slot cannot masquerade as a usable bedroom.
    const workingBrief = { ...brief, bedrooms: 4,
      requestedFeatureItems: [{ canonicalType: 'study', kind: 'study', displayLabel: 'Study' }] };
    const program = buildProgramV2(workingBrief, { ...interpretation, bedrooms: 4 });
    const extra = program.levels[0].rooms.find(room => room.requestedFeature && room.type === 'study');
    if (!extra) throw new Error('Five-bedroom family needs a ground-floor sleeping room');
    extra.type = 'bedroom';
    extra.programId = 'bedroom_5';
    extra.label = 'Bedroom 5';
    extra.requestedFeature = false;
    extra.requestedFeatureKind = null;
    extra.targetAreaSqFt = Math.max(140, extra.targetAreaSqFt || 0);
    extra.roomContract = null;
    extra.roomContract = buildRoomContract(extra, brief);
    const node = program.graph?.nodes?.find(item => item.roomId === extra.id);
    if (node) { node.type = 'bedroom'; node.programId = extra.programId; node.requestedFeatureKind = null; }
    program.interpretation = interpretation;
    return program;
  }
  const nextId = makeIdFactory('architect_v2');
  const levelPrograms = Array.from({ length: interpretation.stories }, (_, index) => ({
    level: index + 1,
    rooms: [],
  }));
  const level1 = levelPrograms[0].rooms;
  const level2 = levelPrograms[1]?.rooms || null;

  level1.push(makeSpec(nextId, 'living_room', 1, { brief }));
  level1.push(makeSpec(nextId, 'dining_room', 1, { brief }));
  level1.push(makeSpec(nextId, 'kitchen', 1, { brief }));
  level1.push(makeSpec(nextId, 'entry', 1, { brief }));
  // Respect user's laundry level preference (default: level 1)
  const laundryLevel = (Number(brief?.stories || 1) >= 2 && Number(brief?.laundryLevel) === 2) ? 2 : 1;
  const laundryTarget = laundryLevel === 2 && level2 ? level2 : level1;
  laundryTarget.push(makeSpec(nextId, 'laundry', laundryLevel, { brief }));

  const specialRooms = plannedSpecialFeatureRooms(brief, interpretation);
  // A quiet upstairs study is a useful alternative to a public-floor office.
  // This changes the room program before graph construction, so access and
  // placement validation see the actual requested level.
  if (interpretation.stories === 2 && interpretation.bedrooms === 2 && brief.hasGarage && Number(brief.totalAreaSqFt) >= 2200 &&
      specialRooms.length === 1 && ['study','library'].includes(specialRooms[0].featureType) &&
      footprint?.variationId === 'variant_c_service_spine') {
    specialRooms[0].placement = {...specialRooms[0].placement,level:2,placementFamily:'upper_loft_reuse'};
  }
  const remainingRequests = [...(brief.requestedFeatureItems || [])];
  specialRooms.forEach(({ featureType, placement }, index) => {
    const config = FEATURE_ROOM_CONFIG[featureType] || {};
    const requestIndex = remainingRequests.findIndex(item => item.canonicalType === featureType);
    const request = requestIndex < 0 ? null : remainingRequests.splice(requestIndex, 1)[0];
    const targetLevel = levelPrograms[placement.level - 1]?.rooms || level1;
    targetLevel.push(makeSpec(nextId, featureType, placement.level, {
      brief,
      requestedFeature: true,
      programId: request?.programId || `feature_${featureType}_${index + 1}`,
      requestedFeatureKind: request?.kind || featureType,
      requestedFeatureLabel: request?.displayLabel || config.label,
      featureSource: 'requested',
      placementFamily: placement.placementFamily,
      preferredLevel: placement.level,
      minFeatureAreaSqFt: placement.minFeatureAreaSqFt || config.minAreaSqFt || 100,
      label: request?.displayLabel || config.label || null,
      featureGraphSlot: index + 1,
    }));
  });

  if (brief.hasGarage) {
    level1.push(makeSpec(nextId, 'garage', 1, { brief }));
    level1.push(makeSpec(nextId, 'mudroom', 1, { brief }));
  }

  if (interpretation.stories === 2) {
    level1.push(makeSpec(nextId, 'stairs', 1, { brief }));
    level1.push(makeSpec(nextId, 'hallway', 1, { brief, label: 'Stair Hall' }));
    level2.push(makeSpec(nextId, 'stairs', 2, { brief }));
    level2.push(makeSpec(nextId, 'hallway', 2, { brief, label: 'Landing Hall' }));
  }

  const primaryBedroomLevel = interpretation.primaryLevel;
  const primaryBedroom = makeSpec(nextId, 'primary_bedroom', primaryBedroomLevel, { brief, programId: 'primary' });
  levelPrograms[primaryBedroomLevel - 1].rooms.push(primaryBedroom);

  if (interpretation.bathPlan.primaryEnsuiteCount > 0) {
    levelPrograms[primaryBedroomLevel - 1].rooms.push(makeSpec(nextId, 'primary_bathroom', primaryBedroomLevel, {
      bathroomUse: 'primary',
      attachedTo: primaryBedroom.id,
      brief,
    }));
  }

  const secondaryBedroomCount = Math.max(0, interpretation.bedrooms - 1);
  const secondaryBedroomLevel = interpretation.stories === 2 ? 2 : 1;
  const secondaryBedroomIds = [];
  // Existing realm patterns reserve secondary slot 1 for the first ensuite.
  // Bind the user's bedroom identity to that physical slot before graph and
  // room construction, so changing Bedroom 2/3 changes the actual attachment.
  const bedroomIdentities = Array.from({ length: secondaryBedroomCount }, (_, i) => `bedroom_${i + 2}`);
  const configured = brief.bedroomProgram?.slice(1);
  if (configured?.every(b => b.privateBath !== null)) {
    const privateIds = configured.filter(b => b.privateBath).map(b => b.programId);
    const sharedIds = configured.filter(b => !b.privateBath).map(b => b.programId);
    const privateSlots = new Set(Array.from({ length: privateIds.length }, (_, i) => (i + 1) % secondaryBedroomCount));
    for (let i = 0; i < secondaryBedroomCount; i++) bedroomIdentities[i] = privateSlots.has(i) ? privateIds.shift() : sharedIds.shift();
  }
  for (let index = 0; index < secondaryBedroomCount; index++) {
    const programId = bedroomIdentities[index];
    const bedroom = makeSpec(nextId, 'bedroom', secondaryBedroomLevel, { brief, programId, label: `Bedroom ${programId.split('_')[1]}` });
    secondaryBedroomIds.push(bedroom.id);
    levelPrograms[secondaryBedroomLevel - 1].rooms.push(bedroom);
  }

  for (let index = 0; index < interpretation.bathPlan.secondaryPrivateBathCount; index++) {
    const attachedBedroomId = secondaryBedroomIds[(index + 1) % secondaryBedroomIds.length] || null;
    levelPrograms[secondaryBedroomLevel - 1].rooms.push(makeSpec(nextId, 'bathroom', secondaryBedroomLevel, {
      bathroomUse: 'private',
      attachedTo: attachedBedroomId,
      brief,
    }));
  }

  if (interpretation.stories === 2) {
    const upperSharedBathCount = interpretation.bathPlan.secondaryPrivateBathCount > 0 && interpretation.bathPlan.sharedBathCount < 2
      ? 0
      : interpretation.bathPlan.sharedBathCount > 0
        ? 1
        : 0;
    // A third or later shared bathroom serves the bedrooms: keep one on the
    // ground floor and put the rest upstairs, where the leftover-bathroom pass
    // finds them a spare room off the landing.
    const extraUpper = interpretation.bathPlan.sharedBathCount >= 3 ? interpretation.bathPlan.sharedBathCount - 1 - upperSharedBathCount : 0;
    const lowerSharedBathCount = Math.max(0, interpretation.bathPlan.sharedBathCount - upperSharedBathCount - extraUpper);
    pushSharedBathrooms(level2, upperSharedBathCount + extraUpper, nextId, 2, brief);
    pushSharedBathrooms(level1, lowerSharedBathCount, nextId, 1, brief);
  } else {
    pushSharedBathrooms(level1, interpretation.bathPlan.sharedBathCount, nextId, 1, brief);
  }

  // Outdoor living (porch, deck, patio) is not a room of the program: it is
  // placed outside the house after the openings (outdoorLiving.js).

  const graph = buildRealmGraphV2(brief, interpretation, levelPrograms);
  if (graph?.nodes?.length) {
    const nodeByRoomId = new Map(graph.nodes.map((node) => [String(node.roomId), node]));
    for (const level of levelPrograms) {
      for (const room of level.rooms || []) {
        const node = nodeByRoomId.get(String(room.id));
        if (!node) continue;
        if (room.programId) node.programId = room.programId;
        room.nodeRole = node.role;
        room.privacyDepth = node.privacyDepth;
        room.privacyLevel = node.privacyLevel;
        room.sunAffinity = node.sunAffinity;
        room.exteriorEdgesRequired = node.exteriorEdgesRequired;
        room.targetAreaSqFt = node.targetAreaSqFt;
        room.resolvedPreferredSide = node.resolvedPreferredSide || null;
      }
    }
  }

  return {
    levels: levelPrograms,
    interpretation,
    graph,
  };
}

module.exports = {
  buildProgramV2,
};
