'use strict';

const { union, subtract, containsRect } = require('./rectBoolean');
const { buildFloorPassageModel } = require('./floorPassageModel');
const validRect = rect => rect && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(rect[key])) && rect.w > 0 && rect.h > 0;
const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
// Regions describe permissible footprint CENTRES, including zero-width lines.
// They are not free-floor polygons. Every chosen centre still needs a full fit.
const validRegions = regions => Array.isArray(regions) && regions.length > 0 &&
  regions.every(r => r && typeof r.id === 'string' && r.id.length > 0 &&
    ['x', 'y', 'w', 'h'].every(key => Number.isFinite(r[key])) && r.w >= 0 && r.h >= 0) &&
  new Set(regions.map(r => r.id)).size === regions.length;
const regionAt = (regions, p) => regions.find(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);

// Configuration-space check for an axis-aligned square translated along a
// rectilinear path. Critical coordinates come from actual polygon boundaries,
// not a sampling grid. This conservative footprint is not a turning-circle,
// wheelchair manoeuvre, door-swing or code-compliance model.
function findClearRoute(parts, { from, to, fromRegions, targetRegions, fromFloorParts, targetFloorParts, clearWidthFt, obstacles = [], maxNodes = 40000 } = {}) {
  const result = { status: 'not_checked', clearWidthFt, footprint: 'axis_aligned_square', path: [], constructionVerified: false };
  if (!Array.isArray(parts) || !parts.length || !parts.every(validRect) ||
      !Array.isArray(obstacles) || !obstacles.every(validRect) ||
      (fromRegions === undefined ? !point(from) : from !== undefined || !validRegions(fromRegions)) ||
      (targetRegions === undefined ? !point(to) : to !== undefined || !validRegions(targetRegions)) ||
      (fromFloorParts !== undefined && (!Array.isArray(fromFloorParts) || !fromFloorParts.every(validRect))) ||
      (targetFloorParts !== undefined && (!Array.isArray(targetFloorParts) || !targetFloorParts.every(validRect))) ||
      !Number.isFinite(clearWidthFt) || clearWidthFt <= 0 || !Number.isInteger(maxNodes) || maxNodes < 1) {
    return { ...result, reason: 'Invalid or missing route geometry.' };
  }
  const free = union(subtract(parts, obstacles));
  if (!free.length) return { ...result, status: 'blocked', reason: 'No free floor area remains.' };
  const radius = clearWidthFt / 2;
  const square = p => ({ x: p.x - radius, y: p.y - radius, w: clearWidthFt, h: clearWidthFt });
  const sourceFits = p => fromFloorParts === undefined || containsRect(fromFloorParts, square(p));
  const targetFits = p => targetFloorParts === undefined || containsRect(targetFloorParts, square(p));
  if ((from && (!containsRect(free, square(from)) || !sourceFits(from))) ||
      (to && (!containsRect(free, square(to)) || !targetFits(to)))) {
    return { ...result, status: 'blocked', reason: 'A route endpoint cannot contain the requested footprint.' };
  }
  const sources = fromRegions || [{ id: 'from', x: from.x, y: from.y, w: 0, h: 0 }];
  const targets = targetRegions || [{ id: 'to', x: to.x, y: to.y, w: 0, h: 0 }];
  const endpoints = [...sources, ...targets];
  const boundaries = [...free, ...(fromFloorParts || []), ...(targetFloorParts || [])];
  const xs = [...new Set([...endpoints.flatMap(p => [p.x, p.x+p.w]), ...boundaries.flatMap(p => [p.x + radius, p.x - radius, p.x + p.w - radius, p.x + p.w + radius])])].sort((a,b)=>a-b);
  const ys = [...new Set([...endpoints.flatMap(p => [p.y, p.y+p.h]), ...boundaries.flatMap(p => [p.y + radius, p.y - radius, p.y + p.h - radius, p.y + p.h + radius])])].sort((a,b)=>a-b);
  if (xs.length * ys.length > maxNodes) return { ...result, reason: 'Route search limit exceeded; no clearance conclusion.', nodeCount: xs.length * ys.length };
  const key = (i,j) => i * ys.length + j;
  const xy = id => ({ x: xs[Math.floor(id / ys.length)], y: ys[id % ys.length] });
  const parent = new Map(), queue = [];
  const valid = new Map();
  const fits = id => { if (!valid.has(id)) valid.set(id, containsRect(free, square(xy(id)))); return valid.get(id); };
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) {
    const id = key(i,j);
    if (regionAt(sources, xy(id)) && sourceFits(xy(id)) && fits(id)) { parent.set(id, null); queue.push(id); }
  }
  if (!queue.length) return { ...result, status: 'blocked', reason: 'No permitted source approach can contain the requested footprint.' };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    const target = regionAt(targets, xy(id));
    if (target && targetFits(xy(id))) {
      const route = []; for (let current = id; current !== null; current = parent.get(current)) route.push(xy(current));
      route.reverse();
      const compact = [];
      for (const p of route) {
        const a = compact.at(-2), b = compact.at(-1);
        if (a && ((a.x === b.x && b.x === p.x) ||
          (a.y === b.y && b.y === p.y))) compact.pop();
        compact.push(p);
      }
      return { ...result, status: 'clear', path: compact, visitedNodes: parent.size,
        sourceId: regionAt(sources, compact[0]).id, targetId: target.id };
    }
    const i = Math.floor(id / ys.length), j = id % ys.length;
    for (const [ni,nj] of [[i-1,j],[i+1,j],[i,j-1],[i,j+1]]) {
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue;
      const next = key(ni,nj);
      if (parent.has(next) || !fits(next)) continue;
      const a = xy(id), b = xy(next);
      const swept = { x: Math.min(a.x,b.x) - radius, y: Math.min(a.y,b.y) - radius,
        w: Math.abs(a.x-b.x) + clearWidthFt, h: Math.abs(a.y-b.y) + clearWidthFt };
      if (!containsRect(free, swept)) continue;
      parent.set(next,id); queue.push(next);
    }
  }
  return { ...result, status: 'blocked', reason: 'No continuous route fits the requested footprint.', visitedNodes: parent.size };
}

function checkLevelClearRoute(level, { allowedRoomIds, includeFurniture = true, ...request } = {}) {
  const unchecked = reason => ({ status: 'not_checked', reason, constructionVerified: false, doorSwingChecked: false });
  if (!level || !Array.isArray(level.rooms) || typeof includeFurniture !== 'boolean') return unchecked('Invalid floor or furniture-check setting.');
  if (level.rooms.some(room => !room || typeof room.id !== 'string')) return unchecked('Room records are malformed.');
  if (!Array.isArray(allowedRoomIds) || !allowedRoomIds.length || new Set(allowedRoomIds).size !== allowedRoomIds.length) {
    return unchecked('An explicit set of traversable rooms is required.');
  }
  const rooms = allowedRoomIds.map(id => level.rooms?.find(room => room.id === id));
  if (rooms.some(room => !room || room.type === 'stairs')) return unchecked('Room list is invalid or crosses a stair flight; use a separate stair model.');
  let model;
  try { model = buildFloorPassageModel(level); }
  catch (error) { return unchecked(`Physical floor geometry is malformed: ${error.message}`); }
  if (model.errors.length) return { ...unchecked('Physical opening model is invalid.'), errors: model.errors };
  const relevant = model.openings.filter(opening => opening.rooms.every(id => allowedRoomIds.includes(id)));
  if (relevant.some(opening => opening.status !== 'scheduled_geometry')) return unchecked('A connecting doorway lacks its physical schedule.');
  if (includeFurniture && !Array.isArray(level.furniture)) return unchecked('Furniture geometry is missing.');
  if (includeFurniture && level.furniture.some(item => !item || !validRect(item) ||
      !level.rooms.some(room => room.id === item.roomId))) return unchecked('Furniture bounds or room ownership are invalid.');
  const parts = model.roomClear.filter(room => allowedRoomIds.includes(room.roomId)).flatMap(room => room.parts);
  for (const opening of relevant) parts.push(opening.clear);
  const obstacles = includeFurniture ? level.furniture.filter(item => allowedRoomIds.includes(item.roomId)) : [];
  return { ...findClearRoute(parts, { ...request, obstacles }), doorSwingChecked: false,
    furnitureChecked: includeFurniture, allowedRoomIds: [...allowedRoomIds],
    basis: 'Scheduled apertures and assumed wall assemblies; square floor footprint only.' };
}

module.exports = { findClearRoute, checkLevelClearRoute };
