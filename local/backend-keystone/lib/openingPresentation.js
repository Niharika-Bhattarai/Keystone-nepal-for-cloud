'use strict';

// One presentation contract for saved openings. Plan x/y map to 3D X/Z.
// Width is the planned wall opening, not a product-certified clear passage.
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const value = (v, fallback) => finite(v) ? Number(v) : fallback;
const privateRoom = r => /bedroom|bathroom|study|powder|garage/.test(String(r?.type || '').toLowerCase());

function doorSwingSign(door, rooms) {
  const a = rooms.find(r => String(r.id) === String(door.a));
  const b = rooms.find(r => String(r.id) === String(door.b));
  const vertical = door.dir === 'vertical';
  const front = a?.type === 'closet' && a.ownerBedroomId === b?.id ? a.closetFront : null;
  if (front) return front === (vertical ? 'right' : 'bottom') ? 1 : -1;
  const target = a && b ? (privateRoom(a) && !privateRoom(b) ? a : b) : a || b;
  if (!target) return 1;
  const center = vertical ? value(target.x, 0) + value(target.w, 0) / 2 : value(target.y, 0) + value(target.h, 0) / 2;
  return center > value(vertical ? door.x : door.y, 0) ? 1 : -1;
}

function doorHeight(door, rooms) {
  if (finite(door.heightFt)) return Number(door.heightFt);
  const heights = rooms.filter(r => [String(door.a), String(door.b)].includes(String(r.id)))
    .map(r => r.heightMeta?.doorHeadHeightFt).filter(finite).map(Number);
  // A garage door takes the garage room's saved head (8 ft in generated plans,
  // see buildingModel.openingHeights); 7 ft only when that metadata is missing.
  if (door.garageDoor) return heights.length ? Math.min(...heights) : 7;
  if (door.slidingDoor) return 7;
  return heights.length ? Math.min(...heights) : door.openThreshold || door.stairEndpoint ? 7 : 6 + 8 / 12;
}

function windowHeights(window, room) {
  return {
    sill: value(window.sillHeightFt, value(room?.heightMeta?.windowSillHeightFt, 3)),
    head: value(window.headHeightFt, value(room?.heightMeta?.windowHeadHeightFt, 7)),
  };
}

module.exports = { doorSwingSign, doorHeight, windowHeights };
