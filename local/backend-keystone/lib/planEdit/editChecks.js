'use strict';

/* What the Studio tells a person after a hand edit. Hand edits are theirs to
 * make: only physically impossible ones are refused (applyEditOps). Everything
 * else is reported as an issue the Studio shows beside the room:
 *
 *   { severity: 'block' | 'warn' | 'info', code, roomId, level, message,
 *     measured, needed }
 *
 * The limits are ordinary residential defaults (the IRC's habitable-room
 * minimums, hall widths, an escape window in every bedroom) and the fixture
 * and furniture fits the generator already uses. They are advice, not a code
 * review.
 */

const { isOutdoorType } = require('../tile/canonicalRoomTypes');
const { partListOf, roomArea } = require('../planGeometry');
const { validateRequiredFurniture, doorClearances, intersects } = require('../furnitureGeometry');
const { groupsOf } = require('../pinnedFurniture');
const { openPairKeys, sharedSegments } = require('../openEdges');
const { pieceName, groupName } = require('./furnitureOps');
const { validateConnectivity } = require('../validateConnectivity');
const { validatePlanStairAssemblies } = require('../stairs/validatePlanStairAssemblies');
const { cellsOf } = require('./wallRuns');

const SLEEPING = new Set(['bedroom', 'primary_bedroom', 'guest_bedroom']);
const HABITABLE = new Set([...SLEEPING, 'study', 'library', 'gym', 'playroom', 'gaming_room', 'music_room', 'living_room', 'dining_room', 'family_room', 'movie_room']);
const LONG_ROOMS_OK = new Set(['hallway', 'entry', 'kitchen', 'laundry', 'mudroom', 'storage', 'closet', 'garage', 'stairs', 'loft']);
const FURNITURE_NAMES = { bed: 'bed', bed_queen: 'bed', bed_king: 'bed', bed_twin: 'bed', toilet: 'toilet', vanity: 'vanity',
  shower: 'shower', tub: 'bath', stove: 'range', refrigerator: 'fridge', counter: 'counter', washer: 'washer', dryer: 'dryer',
  desk: 'desk', desk_chair: 'desk chair', dining_table: 'dining table', sofa: 'sofa', play_mat: 'play area', toy_storage: 'toy storage' };

const ft = (n) => {
  const whole = Math.floor(n + 1e-6);
  const inches = Math.round((n - whole) * 12);
  return inches ? `${whole} ft ${inches} in` : `${whole} ft`;
};
const nameOf = (room) => String(room?.label || String(room?.type || 'room').replace(/_/g, ' '));

function dims(room) {
  const parts = partListOf(room);
  const w = Math.max(...parts.map((p) => p.x2)) - Math.min(...parts.map((p) => p.x));
  const h = Math.max(...parts.map((p) => p.y2)) - Math.min(...parts.map((p) => p.y));
  // How wide the room's main body is: an L-shaped room is judged by its
  // largest part, not by the arm that links it to a hall.
  const main = parts.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  const narrow = Math.min(main.w, main.h);
  return { long: Math.max(w, h), short: Math.min(w, h), narrow, area: roomArea(room) };
}

// Length of a room's walls with nothing on the other side (outside walls).
function exteriorLength(room, level) {
  const others = cellsOf(level);
  let total = 0;
  for (const p of partListOf(room)) {
    const edges = [
      { axis: 'y', at: p.y, lo: p.x, hi: p.x2, side: -1 }, { axis: 'y', at: p.y2, lo: p.x, hi: p.x2, side: 1 },
      { axis: 'x', at: p.x, lo: p.y, hi: p.y2, side: -1 }, { axis: 'x', at: p.x2, lo: p.y, hi: p.y2, side: 1 },
    ];
    for (const e of edges) {
      const covered = others.filter((c) => {
        if (c.room === room && c.x === p.x && c.y === p.y && c.w === p.w && c.h === p.h) return false;
        return e.axis === 'y'
          ? Math.abs((e.side < 0 ? c.y + c.h : c.y) - e.at) < 1e-6
          : Math.abs((e.side < 0 ? c.x + c.w : c.x) - e.at) < 1e-6;
      }).map((c) => (e.axis === 'y' ? [Math.max(e.lo, c.x), Math.min(e.hi, c.x + c.w)] : [Math.max(e.lo, c.y), Math.min(e.hi, c.y + c.h)]))
        .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
      let end = e.lo, open = 0;
      for (const [a, b] of covered) { if (a > end) open += a - end; end = Math.max(end, b); }
      open += Math.max(0, e.hi - end);
      total += open;
    }
  }
  return total;
}

function roomIssues(room, level) {
  const issues = [];
  const type = String(room.type);
  const { long, short, narrow, area } = dims(room);
  const base = { roomId: String(room.id), level: Number(level.level) || 1 };
  const name = nameOf(room);
  if (HABITABLE.has(type)) {
    if (area < 70) issues.push({ ...base, severity: 'warn', code: 'room_small', measured: area, needed: 70,
      message: `${name} is now very small: ${Math.round(area)} sq ft. A habitable room usually needs at least 70 sq ft.` });
    if (narrow < 7) issues.push({ ...base, severity: 'warn', code: 'room_narrow', measured: narrow, needed: 7,
      message: `${name} is now very narrow: ${ft(narrow)} across. A habitable room usually needs at least 7 ft.` });
    const limit = type === 'living_room' || type === 'dining_room' ? 3 : 2.5;
    if (short > 0 && long / short > limit && narrow >= 7) issues.push({ ...base, severity: 'warn', code: 'room_slender', measured: long / short, needed: limit,
      message: `${name} has become long and slender: ${ft(long)} by ${ft(short)}.` });
  }
  if (type === 'bathroom' || type === 'primary_bathroom' || type === 'powder_room') {
    const min = type === 'powder_room' ? 3 : 5;
    if (narrow < min) issues.push({ ...base, severity: 'warn', code: 'bath_narrow', measured: narrow, needed: min,
      message: `${name} is now ${ft(narrow)} across; a ${type === 'powder_room' ? 'powder room' : 'bathroom'} needs about ${min} ft for its fixtures.` });
    if (short > 0 && long / short > 2.8) issues.push({ ...base, severity: 'warn', code: 'room_slender', measured: long / short, needed: 2.8,
      message: `${name} has become long and slender: ${ft(long)} by ${ft(short)}.` });
  }
  if (type === 'kitchen' && narrow < 7) {
    issues.push({ ...base, severity: 'warn', code: 'kitchen_narrow', measured: narrow, needed: 7,
      message: `The kitchen is now ${ft(narrow)} across; counters and room to work need about 7 ft.` });
  }
  if ((type === 'hallway' || type === 'entry') && narrow < 3) {
    issues.push({ ...base, severity: 'warn', code: 'hall_narrow', measured: narrow, needed: 3,
      message: `${name} is now ${ft(narrow)} wide; a hall needs at least 3 ft to walk through.` });
  }
  if (type === 'garage' && (short < 10 || long < 18)) {
    issues.push({ ...base, severity: 'warn', code: 'garage_small', measured: area, needed: 200,
      message: `The garage is now ${ft(long)} by ${ft(short)}, too small to park a car (about 10 by 18 ft each).` });
  }
  if (SLEEPING.has(type) && exteriorLength(room, level) < 3) {
    issues.push({ ...base, severity: 'warn', code: 'no_escape_window',
      message: `${name} has no outside wall, so it cannot have the escape window a bedroom needs.` });
  }
  if (!LONG_ROOMS_OK.has(type) && !HABITABLE.has(type) && short > 0 && long / short > 4) {
    issues.push({ ...base, severity: 'info', code: 'room_slender', measured: long / short, needed: 4,
      message: `${name} is long and slender: ${ft(long)} by ${ft(short)}.` });
  }
  return issues;
}

// A room furnished by hand: what the arrangement gets in the way of. Rooms the
// plan furnished itself are already clear of doors and each other.
function arrangedIssues(room, level) {
  const issues = [];
  const base = { roomId: String(room.id), level: Number(level.level) || 1 };
  const groups = groupsOf((level.furniture || []).filter((f) => String(f.roomId) === String(room.id)));
  const zones = doorClearances(room, level);
  for (const group of groups) {
    if (group.some((item) => zones.some((zone) => intersects(item, zone)))) {
      issues.push({ ...base, severity: 'warn', code: 'furniture_blocks_door', piece: group[0].kind,
        message: `The ${groupName(group)} is in the way of a door in ${nameOf(room)}.` });
    }
  }
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (!groups[i].some((p) => groups[j].some((q) => intersects(p, q)))) continue;
      issues.push({ ...base, severity: 'warn', code: 'furniture_overlap', piece: `${groups[i][0].kind}+${groups[j][0].kind}`,
        message: `The ${groupName(groups[i])} overlaps the ${groupName(groups[j])} in ${nameOf(room)}.` });
    }
  }
  return issues;
}

// A piece placed by hand that no longer fitted after a wall moved.
function droppedIssues(plan, all) {
  const issues = [];
  for (const o of plan.furnitureDiagnostics?.omitted || []) {
    if (!o.userPlaced) continue;
    const room = all.find((r) => String(r.id) === String(o.roomId));
    const dining = /^(dining_table|chair_\d+)$/.test(String(o.kind));
    const name = dining ? 'dining table and chairs' : pieceName(o.kind);
    issues.push({ severity: 'warn', code: 'furniture_dropped', roomId: room ? String(room.id) : null, piece: dining ? 'dining_set' : o.kind,
      message: `The ${name} you placed no longer fits in ${nameOf(room)}, so it was taken out.` });
  }
  return issues;
}

/** Bedrooms, full bathrooms and powder rooms in a plan. */
function programCounts(plan) {
  const types = (plan.levels || []).flatMap((l) => (l.rooms || []).map((r) => String(r.type)));
  return { bedrooms: types.filter((t) => SLEEPING.has(t)).length,
    fullBaths: types.filter((t) => t === 'bathroom' || t === 'primary_bathroom').length,
    powderRooms: types.filter((t) => t === 'powder_room').length };
}

// Bedrooms and bathrooms against the plan as generated (recomputeEditedPlan
// keeps its counts in `editBaseline`), so a count the plan was built with is
// never reported as an edit's doing.
function programIssues(plan, surveyData) {
  const base = plan.editBaseline;
  if (!plan.edited || !base) return [];
  const now = programCounts(plan);
  const issues = [];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (now.bedrooms !== base.bedrooms) {
    const wanted = parseInt(String(surveyData?.bedrooms || ''), 10);
    issues.push({ severity: 'info', code: 'bedroom_count', roomId: null, measured: now.bedrooms, needed: base.bedrooms,
      message: `The plan now has ${plural(now.bedrooms, 'bedroom', 'bedrooms')}; ${wanted === base.bedrooms ? `your brief asked for ${wanted}` : `it had ${base.bedrooms}`}.` });
  }
  if (now.fullBaths !== base.fullBaths) {
    issues.push({ severity: 'info', code: 'bath_count', piece: 'full', roomId: null, measured: now.fullBaths, needed: base.fullBaths,
      message: `The plan now has ${plural(now.fullBaths, 'full bathroom', 'full bathrooms')}; it had ${base.fullBaths}.` });
  }
  if (now.powderRooms !== base.powderRooms) {
    issues.push({ severity: 'info', code: 'bath_count', piece: 'powder', roomId: null, measured: now.powderRooms, needed: base.powderRooms,
      message: `The plan now has ${plural(now.powderRooms, 'powder room', 'powder rooms')}; it had ${base.powderRooms}.` });
  }
  return issues;
}

// A wall taken out under an upper floor may have been holding it up.
function openWallIssues(plan) {
  const issues = [];
  const levels = plan.levels || [];
  for (const level of levels) {
    const above = levels.find((l) => (Number(l.level) || 1) === (Number(level.level) || 1) + 1);
    if (!above) continue;
    const byId = new Map((level.rooms || []).map((r) => [String(r.id), r]));
    for (const key of openPairKeys(level)) {
      const [a, b] = key.split('|').map((id) => byId.get(id));
      if (!a || !b) continue;
      const under = sharedSegments(a, b).some((seg) => {
        const mid = (seg.from + seg.to) / 2;
        const [x, y] = seg.axis === 'x' ? [seg.at, mid] : [mid, seg.at];
        return (above.rooms || []).some((r) => !isOutdoorType(r.type) && partListOf(r).some((p) => x > p.x && x < p.x2 && y > p.y && y < p.y2));
      });
      if (under) {
        issues.push({ severity: 'info', code: 'open_wall_beam', roomId: String(a.id), level: Number(level.level) || 1, piece: String(b.id),
          message: `The wall you took out between ${nameOf(a)} and ${nameOf(b)} sits under the floor above. It may carry that floor; a builder would check and fit a beam if it does.` });
      }
    }
  }
  return issues;
}

// Replace room ids in a validator's message with the rooms' names.
function humanize(message, rooms) {
  let text = String(message);
  for (const room of rooms) text = text.split(String(room.id)).join(nameOf(room));
  return text.replace(/^(Logic|Runtime): /, '');
}

function roomIn(message, rooms) {
  return rooms.find((r) => String(message).includes(String(r.id))) || null;
}

/** Structured findings for a plan after a hand edit. */
function checkEditedPlan(plan, surveyData = {}) {
  const issues = [];
  const rooms = plan.levels.flatMap((l) => (l.rooms || []).map((room) => ({ room, level: l })));
  const all = rooms.map((r) => r.room);
  for (const { room, level } of rooms) {
    if (isOutdoorType(room.type)) continue;
    issues.push(...roomIssues(room, level));
    if (room.furnitureEdited) issues.push(...arrangedIssues(room, level));
  }

  // A stair must stay a buildable flight.
  for (const message of validatePlanStairAssemblies(plan)) {
    const room = roomIn(message, all);
    issues.push({ severity: 'block', code: 'stair_invalid', roomId: room ? String(room.id) : null, message: `The stair no longer works: ${humanize(message, all)}` });
  }
  // Required furniture that no longer fits.
  for (const message of validateRequiredFurniture(plan)) {
    const m = /cannot fit: (\S+) needs (\S+)/.exec(message);
    const room = m ? all.find((r) => String(r.id) === m[1]) : null;
    if (!room) continue;
    const piece = FURNITURE_NAMES[m[2]] || m[2].replace(/_/g, ' ');
    // In a room furnished by hand, a missing piece is the person's choice.
    if (room.furnitureEdited) {
      issues.push({ severity: 'info', code: 'furniture_absent', roomId: String(room.id), piece: m[2],
        message: `${nameOf(room)} has no ${piece}.` });
      continue;
    }
    issues.push({ severity: 'warn', code: 'furniture_missing', roomId: String(room.id), piece: m[2],
      message: `The ${piece} no longer fits in ${nameOf(room)}.` });
  }
  issues.push(...droppedIssues(plan, all));
  // Rooms that cannot be reached, and suites that are no longer private.
  for (const message of validateConnectivity(plan, surveyData)) {
    const text = String(message);
    const level = Number((/Level (\d+)/.exec(text) || [])[1]) || null;
    const onLevel = (type) => rooms.find((r) => String(r.room.type) === type && (!level || (Number(r.level.level) || 1) === level))?.room || null;
    const room = roomIn(text, all);
    if (/not reachable from circulation/.test(text) && room) {
      issues.push({ severity: 'warn', code: 'unreachable', roomId: String(room.id),
        message: 'No door or opening joins it to a hall or living space any more. Widen the wall it shares with one, open it to one, or undo the change.' });
    } else if (/primary bathroom is not connected/.test(text) || /private bathroom .* not connected/.test(text)) {
      const bath = room || onLevel('primary_bathroom');
      issues.push({ severity: 'warn', code: 'ensuite_cut', roomId: bath ? String(bath.id) : null,
        message: `${bath ? nameOf(bath) : 'The en-suite bathroom'} no longer opens from its bedroom.` });
    } else if (/non-ensuite access/.test(text)) {
      const bath = room || onLevel('primary_bathroom');
      issues.push({ severity: 'info', code: 'ensuite_shared', roomId: bath ? String(bath.id) : null,
        message: `${bath ? nameOf(bath) : 'The en-suite bathroom'} also opens to another room now, so it is no longer private to the suite.` });
    } else if (/stairs/i.test(text)) {
      const stair = onLevel('stairs');
      issues.push({ severity: 'warn', code: 'stair_access', roomId: stair ? String(stair.id) : null,
        message: 'The stair no longer opens to a hall or landing.' });
    } else {
      issues.push({ severity: 'warn', code: 'unreachable', roomId: room ? String(room.id) : null, message: humanize(text, all) });
    }
  }
  issues.push(...programIssues(plan, surveyData));
  issues.push(...openWallIssues(plan));
  return dedupe(issues);
}

function dedupe(issues) {
  const seen = new Set();
  return issues.filter((i) => {
    const key = `${i.code}|${i.roomId}|${i.piece || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Issues present after an edit that were not there before it. */
function newIssues(before, after) {
  const key = (i) => `${i.code}|${i.roomId}|${i.piece || ''}`;
  const had = new Set((before || []).map(key));
  return (after || []).filter((i) => !had.has(key(i)));
}

/** Room, floor and house areas, and the difference from the survey's request. */
function planAreas(plan, surveyData = {}) {
  const rooms = [];
  const levels = (plan.levels || []).map((level) => {
    let finished = 0, garage = 0;
    for (const room of level.rooms || []) {
      if (isOutdoorType(room.type)) continue;
      const area = roomArea(room);
      if (room.type === 'garage') garage += area; else finished += area;
      const { long, short } = dims(room);
      rooms.push({ roomId: String(room.id), level: Number(level.level) || 1, label: nameOf(room), type: room.type,
        area: Math.round(area), long, short });
    }
    return { level: Number(level.level) || 1, finished: Math.round(finished), garage: Math.round(garage) };
  });
  const finished = levels.reduce((s, l) => s + l.finished, 0);
  const requested = Number(String(surveyData.totalArea || '').replace(/[^\d.]/g, '')) || null;
  return { finished, garage: levels.reduce((s, l) => s + l.garage, 0), levels, rooms, requested,
    difference: requested ? finished - requested : null };
}

module.exports = { checkEditedPlan, newIssues, planAreas, exteriorLength, programCounts };
