'use strict';

const { normalizeRoomType, isPublicRoomType } = require('./tile/canonicalRoomTypes');
const { buildAccessGraph, chooseEntryRoom } = require('./residential/accessGraph');
const {
  num,
  roomArea,
  roomCentroid,
  shareWall,
  touchesExterior,
} = require('./planGeometry');

function isCirculationLikeType(type) {
  return ['hallway', 'stairs', 'entry', 'mudroom', 'laundry'].includes(type);
}

function buildHallwayAnalysis(level, rooms = null, doors = null) {
  const allRooms = Array.isArray(rooms) ? rooms : (Array.isArray(level?.rooms) ? level.rooms : []);
  const allDoors = Array.isArray(doors) ? doors : (Array.isArray(level?.doors) ? level.doors : []);
  const hallRooms = allRooms.filter((room) => normalizeRoomType(room?.type) === 'hallway');
  const stairCore = level?.stairCore || null;
  const byId = new Map(hallRooms.map((room) => [String(room.id), room]));
  const graph = new Map(hallRooms.map((room) => [String(room.id), new Set()]));

  const coreAlignedIds = new Set(
    hallRooms
      .filter((room) =>
        stairCore &&
        num(room?.x) === num(stairCore?.x) &&
        num(room?.w) === num(stairCore?.w)
      )
      .map((room) => String(room.id))
  );

  const addEdge = (a, b) => {
    const A = String(a || '');
    const B = String(b || '');
    if (!graph.has(A) || !graph.has(B) || A === B) return;
    graph.get(A).add(B);
    graph.get(B).add(A);
  };

  for (let i = 0; i < hallRooms.length; i++) {
    for (let j = i + 1; j < hallRooms.length; j++) {
      if (shareWall(hallRooms[i], hallRooms[j], 1)) {
        addEdge(hallRooms[i].id, hallRooms[j].id);
      }
    }
  }

  const stairToHalls = new Map();
  for (const door of allDoors) {
    const a = String(door?.a || '');
    const b = String(door?.b || '');
    const aHall = byId.has(a);
    const bHall = byId.has(b);
    if (aHall && bHall) addEdge(a, b);

    const roomA = allRooms.find((room) => String(room.id) === a);
    const roomB = allRooms.find((room) => String(room.id) === b);
    const stairId =
      normalizeRoomType(roomA?.type) === 'stairs' ? a :
      normalizeRoomType(roomB?.type) === 'stairs' ? b :
      null;
    const hallId = aHall ? a : (bHall ? b : null);
    if (stairId && hallId) {
      if (!stairToHalls.has(stairId)) stairToHalls.set(stairId, new Set());
      stairToHalls.get(stairId).add(hallId);
    }
  }

  for (const hallIds of stairToHalls.values()) {
    const arr = [...hallIds];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) addEdge(arr[i], arr[j]);
    }
  }

  const visited = new Set();
  const components = [];
  for (const room of hallRooms) {
    const id = String(room.id);
    if (visited.has(id)) continue;
    const queue = [id];
    const component = new Set([id]);
    visited.add(id);
    while (queue.length) {
      const current = queue.shift();
      for (const next of graph.get(current) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        component.add(next);
        queue.push(next);
      }
    }
    components.push(component);
  }

  const effectiveHallRooms = hallRooms.filter((room) => !coreAlignedIds.has(String(room.id)));
  const hallArea = effectiveHallRooms.reduce((sum, room) => sum + roomArea(room), 0);
  const levelArea = Math.max(1, num(level?.width) * num(level?.height));
  const hallRatio = hallArea / levelArea;
  const hallRoomId = String(level?.stairCore?.hallRoomId || '');
  const landingComponent = components.find((component) => component.has(hallRoomId)) || null;
  const intentionalConnected =
    effectiveHallRooms.length > 0 &&
    components.length === 1 &&
    effectiveHallRooms.length <= 4;

  return {
    hallRooms,
    effectiveHallRooms,
    coreAlignedIds,
    hallArea,
    hallRatio,
    levelArea,
    components,
    landingComponent,
    intentionalConnected,
  };
}

function isEnsuiteOnly(room) {
  const type = normalizeRoomType(room?.type);
  if (type === 'primary_bathroom') return true;
  return type === 'bathroom' && String(room?.bathroomUse || '') === 'private' && Boolean(room?.attachedTo);
}

function isTravelRelevantRoom(room) {
  const type = normalizeRoomType(room?.type);
  if (!type) return false;
  if (['hallway', 'stairs', 'garage', 'storage', 'closet', 'pantry'].includes(type)) return false;
  if (isEnsuiteOnly(room)) return false;
  return true;
}

function shortestTravelFromEntry(level, brief = null) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const byId = new Map(rooms.map((room) => [String(room.id), room]));
  const graph = buildAccessGraph(level, brief);
  const entryRoom = chooseEntryRoom(level);

  if (!entryRoom) {
    return {
      entryRoomId: null,
      averageDistanceFt: null,
      maxDistanceFt: null,
      averageSteps: null,
      maxSteps: null,
      roomCount: 0,
      disconnectedRoomIds: [],
      distancesByRoomId: {},
      stepsByRoomId: {},
    };
  }

  const startId = String(entryRoom.id);
  const distances = new Map([[startId, 0]]);
  const steps = new Map([[startId, 0]]);
  const queue = [startId];

  while (queue.length) {
    queue.sort((a, b) => (distances.get(a) || Infinity) - (distances.get(b) || Infinity));
    const current = queue.shift();
    const currentRoom = byId.get(current);
    const currentCenter = roomCentroid(currentRoom);

    for (const next of graph.get(current) || []) {
      const nextRoom = byId.get(String(next));
      if (!nextRoom) continue;
      const nextCenter = roomCentroid(nextRoom);
      const travelCost = Math.max(
        4,
        Math.abs(nextCenter.x - currentCenter.x) + Math.abs(nextCenter.y - currentCenter.y)
      );
      const nextDistance = (distances.get(current) || 0) + travelCost;
      if (nextDistance >= (distances.get(next) ?? Infinity)) continue;
      distances.set(next, nextDistance);
      steps.set(next, (steps.get(current) || 0) + 1);
      if (!queue.includes(next)) queue.push(next);
    }
  }

  const targetRooms = rooms.filter(isTravelRelevantRoom);
  const disconnectedRoomIds = targetRooms
    .map((room) => String(room.id))
    .filter((id) => !distances.has(id));

  const resolvedIds = targetRooms
    .map((room) => String(room.id))
    .filter((id) => distances.has(id));
  const resolvedDistances = resolvedIds.map((id) => distances.get(id));
  const resolvedSteps = resolvedIds.map((id) => steps.get(id));
  const bedroomIds = targetRooms
    .filter((room) => {
      const type = normalizeRoomType(room?.type);
      return type === 'bedroom' || type === 'primary_bedroom' || type === 'guest_bedroom';
    })
    .map((room) => String(room.id))
    .filter((id) => steps.has(id));

  const averageDistanceFt = resolvedDistances.length
    ? resolvedDistances.reduce((sum, value) => sum + value, 0) / resolvedDistances.length
    : null;
  const maxDistanceFt = resolvedDistances.length ? Math.max(...resolvedDistances) : null;
  const averageSteps = resolvedSteps.length
    ? resolvedSteps.reduce((sum, value) => sum + value, 0) / resolvedSteps.length
    : null;
  const maxSteps = resolvedSteps.length ? Math.max(...resolvedSteps) : null;
  const bedroomAverageSteps = bedroomIds.length
    ? bedroomIds.reduce((sum, id) => sum + (steps.get(id) || 0), 0) / bedroomIds.length
    : null;

  return {
    entryRoomId: startId,
    averageDistanceFt,
    maxDistanceFt,
    averageSteps,
    maxSteps,
    bedroomAverageSteps,
    roomCount: targetRooms.length,
    disconnectedRoomIds,
    distancesByRoomId: Object.fromEntries([...distances.entries()]),
    stepsByRoomId: Object.fromEntries([...steps.entries()]),
  };
}

function computeLevelQualityMetrics(level, brief = null) {
  const hallAnalysis = buildHallwayAnalysis(level);
  const entryTravel = shortestTravelFromEntry(level, brief);
  const stories = Math.max(1, num(brief?.stories || 1));
  const isLevel2 = num(level?.level, 1) === 2;
  const preferredHallRatio =
    stories === 2 && isLevel2 ? 0.14 :
    stories === 2 ? 0.12 :
    0.10;

  return {
    level: num(level?.level, 1),
    hall: {
      hallArea: hallAnalysis.hallArea,
      hallRatio: hallAnalysis.hallRatio,
      preferredHallRatio,
      roomCount: hallAnalysis.hallRooms.length,
      componentCount: hallAnalysis.components.length,
      intentionalConnected: hallAnalysis.intentionalConnected,
    },
    entryTravel,
  };
}

function computePlanQualityMetrics(planSpec, brief = null) {
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  const levelMetrics = levels.map((level) => computeLevelQualityMetrics(level, brief));
  return {
    levels: levelMetrics,
  };
}

function scorePlanQualityMetrics(metrics, brief = null) {
  let delta = 0;
  const issues = [];
  const warnings = [];

  for (const levelMetric of Array.isArray(metrics?.levels) ? metrics.levels : []) {
    const hallRatio = num(levelMetric?.hall?.hallRatio, 0);
    const preferredHallRatio = num(levelMetric?.hall?.preferredHallRatio, 0.12);
    const hallOverage = hallRatio - preferredHallRatio;
    if (hallOverage > 0) {
      const penalty = Math.round(hallOverage * 220);
      delta -= penalty;
      issues.push(`quality_hall_ratio:L${levelMetric.level}:${hallRatio.toFixed(2)}>${preferredHallRatio.toFixed(2)}`);
    } else if (hallRatio > 0 && hallRatio <= preferredHallRatio * 0.8) {
      delta += 2;
    }

    const averageSteps = levelMetric?.entryTravel?.averageSteps;
    const maxSteps = levelMetric?.entryTravel?.maxSteps;
    const averageDistanceFt = levelMetric?.entryTravel?.averageDistanceFt;
    const disconnected = Array.isArray(levelMetric?.entryTravel?.disconnectedRoomIds)
      ? levelMetric.entryTravel.disconnectedRoomIds
      : [];

    if (disconnected.length) {
      delta -= 40;
      issues.push(`quality_entry_travel_disconnected:L${levelMetric.level}:${disconnected.join('|')}`);
    }

    if (Number.isFinite(averageSteps) && averageSteps > 2.8) {
      delta -= Math.round((averageSteps - 2.8) * 12);
      issues.push(`quality_entry_avg_steps:L${levelMetric.level}:${averageSteps.toFixed(2)}`);
    }

    if (Number.isFinite(maxSteps) && maxSteps > 4) {
      delta -= Math.round((maxSteps - 4) * 5);
      issues.push(`quality_entry_max_steps:L${levelMetric.level}:${maxSteps}`);
    }

    if (Number.isFinite(averageDistanceFt) && averageDistanceFt > 34) {
      delta -= Math.round((averageDistanceFt - 34) / 3);
      warnings.push(`quality_entry_avg_distance:L${levelMetric.level}:${averageDistanceFt.toFixed(1)}ft`);
    }

    const bedroomAverageSteps = levelMetric?.entryTravel?.bedroomAverageSteps;
    if (Number.isFinite(bedroomAverageSteps) && num(levelMetric.level) === 1 && num(brief?.stories, 1) === 1 && bedroomAverageSteps < 1.5) {
      delta -= 4;
      warnings.push(`quality_bedroom_privacy_shallow:L${levelMetric.level}:${bedroomAverageSteps.toFixed(2)}`);
    }
  }

  return { delta, issues, warnings };
}

module.exports = {
  buildHallwayAnalysis,
  computeLevelQualityMetrics,
  computePlanQualityMetrics,
  scorePlanQualityMetrics,
  shortestTravelFromEntry,
};
