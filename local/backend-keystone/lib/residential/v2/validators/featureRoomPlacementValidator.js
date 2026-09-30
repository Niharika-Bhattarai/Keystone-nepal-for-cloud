'use strict';

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');
const { touchesExterior, partListOf, shareWall } = require('../../../planGeometry');
const { unionArea } = require('../../../geometry/rectBoolean');
const { validateFurnitureGeometry } = require('../../../furnitureGeometry');
const { isSocialFeaturePair } = require('../featurePairPolicy');

const FEATURE_MIN_AREA = Object.freeze({
  study: 100, library: 100, gym: 180, gaming_room: 120, playroom: 140,
  movie_room: 120, music_room: 100, wine_cellar: 60, guest_bedroom: 120,
});
const FEATURE_ROOM_TYPES = Object.keys(FEATURE_MIN_AREA);

function validateFeatureRoomPlacement(level, requestedKind) {
  if (!FEATURE_ROOM_TYPES.includes(requestedKind)) return [];
  const rooms = level?.rooms || [];
  const errors = [];
  // Every instance must pass, including the second room on the same floor.
  for (const room of rooms.filter(r => normalizeRoomType(r.type) === requestedKind)) {
    const name = room.label || room.id;
    if (['study', 'library', 'music_room', 'guest_bedroom', 'playroom'].includes(requestedKind) &&
        !touchesExterior(room, Number(level.width), Number(level.height))) {
      errors.push(`${requestedKind} placement invalid: ${name} must touch an exterior wall for natural light`);
    }
    const area = unionArea(partListOf(room));
    if (area < FEATURE_MIN_AREA[requestedKind]) {
      errors.push(`${requestedKind} placement invalid: ${name} area ${area} sqft is below ${FEATURE_MIN_AREA[requestedKind]} sqft minimum`);
    }
    if (requestedKind === 'wine_cellar' && Number(level.level || 1) !== 1) {
      errors.push(`wine_cellar placement invalid: ${name} should be on level 1`);
    }
    if (['gym', 'movie_room', 'music_room', 'gaming_room', 'playroom'].includes(requestedKind) &&
        rooms.some(r => normalizeRoomType(r.type) === 'primary_bedroom' && shareWall(room, r, 0.01))) {
      errors.push(`${requestedKind} placement invalid: ${name} should not be directly adjacent to primary bedroom (noise concern)`);
    }
  }
  return errors;
}

function validateRequestedFeatureRooms(planSpec, brief) {
  const errors = [];
  const levels = planSpec?.levels || [];
  const rooms = levels.flatMap(level => level.rooms || []);
  const requests = (brief?.requestedFeatureItems || []).filter(item =>
    FEATURE_ROOM_TYPES.includes(normalizeRoomType(item.canonicalType || item.type)));
  const types = [...new Set(requests.map(item => normalizeRoomType(item.canonicalType || item.type)))];
  if (isSocialFeaturePair(requests.map(item => normalizeRoomType(item.canonicalType || item.type)))) {
    // Derive these checks from the original request, not optional generated
    // metadata: stripping furnishing diagnostics must not bypass edit checks.
    const publicTypes = ['living_room', 'dining_room', 'kitchen', 'hallway', 'entry'];
    const ground = levels.find(level => Number(level.level) === 1);
    for (const type of ['gaming_room', 'playroom', 'living_room', 'dining_room']) {
      const room = ground?.rooms?.find(room => normalizeRoomType(room.type) === type);
      if (!room) { errors.push(`Social feature pair needs ground-floor ${type}`); continue; }
      if (['gaming_room', 'playroom'].includes(type)) {
        const access = (ground.doors || []).some(door => {
          const otherId = door.a === room.id ? door.b : door.b === room.id ? door.a : null;
          return otherId && ground.rooms.some(other => other.id === otherId && publicTypes.includes(other.type));
        });
        if (!access) errors.push(`Social feature pair needs independent public access: ${room.id}`);
        if (!(ground.windows || []).some(window => window.roomId === room.id)) {
          errors.push(`Social feature pair needs exterior window: ${room.id}`);
        }
      }
      const furniture = (ground.furniture || []).filter(item => item.roomId === room.id);
      const required = { gaming_room: ['desk', 'desk_chair'], playroom: ['play_mat', 'toy_storage'],
        living_room: ['sofa', 'coffee_table'], dining_room: ['dining_table'] }[type];
      for (const kind of required) if (!furniture.some(item => item.kind === kind)) {
        errors.push(`Social feature pair furnishing missing: ${room.id} needs ${kind}`);
      }
      if (type === 'dining_room') {
        const chairs = furniture.filter(item => /^chair_\d+$/.test(item.kind));
        if (chairs.length !== 8) errors.push(`Social feature pair dining needs 8 chairs; delivered ${chairs.length}`);
        const tables = furniture.filter(item => item.kind === 'dining_table');
        const table = tables[0];
        if (tables.length !== 1 || Math.abs(Math.max(table.w, table.h) - 8) > 0.01 ||
            Math.abs(Math.min(table.w, table.h) - 4) > 0.01) {
          errors.push('Social feature pair dining needs one full-size 8 by 4 ft table');
        } else {
          const horizontal = table.w > table.h;
          // Independently check eight distinct occupied positions around the
          // table. A moved or shrunk chair cannot pass by retaining its label.
          const positions = [-3, 0, 3].flatMap(u => [[u, -3.1], [u, 3.1]]).concat([[-5.1, 0], [5.1, 0]]);
          const cx = table.x + table.w / 2, cy = table.y + table.h / 2;
          if (positions.some(([u, v]) => chairs.filter(chair =>
            Math.abs(chair.w - 1.5) < 0.01 && Math.abs(chair.h - 1.5) < 0.01 &&
            Math.abs(chair.x + chair.w / 2 - cx - (horizontal ? u : v)) < 0.01 &&
            Math.abs(chair.y + chair.h / 2 - cy - (horizontal ? v : u)) < 0.01).length !== 1)) {
            errors.push('Social feature pair dining chairs must remain arranged around the table');
          }
        }
      }
    }
    if (ground) errors.push(...validateFurnitureGeometry(ground,
      ['gaming_room', 'playroom', 'living_room', 'dining_room']));
  }
  for (const type of types) {
    const expected = requests.filter(item => normalizeRoomType(item.canonicalType || item.type) === type).length;
    const actual = rooms.filter(room => normalizeRoomType(room.type) === type).length;
    if (actual !== expected) errors.push(`requested ${type} count mismatch: requested ${expected}, delivered ${actual}`);
    for (const level of levels) errors.push(...validateFeatureRoomPlacement(level, type));
  }
  // Existing saved plans may predate feature identities. Count/geometry checks
  // still apply; identity is mandatory once a plan uses the instance contract.
  if (planSpec?.featureProgramVersion === 1 || rooms.some(room => /^feature_/.test(room.programId || ''))) {
    for (const request of requests) {
      if (!request.programId) continue;
      const matches = rooms.filter(room => room.programId === request.programId);
      if (matches.length !== 1 || normalizeRoomType(matches[0]?.type) !== request.canonicalType ||
          matches[0]?.requestedFeatureKind !== request.kind) {
        errors.push(`requested feature identity mismatch: ${request.programId} must identify exactly one ${request.kind} room`);
      }
    }
  }
  return errors;
}

module.exports = { FEATURE_ROOM_TYPES, validateFeatureRoomPlacement, validateRequestedFeatureRooms };
