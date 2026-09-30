'use strict';

/* The survey's outdoor living (a covered porch, deck, screened porch or
 * patio) is a structure outside the house, not a room inside it: it adds no
 * finished area and changes no room. placeOpenings gives the ground floor a
 * sliding door from a public room to the outside (`outdoorLivingDoor`); this
 * places the structure against that wall, centred on the door, and records it
 * as `level.outdoor` in the plan's coordinates (so it sits at negative
 * coordinates on the top or left side). The plan drawing, the 3D model and
 * the survey check read it from there.
 */
const TYPES = { COVERED_PORCH: 'covered_porch', OPEN_DECK: 'open_deck', SCREENED_PORCH: 'screened_porch', PATIO: 'patio' };
const LABELS = { covered_porch: 'Covered Porch', open_deck: 'Deck', screened_porch: 'Screened Porch', patio: 'Patio' };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function outdoorType(brief) {
  return TYPES[String(brief?.outdoorType || 'NONE').toUpperCase()] || null;
}

function attachOutdoorLiving(plan, brief) {
  const type = outdoorType(brief);
  if (!type) return plan;
  const level = (plan?.levels || []).find((l) => Number(l.level) === 1);
  const door = level?.doors?.find((d) => d.outdoorLivingDoor);
  if (!door) return plan; // the survey check reports the missing structure
  const W = Number(level.width), H = Number(level.height);
  const horizontal = door.dir === 'horizontal';
  // Which side of the door's wall is outside: no room covers the point there.
  const inRoom = (px, py) => level.rooms.some((r) => (r.parts?.length ? r.parts : [r]).some((p) => px > p.x && px < p.x + p.w && py > p.y && py < p.y + p.h));
  const side = horizontal ? (inRoom(door.x, door.y - 0.5) ? 'bottom' : 'top') : (inRoom(door.x - 0.5, door.y) ? 'right' : 'left');
  const area = clamp(Number(brief?.outdoorArea) || 160, 64, 800);
  const depth = clamp(Math.round(Math.sqrt(area / 1.6) / 2) * 2, 8, 16);
  const wallLen = horizontal ? W : H;
  const len = clamp(Math.round(area / depth / 2) * 2, 8, wallLen);
  const along = clamp((horizontal ? door.x : door.y) - len / 2, 0, wallLen - len);
  const at = horizontal ? door.y : door.x;
  const rect = side === 'top' ? { x: along, y: at - depth, w: len, h: depth }
    : side === 'bottom' ? { x: along, y: at, w: len, h: depth }
      : side === 'left' ? { x: at - depth, y: along, w: depth, h: len }
        : { x: at, y: along, w: depth, h: len };
  // Against a recessed wall (an L or T notch) the structure must stay clear of
  // the rooms on either side.
  if (level.rooms.some((r) => (r.parts?.length ? r.parts : [r]).some((p) => overlaps(rect, p)))) return plan;
  door.outdoorLivingId = 'outdoor_living_1';
  level.outdoor = [{
    id: 'outdoor_living_1', type, label: LABELS[type], ...rect, side, hostRoomId: door.a === '__exterior__' ? door.b : door.a,
    doorId: door.id || null, areaSqFt: rect.w * rect.h,
    covered: type === 'covered_porch' || type === 'screened_porch', screened: type === 'screened_porch',
  }];
  return plan;
}

module.exports = { attachOutdoorLiving, outdoorType, OUTDOOR_LABELS: LABELS };
