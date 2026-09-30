// lib/tile/mergeFillerRooms.js
//
// Post-placement pass: merge storage filler rooms into adjacent habitable
// rooms, creating composite (L-shaped / T-shaped) rooms. This eliminates
// wasteful filler gaps and produces more natural room shapes.

'use strict';

const { normalizeRoomType } = require('./canonicalRoomTypes');

const FILLER_ID_PATTERNS = [/_gap_/, /_total$/, /_fill_/, /^fill_/, /^store_/];

function isFillerStorage(room) {
  const t = normalizeRoomType(room.type);
  if (t !== 'storage') return false;
  const id = String(room.id || '');
  return FILLER_ID_PATTERNS.some((p) => p.test(id));
}

const MERGE_TARGET_TYPES = new Set([
  'bedroom', 'guest_bedroom', 'primary_bedroom',
  'living_room', 'dining_room', 'kitchen',
  'study_room', 'gaming_room', 'gym', 'library',
  'movie_room', 'media_room', 'wine_cellar', 'music_room', 'office',
]);

function canMergeInto(room) {
  return MERGE_TARGET_TYPES.has(normalizeRoomType(room.type));
}

function rectsShareFullEdge(a, b) {
  // Right edge of a touches left edge of b (same height span)
  if (a.x + a.w === b.x && a.y === b.y && a.h === b.h) return 'right';
  // Left edge of a touches right edge of b
  if (b.x + b.w === a.x && a.y === b.y && a.h === b.h) return 'left';
  // Bottom edge of a touches top edge of b (same width span)
  if (a.y + a.h === b.y && a.x === b.x && a.w === b.w) return 'bottom';
  // Top edge of a touches bottom edge of b
  if (b.y + b.h === a.y && a.x === b.x && a.w === b.w) return 'top';
  return null;
}

function rectsSharePartialEdge(a, b) {
  const overlapLen = (s1, e1, s2, e2) => Math.max(0, Math.min(e1, e2) - Math.max(s1, s2));
  // Vertical shared edge
  if (a.x + a.w === b.x || b.x + b.w === a.x) {
    const seg = overlapLen(a.y, a.y + a.h, b.y, b.y + b.h);
    if (seg > 0) return seg;
  }
  // Horizontal shared edge
  if (a.y + a.h === b.y || b.y + b.h === a.y) {
    const seg = overlapLen(a.x, a.x + a.w, b.x, b.x + b.w);
    if (seg > 0) return seg;
  }
  return 0;
}

function boundingBox(parts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of parts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function compositeArea(room) {
  if (room.parts) return room.parts.reduce((s, p) => s + p.w * p.h, 0);
  return room.w * room.h;
}

function maxAspect(room) {
  const parts = room.parts || [{ x: room.x, y: room.y, w: room.w, h: room.h }];
  const bb = boundingBox(parts);
  const short = Math.min(bb.w, bb.h);
  const long = Math.max(bb.w, bb.h);
  return short > 0 ? long / short : Infinity;
}

function mergeFillerRooms(tilePlan) {
  if (!tilePlan || !Array.isArray(tilePlan.levels)) return tilePlan;

  for (const level of tilePlan.levels) {
    const rooms = level.rooms;
    if (!Array.isArray(rooms) || rooms.length === 0) continue;

    const fillerIds = new Set();
    const fillers = [];
    for (const room of rooms) {
      if (isFillerStorage(room)) {
        fillers.push(room);
        fillerIds.add(room.id);
      }
    }
    if (!fillers.length) continue;

    const merged = new Set();

    for (const filler of fillers) {
      if (merged.has(filler.id)) continue;

      let bestNeighbor = null;
      let bestSeg = 0;
      let bestFullEdge = null;

      for (const candidate of rooms) {
        if (candidate.id === filler.id) continue;
        if (fillerIds.has(candidate.id) && !merged.has(candidate.id)) continue;
        if (!canMergeInto(candidate)) continue;

        const fullEdge = rectsShareFullEdge(filler, candidate);
        const seg = rectsSharePartialEdge(filler, candidate);
        if (seg <= 0) continue;

        // Prefer full-edge merges (simple expansion), then longest shared edge
        if (fullEdge && (!bestFullEdge || seg > bestSeg)) {
          bestNeighbor = candidate;
          bestSeg = seg;
          bestFullEdge = fullEdge;
        } else if (!bestFullEdge && seg > bestSeg) {
          bestNeighbor = candidate;
          bestSeg = seg;
        }
      }

      if (!bestNeighbor) continue;

      // Check aspect ratio constraint after merge
      const neighborParts = bestNeighbor.parts
        ? [...bestNeighbor.parts]
        : [{ x: bestNeighbor.x, y: bestNeighbor.y, w: bestNeighbor.w, h: bestNeighbor.h }];
      const fillerRect = { x: filler.x, y: filler.y, w: filler.w, h: filler.h };
      const candidateParts = [...neighborParts, fillerRect];
      const bb = boundingBox(candidateParts);
      const short = Math.min(bb.w, bb.h);
      const long = Math.max(bb.w, bb.h);
      if (short > 0 && long / short > 4) continue;

      if (bestFullEdge) {
        // Simple expansion: extend the neighbor's bounding rect
        if (!bestNeighbor.parts) {
          if (bestFullEdge === 'right') { bestNeighbor.w += filler.w; }
          else if (bestFullEdge === 'left') { bestNeighbor.x = filler.x; bestNeighbor.w += filler.w; }
          else if (bestFullEdge === 'bottom') { bestNeighbor.h += filler.h; }
          else if (bestFullEdge === 'top') { bestNeighbor.y = filler.y; bestNeighbor.h += filler.h; }
        } else {
          bestNeighbor.parts.push(fillerRect);
          const newBB = boundingBox(bestNeighbor.parts);
          Object.assign(bestNeighbor, { x: newBB.x, y: newBB.y, w: newBB.w, h: newBB.h });
        }
      } else {
        // L-shape merge: create parts array
        if (!bestNeighbor.parts) {
          bestNeighbor.parts = [
            { x: bestNeighbor.x, y: bestNeighbor.y, w: bestNeighbor.w, h: bestNeighbor.h },
          ];
        }
        bestNeighbor.parts.push(fillerRect);
        const newBB = boundingBox(bestNeighbor.parts);
        Object.assign(bestNeighbor, { x: newBB.x, y: newBB.y, w: newBB.w, h: newBB.h });
      }

      merged.add(filler.id);
    }

    // Remove merged filler rooms
    if (merged.size > 0) {
      level.rooms = rooms.filter((r) => !merged.has(r.id));
    }
  }

  return tilePlan;
}

module.exports = { mergeFillerRooms };
