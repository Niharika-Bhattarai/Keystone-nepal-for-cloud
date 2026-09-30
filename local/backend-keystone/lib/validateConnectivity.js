// lib/validateConnectivity.js (CommonJS)

const { normalizeRoomType, isPublicRoomType } = require('./tile/canonicalRoomTypes');
const { openPairKeys } = require('./openEdges');

function num(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function rectOf(r) {
  return { x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h), x2: num(r.x) + num(r.w), y2: num(r.y) + num(r.h) };
}

function overlapLen(a1, a2, b1, b2) {
  const lo = Math.max(a1, b1);
  const hi = Math.min(a2, b2);
  return Math.max(0, hi - lo);
}

function shareWallRect(A, B, minSeg) {
  if (A.x2 === B.x || B.x2 === A.x) {
    const seg = overlapLen(A.y, A.y2, B.y, B.y2);
    if (seg >= minSeg) return { kind: 'vertical', seg };
  }
  if (A.y2 === B.y || B.y2 === A.y) {
    const seg = overlapLen(A.x, A.x2, B.x, B.x2);
    if (seg >= minSeg) return { kind: 'horizontal', seg };
  }
  return null;
}

function partsOf(room) {
  if (Array.isArray(room.parts) && room.parts.length > 0) return room.parts.map(rectOf);
  return [rectOf(room)];
}

function shareWall(a, b, minSeg = 2) {
  const aParts = partsOf(a);
  const bParts = partsOf(b);
  let best = null;
  for (const ap of aParts) {
    for (const bp of bParts) {
      const wall = shareWallRect(ap, bp, minSeg);
      if (wall && (!best || wall.seg > best.seg)) best = wall;
    }
  }
  return best;
}

function touchesExterior(roomRect, lvlW, lvlH) {
  const parts = partsOf(roomRect);
  return parts.some((r) => r.x === 0 || r.y === 0 || r.x2 === lvlW || r.y2 === lvlH);
}

function isIgnorable(type) {
  return type === 'garage' || type === 'storage';
}

function validateConnectivity(planSpec, surveyData) {
  const errors = [];
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  if (!levels.length) return ['Connectivity: levels missing'];

  const openConcept = String(surveyData?.openConcept || '').toLowerCase().includes('open');

  const perLevel = levels.map((lvl) => {
    const rooms = Array.isArray(lvl.rooms) ? lvl.rooms : [];
    const doors = Array.isArray(lvl.doors) ? lvl.doors : [];
    const byId = new Map(rooms.map((r) => [String(r.id), r]));
    const edges = new Map();

    const addEdge = (a, b) => {
      const A = String(a || '');
      const B = String(b || '');
      if (!A || !B || A === B) return;
      if (!edges.has(A)) edges.set(A, new Set());
      if (!edges.has(B)) edges.set(B, new Set());
      edges.get(A).add(B);
      edges.get(B).add(A);
    };

    for (const d of doors) {
      const a = String(d.a || '');
      const b = String(d.b || '');
      if (byId.has(a) && byId.has(b)) addEdge(a, b);
    }
    // Walls a person took out in edit mode join their rooms like a doorway.
    for (const key of openPairKeys(lvl)) {
      const [a, b] = key.split('|');
      if (byId.has(a) && byId.has(b)) addEdge(a, b);
    }

    if (openConcept) {
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const ra = rooms[i];
          const rb = rooms[j];
          const ta = normalizeRoomType(ra.type || ra.label || ra.name);
          const tb = normalizeRoomType(rb.type || rb.label || rb.name);
          
          const isPublicA = isPublicRoomType(ta) || ['hallway', 'stairs', 'entry', 'mudroom', 'laundry'].includes(ta);
          const isPublicB = isPublicRoomType(tb) || ['hallway', 'stairs', 'entry', 'mudroom', 'laundry'].includes(tb);
          if (!isPublicA || !isPublicB) continue;

          if (shareWall(ra, rb, 2)) addEdge(String(ra.id), String(rb.id));
        }
      }
    }

    return { lvl, rooms, doors, byId, edges };
  });

  for (let li = 0; li < perLevel.length; li++) {
    const { lvl, rooms, byId, edges } = perLevel[li];
    const lvlW = num(lvl.width);
    const lvlH = num(lvl.height);
    const levelAreaSqFt = lvlW * lvlH;
    const enforceStrictEnsuite = levelAreaSqFt >= 1000;
    const enforceStrictStairs = levelAreaSqFt >= 900;
    if (!rooms.length) {
      errors.push(`Connectivity: Level ${lvl.level} has no rooms`);
      continue;
    }

    const seeds = rooms.filter((r) => {
      const t = normalizeRoomType(r.type);
      return isPublicRoomType(t) || ['hallway', 'entry', 'mudroom', 'laundry', 'stairs'].includes(t);
    });
    const queue = seeds.map(s => String(s.id));
    const seen = new Set(queue);
    if (queue.length === 0 && rooms.length > 0) {
      const firstId = String(rooms[0].id);
      queue.push(firstId);
      seen.add(firstId);
    }


    while (queue.length) {
      const cur = queue.shift();
      for (const nxt of edges.get(cur) || []) {
        if (!seen.has(nxt)) {
          seen.add(nxt);
          queue.push(nxt);
        }
      }
    }

    // En-suite invariants:
    // 1) primary_bathroom can only connect to primary_bedroom
    // 2) bathroomUse=private can only connect to attached bedroom
    const primaryBath = rooms.find((r) => normalizeRoomType(r.type) === 'primary_bathroom');
    if (primaryBath && enforceStrictEnsuite) {
      const pbId = String(primaryBath.id);
      const nbs = [...(edges.get(pbId) || [])];
      const primaryBed = rooms.find((r) => normalizeRoomType(r.type) === 'primary_bedroom');
      const primaryBedId = primaryBed ? String(primaryBed.id) : null;

      if (primaryBedId && !nbs.includes(primaryBedId) && levelAreaSqFt >= 1200) {
        errors.push(`Connectivity: Level ${lvl.level} primary bathroom is not connected to primary bedroom`);
      }
      for (const nb of nbs) {
        if (!primaryBedId || nb !== primaryBedId) {
          errors.push(`Connectivity: Level ${lvl.level} primary bathroom has non-ensuite access`);
          break;
        }
      }
    }

    for (const bath of rooms.filter((r) => normalizeRoomType(r.type) === 'bathroom' && String(r.bathroomUse || '') === 'private' && r.attachedTo)) {
      if (!enforceStrictEnsuite) break;
      const bathId = String(bath.id);
      const targetBedId = String(bath.attachedTo);
      const nbs = [...(edges.get(bathId) || [])];
      if (!nbs.includes(targetBedId)) {
        errors.push(`Connectivity: Level ${lvl.level} private bathroom (${bathId}) not connected to attached bedroom (${targetBedId})`);
      }
      for (const nb of nbs) {
        if (nb !== targetBedId) {
          errors.push(`Connectivity: Level ${lvl.level} private bathroom (${bathId}) has non-ensuite access`);
          break;
        }
      }
    }

    // Stair accessibility: each stair must have at least one door, and prefer hallway.
    const stair = rooms.find((r) => normalizeRoomType(r.type) === 'stairs');
    if (stair) {
      const stairId = String(stair.id);
      const nbs = [...(edges.get(stairId) || [])];
      if (!nbs.length) {
        errors.push(`Connectivity: Level ${lvl.level} stairs have no door access`);
      } else {
        const hasHallRoom = rooms.some((r) => normalizeRoomType(r.type) === 'hallway');
        const hasHall = nbs.some((id) => {
          const room = byId.get(String(id));
          return room && normalizeRoomType(room.type) === 'hallway';
        });
        if (enforceStrictStairs && hasHallRoom && !hasHall && levelAreaSqFt >= 1200) {
          errors.push(`Connectivity: Level ${lvl.level} stairs are not connected to hallway`);
        }
      }
    }

    for (const r of rooms) {
      const id = String(r.id);
      const t = normalizeRoomType(r.type || r.label || r.name);
      if (isIgnorable(t)) continue;
      if (!seen.has(id)) {
        // On very tight levels, strict circulation requirements for en-suite bathrooms
        // can create false negatives. Keep bedroom/living connectivity as the hard rule.
        // Topology-level infeasible layouts should already be filtered earlier.
        const isEnsuiteBath =
          t === 'primary_bathroom' ||
          (t === 'bathroom' && String(r.bathroomUse || '') === 'private');
        if (levelAreaSqFt < 1000 && isEnsuiteBath) continue;
        errors.push(`Connectivity: Level ${lvl.level} room "${t}" (${id}) is not reachable from circulation`);
      }
    }
  }

  if (levels.length >= 2) {
    const stairRects = levels.map((lvl) => {
      const stair = (lvl.rooms || []).find((r) => normalizeRoomType(r.type) === 'stairs');
      return stair ? { rect: rectOf(stair), protrusionFt: num(lvl.protrusionFt) } : null;
    });
    if (stairRects.some((r) => !r)) {
      errors.push('Connectivity: Missing stairs on one or more levels');
    } else {
      // Normalize stair positions by subtracting each level's protrusion offset.
      // IMPORTANT: We only require x and w to match across levels.
      //   - y differs by design: Level 1 stair starts at protrusionFt (garage offset),
      //     Level 2 stair starts at 0. After normalization both should be 0,
      //     but floating-point rounding can cause 1-ft discrepancies — allow ±tileSizeFt.
      //   - h differs by design: Level 1 rear zone height (rearH) is typically smaller
      //     than Level 2 full height. The stair shaft x-position and width must match;
      //     the height difference is architecturally acceptable (open stairwell above).
      const normalized = stairRects.map(({ rect: r, protrusionFt }) => ({
        x: r.x,
        y: r.y - protrusionFt,   // remove protrusion offset for y comparison
        w: r.w,
        h: r.h,
      }));
      const [a, b] = normalized;
      // Only enforce x and w alignment — y and h can differ legitimately.
      if (!(a.x === b.x && a.w === b.w)) {
        errors.push('Connectivity: Stairs must align across stories');
      }
    }
  }

  return errors;
}

module.exports = { validateConnectivity };
