'use strict';

const { normalizeRoomType } = require('../../../tile/canonicalRoomTypes');
const { buildAccessGraph, shortestPath } = require('../../accessGraph');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function levelByNumber(planSpec, levelNumber) {
  return (Array.isArray(planSpec?.levels) ? planSpec.levels : [])
    .find((level) => num(level?.level, 1) === num(levelNumber, 1)) || null;
}

function roomByIdMap(planSpec) {
  const rooms = (Array.isArray(planSpec?.levels) ? planSpec.levels : [])
    .flatMap((level) => Array.isArray(level?.rooms) ? level.rooms : []);
  return new Map(rooms.map((room) => [String(room?.id || ''), room]).filter(([id]) => id));
}

function stackedStairMatch(roomA, roomB) {
  return (
    num(roomA?.x) === num(roomB?.x) &&
    num(roomA?.y) === num(roomB?.y) &&
    num(roomA?.w) === num(roomB?.w) &&
    num(roomA?.h) === num(roomB?.h)
  );
}

function crossLevelSatisfied(nodeA, nodeB, roomA, roomB) {
  const typeA = normalizeRoomType(nodeA?.type || roomA?.type);
  const typeB = normalizeRoomType(nodeB?.type || roomB?.type);
  if (typeA === 'stairs' && typeB === 'stairs') {
    return stackedStairMatch(roomA, roomB);
  }
  return false;
}

function scoreAdjacencySatisfaction({ planSpec, brief, graph }) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = (Array.isArray(graph?.edges) ? graph.edges : [])
    .filter((edge) => String(edge?.kind || 'required_adjacency') === 'required_adjacency');

  if (!nodes.length || !edges.length) {
    return { score: 100, issues: [], warnings: [] };
  }

  const nodeByKey = new Map(nodes.map((node) => [String(node?.key || ''), node]).filter(([key]) => key));
  const roomsById = roomByIdMap(planSpec);
  const accessGraphByLevel = new Map();

  function ensureAccessGraph(levelNumber) {
    const key = num(levelNumber, 1);
    if (accessGraphByLevel.has(key)) return accessGraphByLevel.get(key);
    const level = levelByNumber(planSpec, key);
    if (!level) return null;
    const graphForLevel = buildAccessGraph(level, brief);
    accessGraphByLevel.set(key, graphForLevel);
    return graphForLevel;
  }

  let totalRequired = 0;
  let satisfiedRequired = 0;
  const issues = [];
  const warnings = [];

  for (const edge of edges) {
    const fromKey = String(edge?.from || '');
    const toKey = String(edge?.to || '');
    const fromNode = nodeByKey.get(fromKey);
    const toNode = nodeByKey.get(toKey);
    if (!fromNode || !toNode) {
      warnings.push(`adjacency:missing_node:${fromKey}->${toKey}`);
      continue;
    }

    const fromRoom = roomsById.get(String(fromNode?.roomId || ''));
    const toRoom = roomsById.get(String(toNode?.roomId || ''));
    if (!fromRoom || !toRoom) {
      issues.push(`adjacency:missing_room:${fromKey}->${toKey}`);
      totalRequired += 1;
      continue;
    }

    totalRequired += 1;
    const sameLevel = num(fromNode?.level, 1) === num(toNode?.level, 1);
    let satisfied = false;

    if (sameLevel) {
      const accessGraph = ensureAccessGraph(fromNode?.level);
      const path = accessGraph ? shortestPath(accessGraph, fromRoom.id, toRoom.id) : null;
      satisfied = Array.isArray(path) && path.length > 0;
    } else {
      satisfied = crossLevelSatisfied(fromNode, toNode, fromRoom, toRoom);
    }

    if (satisfied) satisfiedRequired += 1;
    else issues.push(`adjacency:missing:${fromKey}->${toKey}`);
  }

  if (totalRequired <= 0) {
    return { score: 100, issues, warnings };
  }

  const score = Math.max(0, Math.min(100, Math.round((satisfiedRequired / totalRequired) * 100)));
  return { score, issues, warnings };
}

module.exports = {
  scoreAdjacencySatisfaction,
};

