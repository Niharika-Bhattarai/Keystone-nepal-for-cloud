'use strict';

const { nodeDefaults } = require('./graphNodeTypes');
const { getFamilyPreset } = require('./familyPresets');
const {
  resolveRequiredAdjacencies,
  resolveForbiddenAdjacencies,
  resolveBufferRequirements,
} = require('./graphConstraints');
const { resolveHorizontalPreferredSide } = require('./orientationResolver');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function defaultTargetAreaSqFt(type, brief = null) {
  const area = num(brief?.totalAreaSqFt, 2000);
  switch (String(type || '')) {
    case 'living_room':
      return area >= 2200 ? 220 : 180;
    case 'kitchen':
      return area >= 2200 ? 150 : 130;
    case 'dining_room':
      return area >= 2200 ? 130 : 110;
    case 'entry':
      return 60;
    case 'garage':
      return String(brief?.garageType || '').toUpperCase() === 'TWO_CAR' ? 440 : 252;
    case 'stairs':
      return 72;
    case 'hallway':
      return 72;
    case 'primary_bedroom':
      return area >= 2200 ? 220 : 180;
    case 'primary_bathroom':
      return 90;
    case 'bedroom':
      return area >= 2200 ? 144 : 132;
    case 'bathroom':
      return 72;
    case 'study':
      return 120;
    case 'library':
      return 120;
    case 'gym':
      return 132;
    case 'gaming_room':
    case 'playroom':
      return 140;
    case 'movie_room':
      return 150;
    case 'music_room':
      return 120;
    case 'wine_cellar':
      return 80;
    case 'guest_bedroom':
      return 132;
    case 'mudroom':
      return 48;
    case 'laundry':
      return 48;
    case 'storage':
      return 32;
    default:
      return 64;
  }
}

function matchRoomSpec(levels, descriptor) {
  if (descriptor.roomId) return levels.flatMap(level => level.rooms || []).find(room => room.id === descriptor.roomId) || null;
  const rooms = (levels.find((level) => Number(level?.level) === Number(descriptor.level))?.rooms || [])
    .filter((room) => String(room?.type) === String(descriptor.type))
    .filter((room) => !descriptor.bathroomUse || String(room?.bathroomUse || '') === String(descriptor.bathroomUse));
  const index = num(descriptor.matchIndex, 0);
  return rooms[index] || null;
}

function detectRequestedSpecialRooms(levels) {
  const specialRooms = [];
  for (const level of levels || []) {
    for (const room of level?.rooms || []) {
      if (!room?.requestedFeature) continue;
      const type = String(room?.type || '').trim().toLowerCase();
      if (!['study', 'library', 'gym', 'gaming_room', 'playroom', 'movie_room', 'music_room', 'wine_cellar', 'guest_bedroom'].includes(type)) continue;
      specialRooms.push({
        type,
        level: Number(level?.level || room?.level || 1),
        slot: Number(room?.featureGraphSlot || 0),
        roomId: room.id,
        programId: room.programId,
        featureKind: room.requestedFeatureKind,
      });
    }
  }
  return specialRooms
    .sort((a, b) => {
      const slotA = Number.isFinite(Number(a.slot)) ? Number(a.slot) : Number.MAX_SAFE_INTEGER;
      const slotB = Number.isFinite(Number(b.slot)) ? Number(b.slot) : Number.MAX_SAFE_INTEGER;
      if (slotA !== slotB) return slotA - slotB;
      if (a.level !== b.level) return b.level - a.level;
      const rank = { study: 0, library: 1, gym: 2, gaming_room: 3, movie_room: 4, music_room: 5, wine_cellar: 6, guest_bedroom: 7 };
      return (rank[a.type] ?? 9) - (rank[b.type] ?? 9);
    })
    .map(({ slot, ...rest }) => rest);
}

function buildRealmGraphV2(brief, interpretation, levels) {
  const specialRooms = detectRequestedSpecialRooms(levels);
  const preset = getFamilyPreset({
    housePattern: interpretation?.housePattern,
    hasUpperSharedBath:
      Number(interpretation?.stories || 0) !== 2 ||
      Number(interpretation?.bathPlan?.sharedBathCount || 0) > 1 ||
      Number(interpretation?.bathPlan?.secondaryPrivateBathCount || 0) === 0,
    hasLowerSharedBath:
      Number(interpretation?.stories || 0) === 2 &&
      (
        Number(interpretation?.bathPlan?.sharedBathCount || 0) > 1 ||
        (
          Number(interpretation?.bathPlan?.secondaryPrivateBathCount || 0) > 0 &&
          Number(interpretation?.bathPlan?.sharedBathCount || 0) > 0
        )
      ),
    hasSecondaryPrivateBath: Number(interpretation?.bathPlan?.secondaryPrivateBathCount || 0) > 0,
    specialRooms,
  });
  if (!preset) return null;

  const upperLaundry = Number(brief?.stories) === 2 && Number(brief?.laundryLevel) === 2;
  const nodes = preset.nodes.map((presetDescriptor) => {
    const descriptor = upperLaundry && presetDescriptor.type === 'laundry'
      ? { ...presetDescriptor, level: 2 }
      : presetDescriptor;
    const roomSpec = matchRoomSpec(levels, ['shared_bath', 'lower_shared_bath'].includes(descriptor.key)
      ? { ...descriptor, bathroomUse: 'shared' } : descriptor);
    const meta = nodeDefaults(descriptor.role, {
      preferredSide: descriptor.preferredSide,
      type: descriptor.type,
    });
    return {
      key: descriptor.key,
      role: descriptor.role,
      type: descriptor.type,
      level: descriptor.level,
      roomId: roomSpec?.id || descriptor.key,
      roomContract: roomSpec?.roomContract || null,
      targetAreaSqFt: defaultTargetAreaSqFt(descriptor.type, brief),
      requiredAdjacencies: upperLaundry && descriptor.type === 'laundry'
        ? ['landing'] : resolveRequiredAdjacencies(descriptor.role, descriptor),
      forbiddenAdjacencies: resolveForbiddenAdjacencies(descriptor.role, descriptor),
      bufferRequirements: resolveBufferRequirements(descriptor.role, descriptor),
      preferredSide: descriptor.preferredSide || meta.preferredSide || null,
      resolvedPreferredSide: resolveHorizontalPreferredSide(
        brief?.frontFacing,
        meta.sunAffinity,
        descriptor.preferredSide || meta.preferredSide || null
      ),
      requestedFeatureKind: roomSpec?.requestedFeatureKind || descriptor.featureKind || null,
      stage: meta.stage,
      privacyDepth: meta.privacyDepth,
      privacyLevel: meta.privacyLevel,
      exteriorEdgesRequired: meta.exteriorEdgesRequired,
      sunAffinity: meta.sunAffinity,
      terminal: Boolean(meta.terminal),
    };
  });

  return {
    housePattern: preset.pattern,
    nodes,
    edges: (upperLaundry
      ? [...preset.edges.filter(([from,to])=>from !== 'laundry' && to !== 'laundry'), ['landing','laundry']]
      : preset.edges).map(([from, to]) => ({ from, to, kind: 'required_adjacency' })),
  };
}

module.exports = {
  buildRealmGraphV2,
};
