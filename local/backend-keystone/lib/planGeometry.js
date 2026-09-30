'use strict';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function rectOf(room) {
  return {
    x: num(room?.x),
    y: num(room?.y),
    w: num(room?.w),
    h: num(room?.h),
    x2: num(room?.x) + num(room?.w),
    y2: num(room?.y) + num(room?.h),
  };
}

function partListOf(room) {
  if (Array.isArray(room?.parts) && room.parts.length > 0) {
    return room.parts.map((part) => rectOf(part));
  }
  return [rectOf(room)];
}

function boundingRectOf(room) {
  const parts = partListOf(room);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const part of parts) {
    minX = Math.min(minX, part.x);
    minY = Math.min(minY, part.y);
    maxX = Math.max(maxX, part.x2);
    maxY = Math.max(maxY, part.y2);
  }

  if (!Number.isFinite(minX)) return rectOf(room);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, x2: maxX, y2: maxY };
}

function roomArea(room) {
  return partListOf(room).reduce((sum, part) => sum + (part.w * part.h), 0);
}

function overlapLen(a1, a2, b1, b2) {
  const lo = Math.max(a1, b1);
  const hi = Math.min(a2, b2);
  return Math.max(0, hi - lo);
}

function sharedWallRect(a, b, minSeg = 1) {
  if (a.x2 === b.x || b.x2 === a.x) {
    const seg = overlapLen(a.y, a.y2, b.y, b.y2);
    if (seg >= minSeg) {
      return { kind: 'vertical', seg, x: a.x2 === b.x ? a.x2 : b.x2 };
    }
  }
  if (a.y2 === b.y || b.y2 === a.y) {
    const seg = overlapLen(a.x, a.x2, b.x, b.x2);
    if (seg >= minSeg) {
      return { kind: 'horizontal', seg, y: a.y2 === b.y ? a.y2 : b.y2 };
    }
  }
  return null;
}

function shareWall(a, b, minSeg = 1) {
  let best = null;
  for (const partA of partListOf(a)) {
    for (const partB of partListOf(b)) {
      const wall = sharedWallRect(partA, partB, minSeg);
      if (wall && (!best || wall.seg > best.seg)) best = wall;
    }
  }
  return best;
}

function roomsOverlap(a, b) {
  for (const partA of partListOf(a)) {
    for (const partB of partListOf(b)) {
      const overlaps =
        partA.x < partB.x2 &&
        partA.x2 > partB.x &&
        partA.y < partB.y2 &&
        partA.y2 > partB.y;
      if (overlaps) return true;
    }
  }
  return false;
}

function touchesExterior(room, lvlW, lvlH) {
  return partListOf(room).some((part) => (
    part.x === 0 || part.y === 0 || part.x2 === num(lvlW) || part.y2 === num(lvlH)
  ));
}

function pointOnBoundaryOfRoom(room, x, y, eps = 1e-6) {
  const px = num(x);
  const py = num(y);
  return partListOf(room).some((part) => {
    const withinX = px >= part.x - eps && px <= part.x2 + eps;
    const withinY = py >= part.y - eps && py <= part.y2 + eps;
    if (!withinX || !withinY) return false;
    const onVertical = Math.abs(px - part.x) <= eps || Math.abs(px - part.x2) <= eps;
    const onHorizontal = Math.abs(py - part.y) <= eps || Math.abs(py - part.y2) <= eps;
    return onVertical || onHorizontal;
  });
}

function roomCentroid(room) {
  const parts = partListOf(room);
  let totalArea = 0;
  let xSum = 0;
  let ySum = 0;

  for (const part of parts) {
    const area = part.w * part.h;
    totalArea += area;
    xSum += (part.x + part.w / 2) * area;
    ySum += (part.y + part.h / 2) * area;
  }

  if (totalArea <= 0) {
    const bounds = boundingRectOf(room);
    return {
      x: bounds.x + bounds.w / 2,
      y: bounds.y + bounds.h / 2,
    };
  }

  return {
    x: xSum / totalArea,
    y: ySum / totalArea,
  };
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function parseCellKey(key) {
  const [x, y] = String(key || '').split(',').map((value) => Number(value));
  return { x, y };
}

function roomToCells(room, tileSizeFt = 2) {
  const cells = new Set();
  const safeTile = Math.max(1, num(tileSizeFt, 2));

  for (const part of partListOf(room)) {
    const startX = Math.round(part.x / safeTile);
    const startY = Math.round(part.y / safeTile);
    const widthTiles = Math.round(part.w / safeTile);
    const heightTiles = Math.round(part.h / safeTile);
    for (let dx = 0; dx < widthTiles; dx++) {
      for (let dy = 0; dy < heightTiles; dy++) {
        cells.add(cellKey(startX + dx, startY + dy));
      }
    }
  }

  return cells;
}

function cellsToParts(cells, tileSizeFt = 2) {
  const remaining = new Set(cells || []);
  const parts = [];
  const safeTile = Math.max(1, num(tileSizeFt, 2));

  while (remaining.size) {
    const first = remaining.values().next().value;
    const { x: startX, y: startY } = parseCellKey(first);
    let width = 1;
    while (remaining.has(cellKey(startX + width, startY))) width += 1;

    let height = 1;
    let canGrow = true;
    while (canGrow) {
      for (let dx = 0; dx < width; dx++) {
        if (!remaining.has(cellKey(startX + dx, startY + height))) {
          canGrow = false;
          break;
        }
      }
      if (canGrow) height += 1;
    }

    for (let dx = 0; dx < width; dx++) {
      for (let dy = 0; dy < height; dy++) {
        remaining.delete(cellKey(startX + dx, startY + dy));
      }
    }

    parts.push({
      x: startX * safeTile,
      y: startY * safeTile,
      w: width * safeTile,
      h: height * safeTile,
    });
  }

  return parts;
}

function boundsFromCells(cells, tileSizeFt = 2) {
  if (!cells || !cells.size) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const key of cells) {
    const { x, y } = parseCellKey(key);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const safeTile = Math.max(1, num(tileSizeFt, 2));
  return {
    x: minX * safeTile,
    y: minY * safeTile,
    w: (maxX - minX + 1) * safeTile,
    h: (maxY - minY + 1) * safeTile,
  };
}

function isCellSetConnected(cells) {
  if (!cells || cells.size <= 1) return true;
  const visited = new Set();
  const queue = [cells.values().next().value];
  visited.add(queue[0]);

  while (queue.length) {
    const current = queue.shift();
    const { x, y } = parseCellKey(current);
    const neighbors = [
      cellKey(x - 1, y),
      cellKey(x + 1, y),
      cellKey(x, y - 1),
      cellKey(x, y + 1),
    ];
    for (const neighbor of neighbors) {
      if (!cells.has(neighbor) || visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return visited.size === cells.size;
}

function applyCellsToRoom(room, cells, tileSizeFt = 2) {
  const parts = cellsToParts(cells, tileSizeFt);
  const bounds = boundsFromCells(cells, tileSizeFt);
  room.x = bounds.x;
  room.y = bounds.y;
  room.w = bounds.w;
  room.h = bounds.h;
  if (parts.length > 1) {
    room.parts = parts;
  } else {
    delete room.parts;
  }
  return room;
}

module.exports = {
  applyCellsToRoom,
  boundingRectOf,
  boundsFromCells,
  cellKey,
  cellsToParts,
  isCellSetConnected,
  num,
  overlapLen,
  parseCellKey,
  partListOf,
  pointOnBoundaryOfRoom,
  rectOf,
  roomArea,
  roomCentroid,
  roomToCells,
  roomsOverlap,
  shareWall,
  sharedWallRect,
  touchesExterior,
};
