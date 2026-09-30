'use strict';

/**
 * Variation Diversity Validator
 *
 * Enforces that surfaced alternatives are functionally different.
 * Works with either:
 * - lightweight `plan.rooms` payloads
 * - full `plan.levels[].rooms` planSpec-style payloads
 */

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeType(value) {
  return String(value || '').trim().toLowerCase();
}

function roomWidth(room) {
  return num(room?.widthFt, num(room?.w, num(room?.width, 0)));
}

function roomHeight(room) {
  return num(room?.heightFt, num(room?.h, num(room?.height, 0)));
}

function roomLevel(room, fallback = 1) {
  return num(room?.level, fallback);
}

function roomCentroid(room) {
  return {
    x: num(room?.x) + roomWidth(room) / 2,
    y: num(room?.y) + roomHeight(room) / 2,
  };
}

function normalizeRoom(room, levelFallback = 1, index = 0) {
  const widthFt = roomWidth(room);
  const heightFt = roomHeight(room);
  if (widthFt <= 0 || heightFt <= 0) return null;
  const type = normalizeType(room?.type || room?.roomType || room?.name);
  if (!type) return null;
  return {
    id: String(room?.id || `${type}_${roomLevel(room, levelFallback)}_${index}`),
    type,
    label: String(room?.label || room?.name || ''),
    x: num(room?.x),
    y: num(room?.y),
    widthFt,
    heightFt,
    level: roomLevel(room, levelFallback),
  };
}

function collectPlanRooms(plan) {
  const directRooms = asArray(plan?.rooms);
  if (directRooms.length) {
    return directRooms
      .map((room, index) => normalizeRoom(room, roomLevel(room, 1), index))
      .filter(Boolean);
  }

  const flattened = [];
  for (const level of asArray(plan?.levels)) {
    const levelNum = roomLevel(level, 1);
    for (const room of asArray(level?.rooms)) {
      const parts = asArray(room?.parts);
      if (parts.length) {
        parts.forEach((part, partIndex) => {
          const merged = {
            ...room,
            ...part,
            level: levelNum,
            id: room?.id ? `${room.id}_part_${partIndex + 1}` : undefined,
          };
          const normalized = normalizeRoom(merged, levelNum, partIndex);
          if (normalized) flattened.push(normalized);
        });
      } else {
        const normalized = normalizeRoom(room, levelNum, flattened.length);
        if (normalized) flattened.push(normalized);
      }
    }
  }
  return flattened;
}

function isMajorRoomType(type) {
  const t = normalizeType(type);
  return (
    t === 'living_room' ||
    t === 'great_room' ||
    t === 'family_room' ||
    t === 'kitchen' ||
    t === 'dining_room' ||
    t === 'primary_bedroom' ||
    t === 'bedroom' ||
    t === 'study' ||
    t === 'library' ||
    t === 'gym'
  );
}

function signatureForRoom(room) {
  const c = roomCentroid(room);
  const gridX = Math.round(c.x / 2);
  const gridY = Math.round(c.y / 2);
  const areaBucket = Math.round((room.widthFt * room.heightFt) / 20);
  return `${room.type}@L${room.level}:${gridX}_${gridY}:${areaBucket}`;
}

function sortByCentroid(rooms) {
  return [...rooms].sort((a, b) => {
    const ca = roomCentroid(a);
    const cb = roomCentroid(b);
    if (ca.x !== cb.x) return ca.x - cb.x;
    if (ca.y !== cb.y) return ca.y - cb.y;
    return (a.widthFt * a.heightFt) - (b.widthFt * b.heightFt);
  });
}

function centroidDeltaDiverse(planA, planB) {
  const roomsA = collectPlanRooms(planA).filter((room) => isMajorRoomType(room.type));
  const roomsB = collectPlanRooms(planB).filter((room) => isMajorRoomType(room.type));
  if (roomsA.length < 2 || roomsB.length < 2) return { diverse: true, maxDelta: 0, shiftedCount: 0 };

  const groupedA = new Map();
  const groupedB = new Map();
  for (const room of roomsA) {
    if (!groupedA.has(room.type)) groupedA.set(room.type, []);
    groupedA.get(room.type).push(room);
  }
  for (const room of roomsB) {
    if (!groupedB.has(room.type)) groupedB.set(room.type, []);
    groupedB.get(room.type).push(room);
  }

  let shiftedCount = 0;
  let maxDelta = 0;
  const allTypes = new Set([...groupedA.keys(), ...groupedB.keys()]);

  for (const type of allTypes) {
    const aRooms = sortByCentroid(groupedA.get(type) || []);
    const bRooms = sortByCentroid(groupedB.get(type) || []);
    const pairCount = Math.max(aRooms.length, bRooms.length);
    for (let i = 0; i < pairCount; i++) {
      const a = aRooms[i];
      const b = bRooms[i];
      if (!a || !b) {
        shiftedCount += 1;
        continue;
      }
      const ca = roomCentroid(a);
      const cb = roomCentroid(b);
      const delta = Math.hypot(ca.x - cb.x, ca.y - cb.y);
      if (delta >= 6) shiftedCount += 1;
      maxDelta = Math.max(maxDelta, delta);
    }
  }

  return { diverse: shiftedCount >= 2, maxDelta, shiftedCount };
}

function roomEdge(room) {
  const x = num(room?.x);
  const y = num(room?.y);
  const w = roomWidth(room);
  const h = roomHeight(room);
  return { x1: x, y1: y, x2: x + w, y2: y + h };
}

function touchesByEdge(a, b, tolerance = 0.25) {
  if (a.level !== b.level) return false;
  const ea = roomEdge(a);
  const eb = roomEdge(b);

  const horizontalOverlap = ea.x1 < eb.x2 - tolerance && eb.x1 < ea.x2 - tolerance;
  const verticalOverlap = ea.y1 < eb.y2 - tolerance && eb.y1 < ea.y2 - tolerance;

  const verticalTouch = Math.abs(ea.x2 - eb.x1) <= tolerance || Math.abs(eb.x2 - ea.x1) <= tolerance;
  const horizontalTouch = Math.abs(ea.y2 - eb.y1) <= tolerance || Math.abs(eb.y2 - ea.y1) <= tolerance;

  return (verticalTouch && verticalOverlap) || (horizontalTouch && horizontalOverlap);
}

function buildAdjacencySet(plan) {
  const rooms = collectPlanRooms(plan);
  const set = new Set();
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (!touchesByEdge(a, b)) continue;
      const key = [signatureForRoom(a), signatureForRoom(b)].sort().join('|');
      set.add(key);
    }
  }
  return set;
}

function adjacencyEditDistance(planA, planB) {
  const setA = buildAdjacencySet(planA);
  const setB = buildAdjacencySet(planB);
  if (setA.size === 0 && setB.size === 0) return { diverse: true, editDistance: 0 };

  let diff = 0;
  for (const key of setA) if (!setB.has(key)) diff += 1;
  for (const key of setB) if (!setA.has(key)) diff += 1;

  return { diverse: diff >= 3, editDistance: diff };
}

function isCirculationType(type) {
  const t = normalizeType(type);
  return t === 'hallway' || t === 'landing' || t === 'stairs' || t === 'loft';
}

function circulationSummary(plan) {
  const circulation = collectPlanRooms(plan).filter((room) => isCirculationType(room.type));
  if (!circulation.length) {
    return {
      stairsZone: 'none',
      hallwayCount: 0,
      landingCount: 0,
      loftCount: 0,
      hallOrientation: 'none',
      centerX: 0,
    };
  }

  const stairs = circulation.filter((room) => room.type === 'stairs');
  const landings = circulation.filter((room) => room.type === 'landing');
  const lofts = circulation.filter((room) => room.type === 'loft');
  const hallways = circulation.filter((room) => room.type === 'hallway');

  let stairsZone = 'none';
  if (stairs.length) {
    const centers = stairs.map((room) => roomCentroid(room).x);
    const avg = centers.reduce((sum, x) => sum + x, 0) / centers.length;
    const allRooms = collectPlanRooms(plan);
    const maxX = Math.max(1, ...allRooms.map((room) => roomEdge(room).x2));
    if (avg < maxX * 0.33) stairsZone = 'left';
    else if (avg > maxX * 0.66) stairsZone = 'right';
    else stairsZone = 'center';
  }

  const hallOrientation = hallways.length
    ? (
      hallways.filter((room) => room.widthFt >= room.heightFt).length >= Math.ceil(hallways.length / 2)
        ? 'horizontal'
        : 'vertical'
    )
    : 'none';

  const centerX = circulation.reduce((sum, room) => sum + roomCentroid(room).x, 0) / circulation.length;

  return {
    stairsZone,
    hallwayCount: hallways.length,
    landingCount: landings.length,
    loftCount: lofts.length,
    hallOrientation,
    centerX,
  };
}

function circulationTopologyDiverse(planA, planB) {
  const a = circulationSummary(planA);
  const b = circulationSummary(planB);

  if (a.hallwayCount === 0 && b.hallwayCount === 0 && a.landingCount === 0 && b.landingCount === 0) {
    return { diverse: true, maxDelta: 0 };
  }

  const centerDelta = Math.abs(a.centerX - b.centerX);
  const hallDelta = Math.abs(a.hallwayCount - b.hallwayCount);
  const landingDelta = Math.abs(a.landingCount - b.landingCount);
  const loftDelta = Math.abs(a.loftCount - b.loftCount);
  const stairZoneChanged = a.stairsZone !== b.stairsZone;
  const orientationChanged = a.hallOrientation !== b.hallOrientation;

  const diverse =
    stairZoneChanged ||
    orientationChanged ||
    hallDelta >= 1 ||
    landingDelta >= 1 ||
    loftDelta >= 1 ||
    centerDelta >= 5;

  return {
    diverse,
    maxDelta: centerDelta,
    hallDelta,
    landingDelta,
    loftDelta,
    stairZoneChanged,
    orientationChanged,
  };
}

function footprintInfo(plan) {
  const fp = plan?.footprint || {};
  const widthFt = num(fp.widthFt, 40);
  const heightFt = num(fp.heightFt, 30);
  const aspectRatio = num(fp.aspectRatio, widthFt / Math.max(1, heightFt));
  return { widthFt, heightFt, aspectRatio };
}

function envelopeClassDiverse(planA, planB) {
  const a = footprintInfo(planA);
  const b = footprintInfo(planB);
  const aspectDelta = Math.abs(a.aspectRatio - b.aspectRatio);
  const widthDelta = Math.abs(a.widthFt - b.widthFt);
  const heightDelta = Math.abs(a.heightFt - b.heightFt);
  return {
    diverse: aspectDelta >= 0.2 || widthDelta >= 6 || heightDelta >= 4,
    aspectDelta,
    widthDelta,
    heightDelta,
  };
}

function checkPairDiversity(planA, planB) {
  const dims = [
    { name: 'room_centroid', ...centroidDeltaDiverse(planA, planB) },
    { name: 'adjacency_graph', ...adjacencyEditDistance(planA, planB) },
    { name: 'circulation_topology', ...circulationTopologyDiverse(planA, planB) },
    { name: 'envelope_class', ...envelopeClassDiverse(planA, planB) },
  ];

  const diverseCount = dims.filter((dim) => dim.diverse).length;
  const placementDiverse = dims.some((dim) => (
    (dim.name === 'room_centroid' || dim.name === 'circulation_topology') && dim.diverse
  ));

  return {
    dims,
    diverseCount,
    valid: diverseCount >= 2 && placementDiverse,
  };
}

function validateVariationDiversity(planSpecs) {
  if (!Array.isArray(planSpecs) || planSpecs.length <= 1) {
    return {
      valid: true,
      diversityScore: 0,
      dimensionResults: [],
      failedPairs: [],
    };
  }

  const failedPairs = [];
  const dimTotals = {
    room_centroid: { diverse: false, maxDelta: 0 },
    adjacency_graph: { diverse: false, maxEditDistance: 0 },
    circulation_topology: { diverse: false, maxDelta: 0 },
    envelope_class: { diverse: false, maxAspectDelta: 0 },
  };

  for (let i = 0; i < planSpecs.length; i++) {
    for (let j = i + 1; j < planSpecs.length; j++) {
      const pair = checkPairDiversity(planSpecs[i], planSpecs[j]);
      if (!pair.valid) {
        failedPairs.push({ i, j, diverseCount: pair.diverseCount });
      }

      for (const dim of pair.dims) {
        if (dim.diverse) dimTotals[dim.name].diverse = true;
        if (dim.name === 'room_centroid') dimTotals[dim.name].maxDelta = Math.max(dimTotals[dim.name].maxDelta, dim.maxDelta || 0);
        if (dim.name === 'adjacency_graph') dimTotals[dim.name].maxEditDistance = Math.max(dimTotals[dim.name].maxEditDistance, dim.editDistance || 0);
        if (dim.name === 'circulation_topology') dimTotals[dim.name].maxDelta = Math.max(dimTotals[dim.name].maxDelta, dim.maxDelta || 0);
        if (dim.name === 'envelope_class') dimTotals[dim.name].maxAspectDelta = Math.max(dimTotals[dim.name].maxAspectDelta, dim.aspectDelta || 0);
      }
    }
  }

  const diversityScore = Object.values(dimTotals).filter((dim) => dim.diverse).length;

  return {
    valid: failedPairs.length === 0,
    diversityScore,
    dimensionResults: [
      { name: 'room_centroid', diverse: dimTotals.room_centroid.diverse, maxDelta: dimTotals.room_centroid.maxDelta },
      { name: 'adjacency_graph', diverse: dimTotals.adjacency_graph.diverse, editDistance: dimTotals.adjacency_graph.maxEditDistance },
      { name: 'circulation_topology', diverse: dimTotals.circulation_topology.diverse, maxDelta: dimTotals.circulation_topology.maxDelta },
      { name: 'envelope_class', diverse: dimTotals.envelope_class.diverse, aspectDelta: dimTotals.envelope_class.maxAspectDelta },
    ],
    failedPairs,
  };
}

module.exports = {
  collectPlanRooms,
  checkPairDiversity,
  validateVariationDiversity,
};
