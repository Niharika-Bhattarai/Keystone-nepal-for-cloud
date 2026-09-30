'use strict';

const { normalizeRoomType } = require('./tile/canonicalRoomTypes');
const { buildHallwayAnalysis } = require('./planQualityMetrics');
const {
  applyCellsToRoom,
  boundsFromCells,
  cellKey,
  isCellSetConnected,
  num,
  parseCellKey,
  roomArea,
  roomCentroid,
  roomToCells,
} = require('./planGeometry');

function cloneCellMap(level, tileSizeFt) {
  const roomCellsById = new Map();
  const ownerByCell = new Map();

  for (const room of Array.isArray(level?.rooms) ? level.rooms : []) {
    const id = String(room.id);
    const cells = roomToCells(room, tileSizeFt);
    roomCellsById.set(id, new Set(cells));
    for (const key of cells) ownerByCell.set(key, id);
  }

  return { roomCellsById, ownerByCell };
}

function neighborsOfCell(key) {
  const { x, y } = parseCellKey(key);
  return [
    cellKey(x - 1, y),
    cellKey(x + 1, y),
    cellKey(x, y - 1),
    cellKey(x, y + 1),
  ];
}

function setDifference(a, b) {
  const out = new Set();
  for (const item of a) {
    if (!b.has(item)) out.add(item);
  }
  return out;
}

function setUnion(...sets) {
  const out = new Set();
  for (const source of sets) {
    for (const item of source || []) out.add(item);
  }
  return out;
}

function pathWithinCells(cells, seedCells, targetCells) {
  const queue = [];
  const visited = new Set();
  const previous = new Map();
  for (const seed of seedCells) {
    if (!cells.has(seed)) continue;
    queue.push(seed);
    visited.add(seed);
  }

  while (queue.length) {
    const current = queue.shift();
    if (targetCells.has(current)) {
      const path = [];
      let cursor = current;
      while (cursor) {
        path.push(cursor);
        cursor = previous.get(cursor) || null;
      }
      path.reverse();
      return path;
    }
    for (const next of neighborsOfCell(current)) {
      if (!cells.has(next) || visited.has(next)) continue;
      visited.add(next);
      previous.set(next, current);
      queue.push(next);
    }
  }

  return null;
}

function roomPriority(type) {
  const normalized = normalizeRoomType(type);
  if (['living_room', 'kitchen', 'dining_room', 'primary_bedroom', 'bedroom', 'guest_bedroom'].includes(normalized)) return 5;
  if (['entry', 'mudroom', 'laundry', 'study'].includes(normalized)) return 4;
  if (['bathroom', 'primary_bathroom', 'powder_room'].includes(normalized)) return 3;
  if (['storage', 'closet', 'pantry', 'garage'].includes(normalized)) return 1;
  return 2;
}

function floodAssignCells(removedCells, roomCellsById, ownerByCell, roomById) {
  const assignments = new Map();
  const frontier = [];

  for (const removed of removedCells) {
    for (const neighbor of neighborsOfCell(removed)) {
      const roomId = ownerByCell.get(neighbor);
      if (!roomId) continue;
      const room = roomById.get(String(roomId));
      const type = normalizeRoomType(room?.type);
      if (['hallway', 'stairs'].includes(type)) continue;
      frontier.push({
        cell: removed,
        roomId: String(roomId),
        distance: 1,
        priority: roomPriority(room?.type),
      });
    }
  }

  while (frontier.length) {
    frontier.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.roomId !== b.roomId) return a.roomId.localeCompare(b.roomId);
      return a.cell.localeCompare(b.cell);
    });

    const current = frontier.shift();
    if (!removedCells.has(current.cell)) continue;
    const existing = assignments.get(current.cell);
    if (existing) continue;
    assignments.set(current.cell, current.roomId);

    for (const next of neighborsOfCell(current.cell)) {
      if (!removedCells.has(next) || assignments.has(next)) continue;
      frontier.push({
        cell: next,
        roomId: current.roomId,
        distance: current.distance + 1,
        priority: current.priority,
      });
    }
  }

  return assignments;
}

function cellsAdjacentToOther(cells, otherCells) {
  const result = new Set();
  for (const key of cells) {
    for (const neighbor of neighborsOfCell(key)) {
      if (otherCells.has(neighbor)) {
        result.add(key);
        break;
      }
    }
  }
  return result;
}

function cellsTouchingRoom(cells, roomCells) {
  return cellsAdjacentToOther(cells, roomCells);
}

function applyCellMapsToLevel(level, roomCellsById, tileSizeFt) {
  const nextRooms = [];
  for (const room of Array.isArray(level?.rooms) ? level.rooms : []) {
    const roomId = String(room.id);
    const cells = roomCellsById.get(roomId);
    if (!cells || cells.size === 0) continue;
    applyCellsToRoom(room, cells, tileSizeFt);
    nextRooms.push(room);
  }
  level.rooms = nextRooms;
}

function isEnsuiteOnly(room) {
  const type = normalizeRoomType(room?.type);
  if (type === 'primary_bathroom') return true;
  return type === 'bathroom' && String(room?.bathroomUse || '') === 'private' && Boolean(room?.attachedTo);
}

function compactHallLanding(level, tileSizeFt) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const roomById = new Map(rooms.map((room) => [String(room.id), room]));
  const stairs = rooms.find((room) => normalizeRoomType(room?.type) === 'stairs');
  const hallAnalysis = buildHallwayAnalysis(level, rooms, level?.doors || []);
  if (!stairs || hallAnalysis.hallRooms.length === 0) return false;

  const hallRatio = num(hallAnalysis.hallRatio, 0);
  if (hallRatio <= 0.14 && hallAnalysis.hallRooms.length <= 1) return false;

  const { roomCellsById, ownerByCell } = cloneCellMap(level, tileSizeFt);
  const stairCells = roomCellsById.get(String(stairs.id)) || new Set();
  const hallRoomIds = hallAnalysis.hallRooms.map((room) => String(room.id));
  const hallCells = new Set();
  for (const hallId of hallRoomIds) {
    for (const key of roomCellsById.get(hallId) || []) hallCells.add(key);
  }

  const seedCells = cellsAdjacentToOther(hallCells, stairCells);
  if (!seedCells.size) return false;

  const keepCells = new Set(seedCells);
  for (const hallCell of hallCells) {
    const { x: hx, y: hy } = parseCellKey(hallCell);
    const nearSeed = [...seedCells].some((seed) => {
      const { x: sx, y: sy } = parseCellKey(seed);
      return Math.abs(hx - sx) + Math.abs(hy - sy) <= 1;
    });
    if (nearSeed) keepCells.add(hallCell);
  }

  const targetRooms = rooms.filter((room) => {
    const type = normalizeRoomType(room?.type);
    if (['hallway', 'stairs', 'garage', 'storage'].includes(type)) return false;
    if (isEnsuiteOnly(room)) return false;
    return true;
  });

  for (const targetRoom of targetRooms) {
    const roomCells = roomCellsById.get(String(targetRoom.id)) || new Set();
    const boundaryCells = cellsTouchingRoom(hallCells, roomCells);
    if (!boundaryCells.size) continue;
    const path = pathWithinCells(hallCells, keepCells, boundaryCells);
    if (!path) continue;
    for (const key of path) keepCells.add(key);
  }

  const removedCells = setDifference(hallCells, keepCells);
  if (removedCells.size < 2) return false;

  const assignments = floodAssignCells(removedCells, roomCellsById, ownerByCell, roomById);
  if (assignments.size !== removedCells.size) return false;

  const nextRoomCells = new Map();
  for (const [roomId, cells] of roomCellsById.entries()) {
    nextRoomCells.set(roomId, new Set(cells));
  }

  const landingHallId = String(level?.stairCore?.hallRoomId || hallRoomIds[0]);
  for (const hallId of hallRoomIds) {
    nextRoomCells.set(hallId, new Set());
  }
  nextRoomCells.set(landingHallId, new Set(keepCells));

  for (const [cell, roomId] of assignments.entries()) {
    nextRoomCells.get(roomId).add(cell);
  }

  for (const room of rooms) {
    const type = normalizeRoomType(room?.type);
    if (['hallway', 'stairs'].includes(type)) continue;
    const cells = nextRoomCells.get(String(room.id));
    if (!cells || !cells.size || !isCellSetConnected(cells)) return false;
  }
  if (!isCellSetConnected(nextRoomCells.get(landingHallId) || new Set())) return false;

  applyCellMapsToLevel(level, nextRoomCells, tileSizeFt);
  return true;
}

function rectangleCells(x0, y0, w, h) {
  const cells = new Set();
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      cells.add(cellKey(x0 + dx, y0 + dy));
    }
  }
  return cells;
}

function chooseBathHostCandidates(level, bath, roomCellsById) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const bathId = String(bath.id);
  const bathCells = roomCellsById.get(bathId) || new Set();
  const bathCentroid = roomCentroid(bath);
  const candidates = [];

  for (const room of rooms) {
    const roomId = String(room.id);
    if (roomId === bathId) continue;
    const type = normalizeRoomType(room?.type);
    if (['stairs', 'garage', 'storage'].includes(type)) continue;
    const roomCells = roomCellsById.get(roomId) || new Set();
    const touching = cellsTouchingRoom(bathCells, roomCells);
    if (!touching.size) continue;
    let score = touching.size * 5;
    if (String(bath?.attachedTo || '') === roomId) score += 40;
    if (normalizeRoomType(bath?.type) === 'primary_bathroom' && type === 'primary_bedroom') score += 40;
    if (type === 'hallway' && !isEnsuiteOnly(bath)) score += 18;
    score += roomPriority(room?.type);
    const center = roomCentroid(room);
    score -= Math.abs(center.x - bathCentroid.x) + Math.abs(center.y - bathCentroid.y);
    candidates.push({ room, score });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function repairStripBathrooms(level, tileSizeFt) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  if (!rooms.length) return false;
  const roomById = new Map(rooms.map((room) => [String(room.id), room]));
  let changed = false;

  for (const bath of rooms) {
    const bathType = normalizeRoomType(bath?.type);
    if (!['bathroom', 'primary_bathroom', 'powder_room'].includes(bathType)) continue;

    const currentShortSide = Math.min(num(bath?.w), num(bath?.h));
    const currentLongSide = Math.max(num(bath?.w), num(bath?.h));
    const currentRatio = currentShortSide > 0 ? currentLongSide / currentShortSide : Infinity;
    if (currentRatio <= 3 && currentLongSide <= num(level?.width) * 0.55) continue;

    const { roomCellsById } = cloneCellMap(level, tileSizeFt);
    const bathId = String(bath.id);
    const bathCells = roomCellsById.get(bathId) || new Set();
    const bathTileCount = bathCells.size;
    if (!bathTileCount) continue;

    const hostCandidates = chooseBathHostCandidates(level, bath, roomCellsById);
    let applied = false;

    for (const candidate of hostCandidates) {
      const host = candidate.room;
      const hostId = String(host.id);
      const hostCells = roomCellsById.get(hostId) || new Set();
      const unionCells = setUnion(bathCells, hostCells);
      const bounds = boundsFromCells(unionCells, tileSizeFt);
      const boundsTilesW = Math.round(bounds.w / tileSizeFt);
      const boundsTilesH = Math.round(bounds.h / tileSizeFt);
      if (unionCells.size !== boundsTilesW * boundsTilesH) continue;

      const minShortTiles = bathType === 'powder_room' ? 2 : 3;
      const bathCentroid = roomCentroid(bath);
      const originX = Math.round(bounds.x / tileSizeFt);
      const originY = Math.round(bounds.y / tileSizeFt);

      let bestOption = null;
      for (let candidateW = minShortTiles; candidateW <= boundsTilesW; candidateW++) {
        if (bathTileCount % candidateW !== 0) continue;
        const candidateH = bathTileCount / candidateW;
        if (candidateH < minShortTiles || candidateH > boundsTilesH) continue;

        const corners = [
          { x: originX, y: originY },
          { x: originX + boundsTilesW - candidateW, y: originY },
          { x: originX, y: originY + boundsTilesH - candidateH },
          { x: originX + boundsTilesW - candidateW, y: originY + boundsTilesH - candidateH },
        ];

        for (const corner of corners) {
          const candidateBathCells = rectangleCells(corner.x, corner.y, candidateW, candidateH);
          const nextHostCells = setDifference(unionCells, candidateBathCells);
          if (!isCellSetConnected(nextHostCells)) continue;

          const candidateCenter = {
            x: (corner.x + candidateW / 2) * tileSizeFt,
            y: (corner.y + candidateH / 2) * tileSizeFt,
          };
          const ratio = Math.max(candidateW, candidateH) / Math.max(1, Math.min(candidateW, candidateH));
          const distancePenalty = Math.abs(candidateCenter.x - bathCentroid.x) + Math.abs(candidateCenter.y - bathCentroid.y);
          const score = ratio * 10 + distancePenalty;

          if (!bestOption || score < bestOption.score) {
            bestOption = {
              bathCells: candidateBathCells,
              hostCells: nextHostCells,
              score,
              ratio,
            };
          }
        }
      }

      if (!bestOption || bestOption.ratio >= currentRatio) continue;

      const nextRoomCells = new Map(roomCellsById);
      nextRoomCells.set(bathId, bestOption.bathCells);
      nextRoomCells.set(hostId, bestOption.hostCells);
      if (!isCellSetConnected(bestOption.bathCells) || !isCellSetConnected(bestOption.hostCells)) continue;

      applyCellMapsToLevel(level, nextRoomCells, tileSizeFt);
      changed = true;
      applied = true;
      break;
    }

    if (applied) {
      // Continue with refreshed geometry in case more bath strips can now be repaired.
      continue;
    }
  }

  return changed;
}

function reclusterOpenConceptPublicRooms(level, brief, tileSizeFt) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const living = rooms.find((room) => normalizeRoomType(room?.type) === 'living_room');
  const kitchen = rooms.find((room) => normalizeRoomType(room?.type) === 'kitchen');
  const dining = rooms.find((room) => normalizeRoomType(room?.type) === 'dining_room');
  if (!living || !kitchen || !dining) return false;

  const { roomCellsById } = cloneCellMap(level, tileSizeFt);
  const livingCells = roomCellsById.get(String(living.id)) || new Set();
  const kitchenCells = roomCellsById.get(String(kitchen.id)) || new Set();
  const diningCells = roomCellsById.get(String(dining.id)) || new Set();
  const unionCells = setUnion(livingCells, kitchenCells, diningCells);
  const bounds = boundsFromCells(unionCells, tileSizeFt);
  const unionW = Math.round(bounds.w / tileSizeFt);
  const unionH = Math.round(bounds.h / tileSizeFt);
  if (unionCells.size !== unionW * unionH) return false;

  const livingBounds = boundsFromCells(livingCells, tileSizeFt);
  const livingTouchesTop = num(livingBounds.y) === num(bounds.y);
  const livingTouchesBottom = num(livingBounds.y + livingBounds.h) === num(bounds.y + bounds.h);
  const livingTouchesLeft = num(livingBounds.x) === num(bounds.x);
  const livingTouchesRight = num(livingBounds.x + livingBounds.w) === num(bounds.x + bounds.w);

  const verticalAnchor = (livingTouchesTop && livingTouchesBottom) && !(livingTouchesLeft && livingTouchesRight);
  if (!verticalAnchor) return false;

  const livingOnLeft = livingTouchesLeft && !livingTouchesRight;
  const stripOriginX = Math.round((livingOnLeft ? (bounds.x + bounds.w) - tileSizeFt : bounds.x) / tileSizeFt);
  const kitchenTiles = kitchenCells.size;
  const diningTiles = diningCells.size;
  let stripWidth = null;
  for (let candidateW = 2; candidateW < unionW; candidateW++) {
    const kitchenH = Math.ceil(kitchenTiles / candidateW);
    const diningH = Math.ceil(diningTiles / candidateW);
    if (kitchenH + diningH <= unionH) {
      stripWidth = candidateW;
      break;
    }
  }
  if (!stripWidth) return false;

  const kitchenHeight = Math.ceil(kitchenTiles / stripWidth);
  const diningHeight = Math.ceil(diningTiles / stripWidth);
  const topFirst = (() => {
    const frontEdge = String(level?.facade?.frontEdge || brief?.frontFacing || '').toLowerCase();
    if (String(brief?.kitchenRear || '').toLowerCase() === 'true' || brief?.kitchenRear === true) {
      return frontEdge !== 'top';
    }
    return roomCentroid(kitchen).y <= roomCentroid(dining).y;
  })();

  const originX = livingOnLeft ? stripOriginX - stripWidth + 1 : Math.round(bounds.x / tileSizeFt);
  const originY = Math.round(bounds.y / tileSizeFt);
  const kitchenRect = topFirst
    ? rectangleCells(originX, originY, stripWidth, kitchenHeight)
    : rectangleCells(originX, originY + diningHeight, stripWidth, kitchenHeight);
  const diningRect = topFirst
    ? rectangleCells(originX, originY + kitchenHeight, stripWidth, diningHeight)
    : rectangleCells(originX, originY, stripWidth, diningHeight);

  const nextLivingCells = setDifference(unionCells, setUnion(kitchenRect, diningRect));
  if (!isCellSetConnected(nextLivingCells)) return false;

  const nextRoomCells = new Map(roomCellsById);
  nextRoomCells.set(String(living.id), nextLivingCells);
  nextRoomCells.set(String(kitchen.id), kitchenRect);
  nextRoomCells.set(String(dining.id), diningRect);
  applyCellMapsToLevel(level, nextRoomCells, tileSizeFt);
  return true;
}

function refineOrthogonalRooms(planSpec, options = {}) {
  const brief = options?.brief || {};
  const tileSizeFt = Math.max(1, num(planSpec?.tileSizeFt, 2));
  const openConcept = Boolean(planSpec?.openConcept || brief?.openConcept);

  for (const level of Array.isArray(planSpec?.levels) ? planSpec.levels : []) {
    compactHallLanding(level, tileSizeFt);
    if (openConcept && num(level?.level, 1) === 1) {
      reclusterOpenConceptPublicRooms(level, brief, tileSizeFt);
    }
    repairStripBathrooms(level, tileSizeFt);
  }

  return planSpec;
}

module.exports = {
  refineOrthogonalRooms,
};
