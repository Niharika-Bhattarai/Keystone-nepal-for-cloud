'use strict';

/* Corrected diversity metric (execution plan P05, item 13).
 *
 * The shipped metric (variationDiversityValidator.js, kept unchanged and
 * referred to here as v1) has three defects that all push in the same
 * direction - toward calling plans diverse when they are not:
 *
 * 1. Adjacency edges are keyed by `signatureForRoom`, which embeds the room's
 *    grid coordinates and an area bucket. Sliding an otherwise identical
 *    topology changes every edge ID, so ONE change registers on both the
 *    placement dimension and the graph dimension - and two dimensions is
 *    exactly the bar a pair has to clear. Edges here are keyed by stable
 *    program identity, so the graph dimension only moves when the graph does.
 *
 * 2. `collectPlanRooms` splits a composite room into one entry per part. A
 *    single L-shaped living room becomes two "living rooms", and moving it can
 *    be counted twice toward the two-major-rooms threshold. Rooms here stay
 *    whole, with an area-weighted centroid.
 *
 * 3. Insufficient data returns `diverse: true`. Two plans with fewer than two
 *    comparable major rooms, or with no adjacencies at all, are declared
 *    diverse on the strength of knowing nothing about them. Here that is
 *    `not_evaluable`, which cannot satisfy the requirement.
 *
 * The numeric thresholds are deliberately identical to v1: two dimensions of
 * four including placement or circulation, six feet and two rooms for
 * placement, three edges for adjacency. This is a correction to how the
 * dimensions are measured, NOT a change to how much difference is demanded,
 * and it must not be reported as a coverage improvement.
 */

const v1 = require('./variationDiversityValidator');

const THRESHOLDS = Object.freeze({
  minDimensions: 2,
  placementShiftFt: 6,
  placementRoomCount: 2,
  adjacencyEditDistance: 3,
});

const METRIC_VERSION = 'diversity-v2-stable-identity';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeType = (value) => String(value || '').trim().toLowerCase();

const MAJOR_ROOM_TYPES = new Set([
  'living_room', 'great_room', 'family_room', 'kitchen', 'dining_room',
  'primary_bedroom', 'bedroom', 'study', 'library', 'gym',
]);

const CIRCULATION_TYPES = new Set([
  'hallway', 'landing', 'landing_hall', 'stair_hall', 'stairs', 'corridor', 'entry', 'foyer',
]);

/* Stable identity for a room.
 *
 * Program IDs survive being moved, which is the whole point: the graph should
 * only change when the connections change. A part suffix is stripped so the
 * pieces of a composite room resolve to the room. Type plus level is the
 * fallback when no ID exists, which is weaker but still coordinate-free. */
function stableRoomKey(room, levelNumber) {
  const rawId = String(room?.programId || room?.id || '').trim();
  if (rawId) return rawId.replace(/_part_\d+$/i, '');
  return `${normalizeType(room?.type)}@L${levelNumber}`;
}

const partsOf = (room) => {
  const parts = asArray(room?.parts);
  if (parts.length) return parts;
  return [room];
};

/* Whole rooms, with an area-weighted centroid over their parts. */
function collectWholeRooms(plan) {
  const out = [];

  const pushRoom = (room, levelNumber, index) => {
    const parts = partsOf(room)
      .map((part) => ({
        x: num(part?.x),
        y: num(part?.y),
        w: num(part?.widthFt, num(part?.w, num(part?.width, 0))),
        h: num(part?.heightFt, num(part?.h, num(part?.height, 0))),
      }))
      .filter((part) => part.w > 0 && part.h > 0);
    if (!parts.length) return;

    let areaSqFt = 0;
    let momentX = 0;
    let momentY = 0;
    for (const part of parts) {
      const area = part.w * part.h;
      areaSqFt += area;
      momentX += (part.x + part.w / 2) * area;
      momentY += (part.y + part.h / 2) * area;
    }

    out.push({
      key: stableRoomKey(room, levelNumber) || `room_${index}`,
      type: normalizeType(room?.type),
      level: levelNumber,
      areaSqFt,
      centroid: { x: momentX / areaSqFt, y: momentY / areaSqFt },
      parts,
    });
  };

  const direct = asArray(plan?.rooms);
  if (direct.length) {
    direct.forEach((room, index) => pushRoom(room, num(room?.level, 1), index));
    return out;
  }

  asArray(plan?.levels).forEach((level) => {
    const levelNumber = num(level?.level, 1);
    asArray(level?.rooms).forEach((room, index) => pushRoom(room, levelNumber, index));
  });
  return out;
}

const NOT_EVALUABLE = (reason) => ({ diverse: false, notEvaluable: true, reason });

/* Placement. Same thresholds as v1; whole rooms instead of parts. */
function placementDiverse(planA, planB) {
  const majorA = collectWholeRooms(planA).filter((room) => MAJOR_ROOM_TYPES.has(room.type));
  const majorB = collectWholeRooms(planB).filter((room) => MAJOR_ROOM_TYPES.has(room.type));
  if (majorA.length < 2 || majorB.length < 2) {
    return NOT_EVALUABLE('fewer than two comparable major rooms');
  }
  if (new Set(majorA.map(r => r.key)).size !== majorA.length || new Set(majorB.map(r => r.key)).size !== majorB.length) {
    return NOT_EVALUABLE('major room identities are ambiguous');
  }

  const byKey = new Map(majorB.map((room) => [room.key, room]));
  const byType = new Map();
  for (const room of majorB) {
    if (!byType.has(room.type)) byType.set(room.type, []);
    byType.get(room.type).push(room);
  }

  let shiftedCount = 0;
  let maxDelta = 0;
  let compared = 0;
  const matched = new Set();

  for (const room of majorA) {
    // Match on stable identity first; fall back to next room of the same type.
    let counterpart = byKey.get(room.key);
    if (!counterpart) {
      const pool = byType.get(room.type) || [];
      counterpart = pool.find(candidate => !matched.has(candidate.key) && !majorA.some(r => r.key === candidate.key));
    }
    if (!counterpart || matched.has(counterpart.key)) continue;
    matched.add(counterpart.key);
    compared += 1;
    const delta = Math.hypot(
      room.centroid.x - counterpart.centroid.x,
      room.centroid.y - counterpart.centroid.y,
    );
    maxDelta = Math.max(maxDelta, delta);
    if (delta >= THRESHOLDS.placementShiftFt) shiftedCount += 1;
  }

  if (compared < THRESHOLDS.placementRoomCount) {
    return NOT_EVALUABLE('not enough rooms could be matched between the plans');
  }

  return {
    diverse: shiftedCount >= THRESHOLDS.placementRoomCount,
    notEvaluable: false,
    shiftedCount,
    maxDelta: Math.round(maxDelta * 100) / 100,
  };
}

function touches(a, b) {
  for (const pa of a.parts) {
    for (const pb of b.parts) {
      const aRight = pa.x + pa.w;
      const aBottom = pa.y + pa.h;
      const bRight = pb.x + pb.w;
      const bBottom = pb.y + pb.h;
      const vertical = (aRight === pb.x || bRight === pa.x)
        && Math.min(aBottom, bBottom) - Math.max(pa.y, pb.y) > 0;
      const horizontal = (aBottom === pb.y || bBottom === pa.y)
        && Math.min(aRight, bRight) - Math.max(pa.x, pb.x) > 0;
      if (vertical || horizontal) return true;
    }
  }
  return false;
}

/* Adjacency, keyed by stable identity so moving a topology is not a graph change. */
function buildAdjacencySet(plan) {
  const rooms = collectWholeRooms(plan);
  const set = new Set();
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      if (rooms[i].level !== rooms[j].level) continue;
      if (!touches(rooms[i], rooms[j])) continue;
      set.add([rooms[i].key, rooms[j].key].sort().join('|'));
    }
  }
  return set;
}

function adjacencyDiverse(planA, planB) {
  for (const plan of [planA, planB]) {
    const rooms = collectWholeRooms(plan);
    if (new Set(rooms.map(r => r.key)).size !== rooms.length) return NOT_EVALUABLE('room identities are ambiguous');
  }
  const setA = buildAdjacencySet(planA);
  const setB = buildAdjacencySet(planB);
  if (!setA.size || !setB.size) {
    return NOT_EVALUABLE('one or both plans have no recorded adjacencies');
  }
  let editDistance = 0;
  for (const key of setA) if (!setB.has(key)) editDistance += 1;
  for (const key of setB) if (!setA.has(key)) editDistance += 1;
  return {
    diverse: editDistance >= THRESHOLDS.adjacencyEditDistance,
    notEvaluable: false,
    editDistance,
  };
}

/* Circulation and envelope are not affected by either defect, so v1's
 * behaviour is reused rather than reimplemented and allowed to drift. */
function circulationDiverse(planA, planB) {
  const roomsA = collectWholeRooms(planA).filter((room) => CIRCULATION_TYPES.has(room.type));
  const roomsB = collectWholeRooms(planB).filter((room) => CIRCULATION_TYPES.has(room.type));
  if (!roomsA.length || !roomsB.length) {
    return NOT_EVALUABLE('one or both plans have no circulation rooms');
  }
  const spread = (rooms) => {
    const xs = rooms.map((room) => room.centroid.x);
    const ys = rooms.map((room) => room.centroid.y);
    return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys), count: rooms.length };
  };
  const a = spread(roomsA);
  const b = spread(roomsB);
  const delta = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  return {
    diverse: a.count !== b.count || delta >= THRESHOLDS.placementShiftFt,
    notEvaluable: false,
    maxDelta: Math.round(delta * 100) / 100,
  };
}

function envelopeDiverse(planA, planB) {
  const envelope = (plan) => {
    const rooms = collectWholeRooms(plan);
    if (!rooms.length) return null;
    const xs = rooms.flatMap((room) => room.parts.map((part) => part.x));
    const xe = rooms.flatMap((room) => room.parts.map((part) => part.x + part.w));
    const ys = rooms.flatMap((room) => room.parts.map((part) => part.y));
    const ye = rooms.flatMap((room) => room.parts.map((part) => part.y + part.h));
    const width = Math.max(...xe) - Math.min(...xs);
    const height = Math.max(...ye) - Math.min(...ys);
    return { width, height, aspect: height > 0 ? width / height : 0 };
  };
  const a = envelope(planA);
  const b = envelope(planB);
  if (!a || !b) return NOT_EVALUABLE('one or both plans have no rooms');
  const aspectDelta = Math.abs(a.aspect - b.aspect);
  return {
    diverse: aspectDelta >= 0.15 || Math.abs(a.width - b.width) >= 4 || Math.abs(a.height - b.height) >= 4,
    notEvaluable: false,
    aspectDelta: Math.round(aspectDelta * 1000) / 1000,
  };
}

function checkPairDiversityV2(planA, planB) {
  const dims = [
    { name: 'room_centroid', ...placementDiverse(planA, planB) },
    { name: 'adjacency_graph', ...adjacencyDiverse(planA, planB) },
    { name: 'circulation_topology', ...circulationDiverse(planA, planB) },
    { name: 'envelope_class', ...envelopeDiverse(planA, planB) },
  ];
  const diverseCount = dims.filter((dim) => dim.diverse).length;
  const placement = dims.some((dim) => (
    (dim.name === 'room_centroid' || dim.name === 'circulation_topology') && dim.diverse
  ));
  return {
    metricVersion: METRIC_VERSION,
    dims,
    diverseCount,
    notEvaluableCount: dims.filter((dim) => dim.notEvaluable).length,
    valid: diverseCount >= THRESHOLDS.minDimensions && placement,
  };
}

/* Both metrics on the same plan set, for the side-by-side the plan requires.
 * Reporting a difference here is a statement about measurement, not about the
 * engine having produced better plans. */
function validateVariationDiversityV2(planSpecs) {
  const plans = asArray(planSpecs), pairs = [];
  for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) {
    pairs.push({ i, j, ...checkPairDiversityV2(plans[i], plans[j]) });
  }
  const dimensionResults = ['room_centroid', 'adjacency_graph', 'circulation_topology', 'envelope_class'].map(name => {
    const dims = pairs.flatMap(pair => pair.dims.filter(dim => dim.name === name));
    return { name, diverse: dims.some(dim => dim.diverse),
      notEvaluableCount: dims.filter(dim => dim.notEvaluable).length,
      maxDelta: Math.max(0, ...dims.map(dim => dim.maxDelta || 0)),
      editDistance: Math.max(0, ...dims.map(dim => dim.editDistance || 0)),
      aspectDelta: Math.max(0, ...dims.map(dim => dim.aspectDelta || 0)) };
  });
  const failedPairs = pairs.filter(pair => !pair.valid).map(({ i, j, diverseCount, notEvaluableCount }) =>
    ({ i, j, diverseCount, notEvaluableCount }));
  return { metricVersion: METRIC_VERSION, valid: pairs.length > 0 && failedPairs.length === 0,
    diversityScore: dimensionResults.filter(dim => dim.diverse).length, dimensionResults, failedPairs,
    pairCount: pairs.length, validPairCount: pairs.filter(pair => pair.valid).length };
}

function compareMetrics(planSpecs) {
  const plans = asArray(planSpecs);
  const pairs = [];
  for (let i = 0; i < plans.length; i += 1) {
    for (let j = i + 1; j < plans.length; j += 1) {
      const legacy = v1.checkPairDiversity(plans[i], plans[j]);
      const corrected = checkPairDiversityV2(plans[i], plans[j]);
      pairs.push({
        pair: [i, j],
        v1: { valid: legacy.valid, diverseCount: legacy.diverseCount },
        v2: { valid: corrected.valid, diverseCount: corrected.diverseCount, notEvaluableCount: corrected.notEvaluableCount },
        agrees: legacy.valid === corrected.valid,
      });
    }
  }
  return {
    metricVersion: METRIC_VERSION,
    pairCount: pairs.length,
    v1ValidPairs: pairs.filter((pair) => pair.v1.valid).length,
    v2ValidPairs: pairs.filter((pair) => pair.v2.valid).length,
    disagreements: pairs.filter((pair) => !pair.agrees),
    pairs,
  };
}

module.exports = {
  METRIC_VERSION,
  THRESHOLDS,
  collectWholeRooms,
  stableRoomKey,
  buildAdjacencySet,
  checkPairDiversityV2,
  validateVariationDiversityV2,
  compareMetrics,
};
