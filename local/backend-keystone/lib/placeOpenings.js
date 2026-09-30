// lib/placeOpenings.js (CommonJS)
//
// Deterministic door/window placement for rect-tiled rooms.

const { normalizeRoomType, isOutdoorType } = require('./tile/canonicalRoomTypes');
const { boundarySegments, finalizeOpenings, fitOpening, openingSpan } = require('./openingGeometry');
const { physicalAccessState } = require('./validatePhysicalAccess');
const { openPairKeys } = require('./openEdges');
const { closetLayout } = require('./closetGeometry');

function num(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeType(raw) {
  return normalizeRoomType(raw);
}

function rectOf(r) {
  return {
    x: num(r.x),
    y: num(r.y),
    w: num(r.w),
    h: num(r.h),
    x2: num(r.x) + num(r.w),
    y2: num(r.y) + num(r.h),
  };
}

function overlapLen(a1, a2, b1, b2) {
  const lo = Math.max(a1, b1);
  const hi = Math.min(a2, b2);
  return Math.max(0, hi - lo);
}

function sharedWallRect(A, B, minSeg) {
  if (A.x2 === B.x || B.x2 === A.x) {
    const seg = overlapLen(A.y, A.y2, B.y, B.y2);
    if (seg >= minSeg) {
      const x = A.x2 === B.x ? A.x2 : B.x2;
      let yMid = Math.max(A.y, B.y) + seg / 2;
      if (seg >= 5) yMid = Math.max(A.y, B.y) + 2.5;
      return { kind: 'vertical', x, y: yMid, seg };
    }
  }
  if (A.y2 === B.y || B.y2 === A.y) {
    const seg = overlapLen(A.x, A.x2, B.x, B.x2);
    if (seg >= minSeg) {
      const y = A.y2 === B.y ? A.y2 : B.y2;
      let xMid = Math.max(A.x, B.x) + seg / 2;
      if (seg >= 5) xMid = Math.max(A.x, B.x) + 2.5;
      return { kind: 'horizontal', x: xMid, y, seg };
    }
  }
  return null;
}

function partsOf(room) {
  if (Array.isArray(room.parts) && room.parts.length > 0) return room.parts.map(rectOf);
  return [rectOf(room)];
}

function sharedWall(a, b, minSeg = 2) {
  const aParts = partsOf(a);
  const bParts = partsOf(b);
  let best = null;
  for (const ap of aParts) {
    for (const bp of bParts) {
      const wall = sharedWallRect(ap, bp, minSeg);
      if (wall && (!best || wall.seg > best.seg)) best = wall;
    }
  }
  return best;
}

function touchesExterior(r, lvlW, lvlH) {
  const parts = partsOf(r);
  return parts.some((R) => R.x === 0 || R.y === 0 || R.x2 === lvlW || R.y2 === lvlH);
}

function isCirculation(t) {
  return t === 'hallway' || t === 'entry' || t === 'stairs';
}

function isPublic(t) {
  return ['living_room', 'dining_room', 'kitchen', 'entry', 'hallway', 'mudroom', 'laundry'].includes(t);
}

function isBedroomType(t) {
  return ['bedroom', 'guest_bedroom', 'primary_bedroom'].includes(t);
}

function isBathType(t) {
  return ['bathroom', 'primary_bathroom', 'powder_room'].includes(t);
}

function isBathPublicDoorDisallowed(publicType) {
  const type = String(publicType || '');
  if (type === 'hallway') return false;
  if (type === 'mudroom') return false;
  if (type === 'laundry') return false;
  return ['living_room', 'dining_room', 'kitchen', 'entry'].includes(type);
}

function isWindowEligible(t) {
  return !['bathroom', 'primary_bathroom', 'powder_room', 'closet', 'hallway', 'stairs', 'garage', 'storage'].includes(t);
}

function edgeForFacing(frontFacing) {
  const f = String(frontFacing || 'South').toLowerCase();
  if (f.includes('north')) return 'top';
  if (f.includes('south')) return 'bottom';
  if (f.includes('east')) return 'right';
  if (f.includes('west')) return 'left';
  return 'bottom';
}

function oppositeEdge(edge) {
  if (edge === 'top') return 'bottom';
  if (edge === 'bottom') return 'top';
  if (edge === 'left') return 'right';
  return 'left';
}

function roomTouchesEdge(room, edge, lvlW, lvlH) {
  const parts = partsOf(room);
  return parts.some((R) => {
    if (edge === 'top') return R.y === 0;
    if (edge === 'bottom') return R.y2 === lvlH;
    if (edge === 'left') return R.x === 0;
    if (edge === 'right') return R.x2 === lvlW;
    return false;
  });
}

function openingEdge(opening, lvlW, lvlH) {
  if (!opening) return null;
  if (String(opening?.dir) === 'horizontal') {
    if (num(opening?.y) === 0) return 'top';
    if (num(opening?.y) === lvlH) return 'bottom';
  } else if (String(opening?.dir) === 'vertical') {
    if (num(opening?.x) === 0) return 'left';
    if (num(opening?.x) === lvlW) return 'right';
  }
  return null;
}

function pairKey(a, b) {
  const A = String(a);
  const B = String(b);
  return A < B ? `${A}|${B}` : `${B}|${A}`;
}

function chooseRequiredConnection(m, candidates) {
  const rules = Array.isArray(m?.room?.adjacencyIntent?.intents)
    ? m.room.adjacencyIntent.intents
    : [];
  for (const rule of rules) {
    const match = candidates.find(({ other }) => {
      if (!other) return false;
      if (rule.targetId && other.id === String(rule.targetId)) return true;
      if (rule.targetType && other.type === rule.targetType) return true;
      if (rule.targetZone && other.room?.zone === rule.targetZone) return true;
      return false;
    });
    if (match) return match.e;
  }
  return null;
}

function doorSig(d) {
  return `${d.dir}:${num(d.x)}:${num(d.y)}:${String(d.a || '')}:${String(d.b || '')}`;
}

function windowSig(w) {
  return `${w.dir}:${num(w.x)}:${num(w.y)}`;
}

function computeAdjacency(rooms) {
  const out = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      // Allow 1-tile adjacency (2ft) so compact plans can still get a door bridge.
      const wall = sharedWall(a, b, 1);
      if (wall) out.push({ a, b, wall });
    }
  }
  return out;
}

function addDoor(doors, usedPairs, aId, bId, wall, lvlW, lvlH, extras = {}) {
  const k = pairKey(aId, bId);
  if (usedPairs.has(k)) return;
  usedPairs.add(k);
  doors.push({
    x: clamp(wall.x, 0, lvlW),
    y: clamp(wall.y, 0, lvlH),
    dir: wall.kind === 'vertical' ? 'vertical' : 'horizontal',
    a: String(aId),
    b: String(bId),
    ...extras,
  });
}

function placeOpeningsForLevel(level, surveyData = {}) {
  const rooms = Array.isArray(level.rooms) ? level.rooms : [];
  const lvlW = num(level.width);
  const lvlH = num(level.height);
  const strictEnsuiteDooring = (lvlW * lvlH) >= 1000;
  const meta = rooms.map((r) => ({
    room: r,
    id: String(r.id),
    type: normalizeType(r.type || r.label || r.name),
    bathroomUse: String(r.bathroomUse || ''),
    attachedTo: r.attachedTo ? String(r.attachedTo) : null,
  }));
  const metaById = new Map(meta.map((m) => [m.id, m]));
  const adjacency = computeAdjacency(rooms);

  // placeOpenings() is called more than once during candidate generation.
  // Recomputing from the latest geometry avoids stale pre-refinement doors from
  // surviving into later validation passes.
  const existingDoors = [];
  const existingWindows = [];
  const doors = [];
  const usedPairs = new Set();
  const usedDoorSigs = new Set();
  // Walls a person took out in edit mode: the rooms already open into each
  // other, so no pass puts a door between them and every pass counts them as
  // connected.
  const openPairs = openPairKeys(level);
  for (const k of openPairs) usedPairs.add(k);

  const openConcept = String(surveyData?.openConcept || '').toLowerCase().includes('open');
  const lotText = String(surveyData?.lotContext || '').toLowerCase();
  const naturalText = String(surveyData?.naturalLight || '').toLowerCase();
  const indoorOutText = String(surveyData?.indoorOutdoor || '').toLowerCase();
  const accessibilityText = String(surveyData?.accessibilityNeeds || '').toLowerCase();
  const frontEdge = edgeForFacing(surveyData?.frontFacing);
  const viewEdge = oppositeEdge(frontEdge);
  const viewFocusedLot = lotText.includes('view') || lotText.includes('water');
  const privacyFirst = naturalText.includes('privacy') || naturalText.includes('fewer') || naturalText.includes('minimal');
  const maxLight = naturalText.includes('maximum') || naturalText.includes('glazing');
  const maxIndoorOutdoor = indoorOutText.includes('maximum') || indoorOutText.includes('open');
  // A porch, deck or patio (outdoorLiving.js) is reached by a sliding door
  // from a public room on the garden side.
  const outdoorText = String(surveyData?.outdoorLiving || '').toLowerCase();
  const outdoorLiving = Boolean(outdoorText) && !outdoorText.includes('none');
  const wideDoorways = accessibilityText.includes('wide') || accessibilityText.includes('wheelchair');
  const glazingProfile = maxLight ? 'maximum_glazing' : (privacyFirst ? 'privacy_first' : 'balanced');

  function isEnsuiteOnly(m) {
    if (!m) return false;
    if (m.type === 'primary_bathroom') return true;
    return m.type === 'bathroom' && m.bathroomUse === 'private' && Boolean(m.attachedTo);
  }

  function isAllowedEnsuitePair(aMeta, bMeta) {
    if (!aMeta || !bMeta) return false;
    if (aMeta.type === 'primary_bathroom') return bMeta.type === 'primary_bedroom';
    if (bMeta.type === 'primary_bathroom') return aMeta.type === 'primary_bedroom';
    if (aMeta.type === 'bathroom' && aMeta.bathroomUse === 'private' && aMeta.attachedTo) return bMeta.id === aMeta.attachedTo;
    if (bMeta.type === 'bathroom' && bMeta.bathroomUse === 'private' && bMeta.attachedTo) return aMeta.id === bMeta.attachedTo;
    return true;
  }

  function isAllowedStairPair(aMeta, bMeta) {
    if (!aMeta || !bMeta) return false;
    const aIsStair = aMeta.type === 'stairs';
    const bIsStair = bMeta.type === 'stairs';
    if (!aIsStair && !bIsStair) return true;
    const other = aIsStair ? bMeta : aMeta;
    if (explicitStairLanding && preferredStairHallId) {
      return String(other.id) === String(preferredStairHallId);
    }
    if (other.type !== 'hallway' && other.type !== 'entry' && other.type !== 'living_room') return false;
    return true;
  }

  function isAllowedGaragePair(aMeta, bMeta) {
    if (!aMeta || !bMeta) return false;
    const aIsGarage = aMeta.type === 'garage';
    const bIsGarage = bMeta.type === 'garage';
    if (!aIsGarage && !bIsGarage) return true;
    const other = aIsGarage ? bMeta : aMeta;
    return ['hallway', 'entry', 'mudroom', 'laundry', 'storage'].includes(other.type);
  }

  function isAllowedDoorPair(aMeta, bMeta) {
    if (!aMeta || !bMeta) return false;
    if (aMeta.room.ownerBedroomId && aMeta.type === 'closet') return aMeta.room.ownerBedroomId === bMeta.id;
    if (bMeta.room.ownerBedroomId && bMeta.type === 'closet') return bMeta.room.ownerBedroomId === aMeta.id;
    if (strictEnsuiteDooring && (isEnsuiteOnly(aMeta) || isEnsuiteOnly(bMeta)) && !isAllowedEnsuitePair(aMeta, bMeta)) {
      return false;
    }
    if (
      (isBathType(aMeta.type) && isPublic(bMeta.type) && isBathPublicDoorDisallowed(bMeta.type)) ||
      (isBathType(bMeta.type) && isPublic(aMeta.type) && isBathPublicDoorDisallowed(aMeta.type))
    ) {
      return false;
    }
    if (isBedroomType(aMeta.type) && isBedroomType(bMeta.type)) return false;
    if ((aMeta.type === 'entry' && isBathType(bMeta.type)) || (bMeta.type === 'entry' && isBathType(aMeta.type))) {
      return false;
    }
    if (!isAllowedGaragePair(aMeta, bMeta)) return false;
    if (!isAllowedStairPair(aMeta, bMeta)) return false;
    return true;
  }

  function findAdj(aId, bId) {
    return adjacency.find((e) => {
      const A = String(e.a.id);
      const B = String(e.b.id);
      return (A === String(aId) && B === String(bId)) || (A === String(bId) && B === String(aId));
    });
  }

  const hallRooms = meta.filter((m) => m.type === 'hallway');
  const hall = hallRooms[0] || null;
  const stairs = meta.find((m) => m.type === 'stairs');
  const stairCore = level?.stairCore || null;
  const stairHall = stairCore?.hallRoomId ? meta.find((m) => m.id === String(stairCore.hallRoomId)) : null;
  const explicitStairLanding = Boolean(
    stairCore?.landingOpen ||
    (Array.isArray(stairCore?.branchRoomIds) && stairCore.branchRoomIds.length > 0)
  );
  const stairLanding = stairCore?.landingRoomId ? meta.find((m) => m.id === String(stairCore.landingRoomId)) : null;
  const preferredStairHallId = String(stairLanding?.id || stairHall?.id || stairCore?.hallRoomId || hall?.id || '');

  for (const d of existingDoors) {
    const a = String(d.a || '');
    const b = String(d.b || '');
    if (!a || !b) continue;
    if (b !== '__exterior__') {
      const aMeta = metaById.get(a);
      const bMeta = metaById.get(b);
      if (!isAllowedDoorPair(aMeta, bMeta)) continue;
    }
    const sig = doorSig(d);
    if (usedDoorSigs.has(sig)) continue;
    const door = { x: num(d.x), y: num(d.y), dir: d.dir === 'horizontal' ? 'horizontal' : 'vertical', a, b };
    if (d?.openThreshold) door.openThreshold = true;
    doors.push(door);
    usedDoorSigs.add(sig);
    usedPairs.add(pairKey(a, b));
  }

  // primary_bathroom is ONLY accessible from the primary_bedroom, never from hallway.
  // Also skip garage (gets its own exterior door) and stairs (gets exactly one
  // hallway door from the dedicated stairs→preferredHall block below — connecting
  // every adjacent hallway here creates physically impossible dual-side openings).
  const HALL_SKIP_TYPES = new Set(['garage', 'stairs', 'laundry', 'mudroom']);

  for (const hallRoom of hallRooms) {
    for (const m of meta) {
      if (m.id === hallRoom.id) continue;
      if (HALL_SKIP_TYPES.has(m.type) || (strictEnsuiteDooring && isEnsuiteOnly(m))) continue;
      const adj = findAdj(hallRoom.id, m.id);
      if (adj) addDoor(doors, usedPairs, hallRoom.id, m.id, adj.wall, lvlW, lvlH);
    }
  }

  // Topology-driven required access pass: connect rooms to their intended target
  // before fallback door discovery begins.
  for (const m of meta) {
    const candidateEdges = adjacency
      .filter((e) => String(e.a.id) === m.id || String(e.b.id) === m.id)
      .map((e) => {
        const other = String(e.a.id) === m.id
          ? meta.find((x) => x.id === String(e.b.id))
          : meta.find((x) => x.id === String(e.a.id));
        return { e, other };
      });

    const required = chooseRequiredConnection(m, candidateEdges);
    if (required) {
      const aMeta = metaById.get(String(required.a.id));
      const bMeta = metaById.get(String(required.b.id));
      if (!isAllowedDoorPair(aMeta, bMeta)) continue;
      addDoor(doors, usedPairs, required.a.id, required.b.id, required.wall, lvlW, lvlH);
    }
  }

  // ENTRY CONNECTIVITY: The foyer/protrusion entry must connect to stairs (so you
  // can reach level 2) AND to a public room (so you can enter the living area).
  // The foyer is in the protrusion zone (y=0..protrusionTiles), so it's NOT adjacent
  // to the hallway which sits below the service zone. We must explicitly wire it.
  const foyer = meta.find((m) => m.type === 'entry' && String(m.id).includes('protrusion'));
  if (foyer) {
    // Connect foyer → stairs (so you can use the stairs from the front door)
    if (stairs && !preferredStairHallId) {
      const adjFS = findAdj(foyer.id, stairs.id);
      if (adjFS && isAllowedDoorPair(foyer, stairs)) addDoor(doors, usedPairs, foyer.id, stairs.id, adjFS.wall, lvlW, lvlH);
    }
    // Connect foyer → public room (great room / living room) if adjacent.
    // Also try any other entry or service-entry room adjacent to a public room.
    const publics = meta.filter((m) => isPublic(m.type));
    for (const pub of publics) {
      const adjFP = findAdj(foyer.id, pub.id);
      if (adjFP) { addDoor(doors, usedPairs, foyer.id, pub.id, adjFP.wall, lvlW, lvlH); break; }
    }
    // If foyer still doesn't reach a public room, try via any circulation-adjacent room
    // (e.g. foyer → bath which is already on hallway → public works)
    // At minimum, foyer must have a door somewhere — handled by degree=0 fallback below
  }

  // Primary bathroom: connect ONLY to primary bedroom (ensuite door).
  const primaryBath = meta.find((m) => m.type === 'primary_bathroom');
  const primaryBed  = meta.find((m) => m.type === 'primary_bedroom');
  if (primaryBath && primaryBed) {
    const adj = findAdj(primaryBath.id, primaryBed.id);
    if (adj) addDoor(doors, usedPairs, primaryBed.id, primaryBath.id, adj.wall, lvlW, lvlH);
  }

  // Private secondary ensuite baths: door ONLY to their attached bedroom.
  const privateEnsuites = meta.filter((m) => m.type === 'bathroom' && m.bathroomUse === 'private' && m.attachedTo);
  for (const bath of privateEnsuites) {
    const bed = metaById.get(String(bath.attachedTo));
    if (!bed) continue;
    const adj = findAdj(bath.id, bed.id);
    if (adj) addDoor(doors, usedPairs, bath.id, bed.id, adj.wall, lvlW, lvlH);
  }

  if (stairs) {
    const preferredHall = stairLanding || stairHall || hall;
    if (preferredHall) {
      const adjSH = findAdj(stairs.id, preferredHall.id);
      if (adjSH) {
        const existingStairDoor = doors.find((door) => {
          const a = String(door.a || '');
          const b = String(door.b || '');
          return (
            (a === String(stairs.id) && b === String(preferredHall.id)) ||
            (a === String(preferredHall.id) && b === String(stairs.id))
          );
        });
        if (existingStairDoor && stairCore?.landingOpen) {
          existingStairDoor.openThreshold = true;
        }
        addDoor(
          doors,
          usedPairs,
          stairs.id,
          preferredHall.id,
          adjSH.wall,
          lvlW,
          lvlH,
          stairCore?.landingOpen ? { openThreshold: true } : {}
        );
      }
    }
    // Do not add public-room doors directly to stairs. Stair access should occur
    // from hallway/landing side only so each level uses a meaningful endpoint.
  }

  const garageRoom = meta.find((m) => m.type === 'garage');
  if (garageRoom) {
    const existingGarageInterior = doors.find((door) => {
      const a = String(door.a || '');
      const b = String(door.b || '');
      if (a === '__exterior__' || b === '__exterior__') return false;
      return a === garageRoom.id || b === garageRoom.id;
    });

    const addGarageDoorTo = (targetMeta) => {
      if (!targetMeta) return false;
      const adj = findAdj(garageRoom.id, targetMeta.id);
      if (!adj || !isAllowedDoorPair(garageRoom, targetMeta)) return false;
      addDoor(doors, usedPairs, garageRoom.id, targetMeta.id, adj.wall, lvlW, lvlH);
      return true;
    };

    const adjacentGarageHall = hallRooms.find((candidate) => findAdj(garageRoom.id, candidate.id));
    if (adjacentGarageHall) {
      addGarageDoorTo(adjacentGarageHall);
    } else if (!existingGarageInterior) {
      const garageFallbackTargets = [
        ...meta.filter((m) => m.type === 'entry'),
        ...meta.filter((m) => m.type === 'mudroom'),
        ...meta.filter((m) => m.type === 'laundry'),
      ];
      for (const targetMeta of garageFallbackTargets) {
        if (addGarageDoorTo(targetMeta)) break;
      }
    }
  }

  if (!openConcept) {
    const publics = meta.filter((m) => isPublic(m.type));
    for (let i = 0; i < publics.length; i++) {
      for (let j = i + 1; j < publics.length; j++) {
        const adj = findAdj(publics[i].id, publics[j].id);
        if (adj) addDoor(doors, usedPairs, publics[i].id, publics[j].id, adj.wall, lvlW, lvlH);
      }
    }
  }

  // ── OUTDOOR ROOM CONNECTIVITY ─────────────────────────────────────────────
  // Connect outdoor rooms (porch, deck, patio) to adjacent public rooms via
  // a sliding/exterior door. Prefer living_room, then dining_room, then kitchen.
  const outdoorRooms = meta.filter((m) => isOutdoorType(m.type));
  for (const outdoor of outdoorRooms) {
    const publicNeighbors = adjacency
      .filter((e) => String(e.a.id) === outdoor.id || String(e.b.id) === outdoor.id)
      .map((e) => {
        const otherId = String(e.a.id) === outdoor.id ? String(e.b.id) : String(e.a.id);
        const other = metaById.get(otherId);
        if (!other) return null;
        const priority = other.type === 'living_room' ? 3
          : other.type === 'dining_room' ? 2
          : isPublic(other.type) ? 1
          : 0;
        return priority > 0 ? { e, other, priority } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.priority - a.priority);
    if (publicNeighbors.length) {
      const best = publicNeighbors[0].e;
      addDoor(doors, usedPairs, best.a.id, best.b.id, best.wall, lvlW, lvlH, { sliding: true });
    }
  }

  const degree = new Map(meta.map((m) => [m.id, 0]));
  for (const d of [...doors, ...[...openPairs].map((k) => { const [a, b] = k.split('|'); return { a, b }; })]) {
    degree.set(String(d.a), (degree.get(String(d.a)) || 0) + 1);
    degree.set(String(d.b), (degree.get(String(d.b)) || 0) + 1);
  }


  // Ensure laundry and mudroom get doors to hallway or public rooms
  const serviceRooms = meta.filter((m) => ['laundry', 'mudroom', 'entry'].includes(m.type));
  for (const s of serviceRooms) {
    const serviceAccessRank = s.type === 'entry'
      ? ['hallway', 'living_room', 'dining_room', 'kitchen', 'mudroom']
      : ['hallway', 'entry', 'living_room', 'dining_room', 'kitchen', 'mudroom', 'laundry'];
    const candidates = adjacency.filter((e) => {
      const aId = String(e.a.id);
      const bId = String(e.b.id);
      if (aId !== s.id && bId !== s.id) return false;
      const otherId = String(e.a.id) === s.id ? String(e.b.id) : String(e.a.id);
      const other = metaById.get(otherId);
      return other && serviceAccessRank.includes(other.type) && e.wall.seg >= (wideDoorways ? 5 : 4);
    }).sort((a, b) => {
      const other = e => metaById.get(String(e.a.id) === s.id ? String(e.b.id) : String(e.a.id));
      return serviceAccessRank.indexOf(other(a).type) - serviceAccessRank.indexOf(other(b).type);
    });
    const adj = candidates[0];
    if (adj) {
      addDoor(doors, usedPairs, adj.a.id, adj.b.id, adj.wall, lvlW, lvlH);
      degree.set(String(adj.a.id), (degree.get(String(adj.a.id)) || 0) + 1);
      degree.set(String(adj.b.id), (degree.get(String(adj.b.id)) || 0) + 1);
    }
  }


  
  
  
  // Ensure bedrooms get doors to hallway or public rooms
  const bedroomsList = meta.filter((m) => isBedroomType(m.type));
  for (const b of bedroomsList) {
    const bId = String(b.id);
    const nbs = Array.from(usedPairs)
      .filter(k => k.includes(bId))
      .map(k => k.split('|').find(id => id !== bId));
    const hasCirc = nbs.some(id => {
      const m = metaById.get(id);
      const edge = findAdj(bId, id);
      return m && edge?.wall?.seg >= (wideDoorways ? 5 : 4) &&
        (m.type === 'hallway' || isPublic(m.type) || m.type === 'entry');
    });
    if (hasCirc) continue;

    // Try to find a circulation neighbor
    const accessRank = ['hallway', 'entry', 'living_room', 'dining_room', 'kitchen', 'mudroom', 'laundry'];
    const circNbs = meta.filter(m => accessRank.includes(m.type))
      .sort((a, b) => accessRank.indexOf(a.type) - accessRank.indexOf(b.type));
    let found = false;
    for (const circ of circNbs) {
      const adj = findAdj(bId, circ.id);
      if (adj && adj.wall.seg >= (wideDoorways ? 5 : 4)) {
        addDoor(doors, usedPairs, adj.a.id, adj.b.id, adj.wall, lvlW, lvlH);
        degree.set(bId, (degree.get(bId) || 0) + 1);
        found = true;
        break;
      }
    }
    if (found) continue;

    // FALLBACK: If no circulation neighbor, connect to any non-ensuite neighbor.
    // Skip ensuite-only rooms and stairs — a stair-to-bedroom door would be removed
    // by the stair safety pass later, leaving the bedroom isolated.
    // Connecting stacked bedrooms to each other creates a chain
    // (bed_11→bed_12→bed_10→corridor) that validateConnectivity accepts.
    // Continue past candidates that are already paired (don't break on no-ops).
    const allNbs = meta.filter(m => {
      if (m.id === bId) return false;
      if (strictEnsuiteDooring && isEnsuiteOnly(m)) return false;
      if (m.type === 'stairs') return false;
      return true;
    });
    for (const other of allNbs) {
      const adj = findAdj(bId, other.id);
      if (!adj) continue;
      const k = pairKey(adj.a.id, adj.b.id);
      if (usedPairs.has(k)) continue; // already connected — keep looking
      addDoor(doors, usedPairs, adj.a.id, adj.b.id, adj.wall, lvlW, lvlH);
      degree.set(bId, (degree.get(bId) || 0) + 1);
      break;
    }
  }




  for (const m of meta) {
    if ((degree.get(m.id) || 0) > 0) continue;
    // RELAXED: Even ensuite rooms need a door if they have no doors at all
    const candidates = adjacency
      .filter((e) => String(e.a.id) === m.id || String(e.b.id) === m.id)
      .map((e) => {
        const self = metaById.get(m.id);
        const other = String(e.a.id) === m.id ? meta.find((x) => x.id === String(e.b.id)) : meta.find((x) => x.id === String(e.a.id));
        // if (!isAllowedDoorPair(self, other)) return null; // RELAXED FOR FALLBACK
        // Hallway is the gold standard for connectivity — strongly prefer it over stairs
        const hallBonus  = (other && other.type === 'hallway') ? 200 : 0;
        const circBonus  = (other && isCirculation(other.type) && other.type !== 'stairs') ? 80 : 0;
        const stairPenal = (other && other.type === 'stairs') ? -50 : 0;
        const pubBonus   = (other && isPublic(other.type)) ? 50 : 0;
        const entryBathPenalty =
          self && other && isBathType(self.type) && other.type === 'entry' ? -140 : 0;
        const serviceBathBonus =
          self && other && isBathType(self.type) && other.type === 'mudroom' ? 60
          : self && other && isBathType(self.type) && other.type === 'laundry' ? 35
          : 0;
        const score = hallBonus + circBonus + stairPenal + pubBonus + entryBathPenalty + serviceBathBonus + e.wall.seg;
        return { e, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    if (candidates.length) {
      const best = candidates[0].e;
      const aMeta = metaById.get(String(best.a.id));
      const bMeta = metaById.get(String(best.b.id));
      // Guard: do not create a door that gives an ensuite-only room a non-ensuite
      // connection. That would trigger "primary bathroom has non-ensuite access" in
      // validateConnectivity. Ensuite baths already have their dedicated door; a
      // storage or other room that happens to be adjacent should not get one.
      const ensuiteViolation = strictEnsuiteDooring &&
        ((isEnsuiteOnly(aMeta) && !isAllowedEnsuitePair(aMeta, bMeta)) ||
         (isEnsuiteOnly(bMeta) && !isAllowedEnsuitePair(bMeta, aMeta)));
      // Never create a stair-to-non-hallway door in the degree=0 fallback.
      // Stair connectivity is handled exclusively by the stairs block above.
      const stairViolation = !isAllowedStairPair(aMeta, bMeta);
      if (!ensuiteViolation && !stairViolation) {
        addDoor(doors, usedPairs, best.a.id, best.b.id, best.wall, lvlW, lvlH);
      }
    }
  }

  // ── STAIR SAFETY PASS ────────────────────────────────────────────────────────
  // Belt-and-suspenders: remove any door connecting stairs to a non-hallway/entry
  // room that slipped through earlier passes. Stairs must only connect to hallway
  // landing rooms. After removal, ensure each stair still has at least one door.
  {
    const stairIds = new Set(meta.filter((m) => m.type === 'stairs').map((m) => m.id));
    const legalStairNeighborTypes = new Set(['hallway', 'entry']);
    for (let i = doors.length - 1; i >= 0; i--) {
      const d = doors[i];
      const a = String(d.a || '');
      const b = String(d.b || '');
      if (b === '__exterior__') continue;
      const aIsStair = stairIds.has(a);
      const bIsStair = stairIds.has(b);
      if (!aIsStair && !bIsStair) continue;
      const otherMeta = metaById.get(aIsStair ? b : a);
      if (!otherMeta) continue;
      const isLegalExplicitLanding = explicitStairLanding && String(otherMeta.id) === preferredStairHallId;
      if (isLegalExplicitLanding || (!explicitStairLanding && legalStairNeighborTypes.has(otherMeta.type))) continue;
      // Illegal stair door — remove it
      doors.splice(i, 1);
      usedPairs.delete(pairKey(a, b));
    }
    // Re-connect any stair that is now doorless
    for (const stair of meta.filter((m) => m.type === 'stairs')) {
      const hasDoor = doors.some((d) => String(d.a) === stair.id || String(d.b) === stair.id);
      if (hasDoor) continue;
      // Find nearest hallway/entry by wall adjacency and add a door
      const hallNeighbors = adjacency
        .filter((e) => String(e.a.id) === stair.id || String(e.b.id) === stair.id)
        .map((e) => ({
          other: String(e.a.id) === stair.id ? metaById.get(String(e.b.id)) : metaById.get(String(e.a.id)),
          wall: e.wall,
        }))
        .filter((x) => {
          if (!x.other) return false;
          if (explicitStairLanding) return String(x.other.id) === preferredStairHallId;
          return legalStairNeighborTypes.has(x.other.type);
        });
      if (hallNeighbors.length) {
        addDoor(
          doors,
          usedPairs,
          stair.id,
          hallNeighbors[0].other.id,
          hallNeighbors[0].wall,
          lvlW,
          lvlH,
          stairCore?.landingOpen ? { openThreshold: true } : {}
        );
      }
    }
  }
  // ── END STAIR SAFETY PASS ────────────────────────────────────────────────────

  const finalDoors = [];
  const seenDoorSigs = new Set();

  // ── BFS BRIDGE PASS ──────────────────────────────────────────────────────────
  // After all door placement, some rooms may still be unreachable from circulation.
  // Topology-level impossibilities should be filtered earlier by the
  // strict_connectivity_infeasible scoring gate.
  // (e.g. bedroom chains: bed_11↔bed_12 but neither touches a hallway).
  // Perform a BFS from all circulation nodes; any reachable node is "connected".
  // For each disconnected room, find its shortest adjacency path to any connected
  // room and add bridging doors along that path.
  function buildAdjMap(doorList) {
    const map = new Map();
    for (const d of [...doorList, ...[...openPairs].map((k) => { const [a, b] = k.split('|'); return { a, b }; })]) {
      const a = String(d.a), b = String(d.b);
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a).add(b);
      map.get(b).add(a);
    }
    return map;
  }

  function reachableSet(adjMap, seeds) {
    const visited = new Set(seeds);
    const queue = [...seeds];
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of (adjMap.get(cur) || [])) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
      }
    }
    return visited;
  }

  // Bridge from the same circulation seed logic used by validateConnectivity:
  // hallway -> exterior public room -> first room fallback.
  const rootIds = meta
    .filter((m) => {
      const t = m.type;
      return isPublic(t) || t === 'hallway' || t === 'entry' || t === 'mudroom' || t === 'laundry';
    })
    .map((m) => m.id);

  // Build adjacency map from wall adjacency (NOT doors) for pathfinding
  const wallAdjMap = new Map();
  for (const e of adjacency) {
    const a = String(e.a.id), b = String(e.b.id);
    if (!wallAdjMap.has(a)) wallAdjMap.set(a, []);
    if (!wallAdjMap.has(b)) wallAdjMap.set(b, []);
    wallAdjMap.get(a).push({ id: b, wall: e.wall });
    wallAdjMap.get(b).push({ id: a, wall: e.wall });
  }

  // BFS from circulation to find shortest wall-path to any disconnected room
  function findPathToCirculation(startId, connected) {
    if (connected.has(startId)) return null;
    // BFS over wall adjacency
    const prev = new Map();
    const visited = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
      const cur = queue.shift();
      if (connected.has(cur)) {
        // Reconstruct path
        const path = [];
        let c = cur;
        while (prev.has(c)) {
          const p = prev.get(c);
          path.unshift({ from: p.from, to: c, wall: p.wall });
          c = p.from;
        }
        return path;
      }
      for (const { id: nb, wall } of (wallAdjMap.get(cur) || [])) {
        const curMeta = metaById.get(String(cur));
        const nbMeta = metaById.get(String(nb));
        if (false) { // relaxed
          continue;
        }
        if (!isAllowedStairPair(curMeta, nbMeta)) continue;
        if (!visited.has(nb)) {
          visited.add(nb);
          prev.set(nb, { from: cur, wall });
          queue.push(nb);
        }
      }
    }
    return null;
  }

  // Pick a bridge edge that actually grows the graph.
  // Walk from circulation side toward the disconnected room and choose
  // the first valid edge that does not already have a door.
  function chooseBridgeStep(path) {
    if (!Array.isArray(path) || !path.length) return null;

    const isStepAllowed = (step) => {
      const aMeta = metaById.get(String(step.from));
      const bMeta = metaById.get(String(step.to));
      return isAllowedDoorPair(aMeta, bMeta);
    };

    for (let i = path.length - 1; i >= 0; i--) {
      const step = path[i];
      if (!isStepAllowed(step)) continue;
      if (!usedPairs.has(pairKey(step.from, step.to))) return step;
    }

    for (let i = path.length - 1; i >= 0; i--) {
      const step = path[i];
      if (isStepAllowed(step)) return step;
    }
    return null;
  }

  // Iteratively bridge disconnected rooms (max 10 iterations to avoid infinite loop)
  for (let iter = 0; iter < 10; iter++) {
    const adjMap = buildAdjMap(doors);
    const connected = reachableSet(adjMap, rootIds.filter((id) => adjMap.has(id) || rootIds.includes(id)));
    for (const id of rootIds) connected.add(id);

    const disconnected = meta.filter((m) => !connected.has(m.id));
    if (!disconnected.length) break;

    let addedAny = false;
    for (const m of disconnected) {
      const path = findPathToCirculation(m.id, connected);
      if (path && path.length > 0) {
        const step = chooseBridgeStep(path);
        if (!step) continue;
        const doorCountBefore = doors.length;
        addDoor(doors, usedPairs, step.from, step.to, step.wall, lvlW, lvlH);
        const doorWasAdded = doors.length > doorCountBefore;
        if (doorWasAdded || connected.has(step.to)) {
          connected.add(step.from);
          addedAny = true;
        }
      }
    }
    if (!addedAny) break; // No more connections possible
  }
  // ── END BFS BRIDGE PASS ──────────────────────────────────────────────────────

  // ── PUBLIC CLUSTER CONNECTIVITY PASS ─────────────────────────────────────────
  // The BFS bridge pass seeds from ALL public rooms, so kitchen/dining/living are
  // always "connected" even if they cannot reach hallway/entry. This pass explicitly
  // checks reachability from hallway/entry and force-adds a bridge door (even through
  // a bathroom, which is normally blocked) when a public room has no path to circulation.
  {
    const circSeeds = meta.filter((m) => m.type === 'hallway' || m.type === 'entry').map((m) => m.id);
    if (circSeeds.length > 0) {
      const doorAdjMap = buildAdjMap(doors);
      const circReachable = reachableSet(doorAdjMap, circSeeds.filter((id) => doorAdjMap.has(id)));
      for (const id of circSeeds) circReachable.add(id);

      const publicLiving = meta.filter((m) => ['living_room', 'dining_room', 'kitchen'].includes(m.type));
      for (const m of publicLiving) {
        if (circReachable.has(m.id)) continue;
        // Force a door to the nearest reachable neighbor. Prefer non-ensuite rooms
        // to avoid creating public↔private-ensuite connections that violate ensuite rules.
        const neighbors = wallAdjMap.get(m.id) || [];
        const reachableNeighbor = neighbors.find((nb) => {
          if (!circReachable.has(nb.id)) return false;
          const nbMeta = metaById.get(nb.id);
          return !(strictEnsuiteDooring && nbMeta && isEnsuiteOnly(nbMeta));
        });
        if (reachableNeighbor) {
          addDoor(doors, usedPairs, m.id, reachableNeighbor.id, reachableNeighbor.wall, lvlW, lvlH);
          circReachable.add(m.id);
        }
      }
    }
  }
  // ── END PUBLIC CLUSTER CONNECTIVITY PASS ────────────────────────────────────

  for (const d of doors) {
    const aMeta = metaById.get(String(d.a));
    const bMeta = metaById.get(String(d.b));
    const openConceptPublicCore = new Set(['living_room', 'dining_room', 'kitchen']);
    const isOpenConceptPublicDoor =
      openConcept &&
      aMeta &&
      bMeta &&
      openConceptPublicCore.has(aMeta.type) &&
      openConceptPublicCore.has(bMeta.type);
    if (isOpenConceptPublicDoor) continue;
    if (openPairs.has(pairKey(d.a, d.b))) continue;
    if (!isAllowedStairPair(aMeta, bMeta)) continue;
    // RELAXED: If a door was added by the bridge pass or fallback, keep it even if it violates strict rules
    // (e.g. laundry to bedroom is better than an unreachable laundry)
    // if (!isAllowedDoorPair(aMeta, bMeta)) {
    //   continue;
    // }
    const sig = doorSig(d);
    if (seenDoorSigs.has(sig)) continue;
    seenDoorSigs.add(sig);
    finalDoors.push(d);
  }

  const windows = [];
  const seenWindowSigs = new Set();
  for (const w of existingWindows) {
    const clean = { x: num(w.x), y: num(w.y), dir: w.dir === 'horizontal' ? 'horizontal' : 'vertical' };
    const sig = windowSig(clean);
    if (!seenWindowSigs.has(sig)) {
      seenWindowSigs.add(sig);
      windows.push(clean);
    }
  }

  for (const m of meta) {
    if (!isWindowEligible(m.type)) continue;
    const exteriorSegments = boundarySegments(m.room, rooms, true);
    if (!exteriorSegments.length) continue;

    if (glazingProfile === 'privacy_first') {
      const privacyEligible = isPublic(m.type) || isBedroomType(m.type);
      if (!privacyEligible) continue;
    }

    const R = rectOf(m.room);
    const candidates = exteriorSegments.filter(s => s.end - s.start >= 5).map(s => ({
      ...s,
      edge: s.dir === 'vertical' ? (s.side > 0 ? 'left' : 'right') : (s.side > 0 ? 'top' : 'bottom'),
      x: s.dir === 'vertical' ? s.fixed : (s.start + s.end) / 2,
      y: s.dir === 'horizontal' ? s.fixed : (s.start + s.end) / 2,
      len: s.end - s.start,
    }));
    if (!candidates.length) continue;

    const openingIntent = m.room?.openingIntent || null;
    const preferredEdges = Array.isArray(openingIntent?.preferredEdges) ? openingIntent.preferredEdges : [];
    const intentDesiredRaw = Number(openingIntent?.desiredWindowCount);
    const hasIntentDesired = Number.isFinite(intentDesiredRaw);
    const intentDesired = hasIntentDesired ? Math.max(0, Math.round(intentDesiredRaw)) : null;

    const desiredCount = (() => {
      if (glazingProfile === 'privacy_first') {
        if (hasIntentDesired) return Math.min(intentDesired, 1);
        if (isPublic(m.type)) return 1;
        if (m.type === 'primary_bedroom') return 1;
        return 0;
      }
      if (glazingProfile === 'maximum_glazing') {
        if (hasIntentDesired) return Math.max(intentDesired, isPublic(m.type) ? 2 : 1);
        if (isPublic(m.type)) return Math.max(2, Math.min(4, candidates.length + 1));
        if (isBedroomType(m.type)) return Math.max(2, Math.min(3, candidates.length + 1));
        return Math.max(1, Math.min(2, candidates.length + 1));
      }
      if (hasIntentDesired) return intentDesired;
      return candidates.length >= 2 ? 2 : 1;
    })();
    if (desiredCount <= 0) continue;

    candidates.sort((a, b) => {
      const edgeScore = (c) => {
        let s = c.len;
        if (preferredEdges.includes(c.edge)) s += 20;
        if (viewFocusedLot && c.edge === viewEdge && isPublic(m.type)) s += 8;
        if (c.edge === frontEdge && glazingProfile === 'privacy_first') s -= 8;
        if (c.edge === frontEdge && glazingProfile === 'maximum_glazing' && isPublic(m.type)) s += 3;
        if (openingIntent?.avoidFrontEdge && c.edge === frontEdge) s -= num(openingIntent?.frontEdgePenalty, 10);
        if (openingIntent?.glazing === 'restricted' && c.edge === frontEdge) s -= 6;
        return s;
      };
      return edgeScore(b) - edgeScore(a);
    });

    const placementCount = glazingProfile === 'maximum_glazing'
      ? desiredCount
      : Math.min(desiredCount, candidates.length);

    for (let i = 0; i < placementCount; i++) {
      const c = glazingProfile === 'maximum_glazing'
        ? candidates[i % candidates.length]
        : candidates[i];
      const wave = glazingProfile === 'maximum_glazing'
        ? Math.floor(i / Math.max(1, candidates.length))
        : 0;
      const offset = glazingProfile === 'maximum_glazing'
        ? ((i % 2 === 0 ? 1 : -1) * (wave + 1) * 3)
        : i * 4;

      const candidateWindow = c.dir === 'vertical'
        ? { roomId: m.id, width: 4, x: c.x, y: clamp(c.y + offset, c.start + 2.5, c.end - 2.5), dir: 'vertical' }
        : { roomId: m.id, width: 4, x: clamp(c.x + offset, c.start + 2.5, c.end - 2.5), y: c.y, dir: 'horizontal' };
      const sig = windowSig(candidateWindow);
      if (!seenWindowSigs.has(sig)) {
        seenWindowSigs.add(sig);
        windows.push(candidateWindow);
      }
    }
  }

  // Indoor/outdoor: add an exterior public opening on level 1 when user wants
  // max connection, or opens onto a porch, deck or patio.
  if ((maxIndoorOutdoor || outdoorLiving) && num(level.level, 1) === 1) {
    const outdoorEdge = viewFocusedLot ? viewEdge : oppositeEdge(frontEdge);
    const outdoorCandidates = meta.filter(m => isPublic(m.type) && boundarySegments(m.room, rooms, true).some(s => s.end-s.start >= 9))
      .sort((a,b) => ['living_room','dining_room','kitchen'].indexOf(a.type) - ['living_room','dining_room','kitchen'].indexOf(b.type));
    const livingWithExterior = outdoorCandidates.find(m => m.type === 'living_room' && touchesExterior(m.room, lvlW, lvlH));
    const publicRoom = livingWithExterior || outdoorCandidates.find((m) =>
      isPublic(m.type) &&
      roomTouchesEdge(m.room, outdoorEdge, lvlW, lvlH)
    ) || outdoorCandidates.find((m) => isPublic(m.type) && touchesExterior(m.room, lvlW, lvlH));

    if (publicRoom) {
      const R = rectOf(publicRoom.room);
      let extDoor = null;
      if (outdoorEdge === 'left' && R.x === 0) extDoor = { x: 0, y: R.y + R.h / 2, dir: 'vertical' };
      if (outdoorEdge === 'right' && R.x2 === lvlW) extDoor = { x: lvlW, y: R.y + R.h / 2, dir: 'vertical' };
      if (outdoorEdge === 'top' && R.y === 0) extDoor = { x: R.x + R.w / 2, y: 0, dir: 'horizontal' };
      if (outdoorEdge === 'bottom' && R.y2 === lvlH) extDoor = { x: R.x + R.w / 2, y: lvlH, dir: 'horizontal' };
      if (!extDoor) {
        if (R.y2 === lvlH) extDoor = { x: R.x + R.w / 2, y: lvlH, dir: 'horizontal' };
        else if (R.y === 0) extDoor = { x: R.x + R.w / 2, y: 0, dir: 'horizontal' };
        else if (R.x2 === lvlW) extDoor = { x: lvlW, y: R.y + R.h / 2, dir: 'vertical' };
        else if (R.x === 0) extDoor = { x: 0, y: R.y + R.h / 2, dir: 'vertical' };
      }
      // The preferred facade can be too short after a study is carved out.
      // Choose a real exterior wall with room for the full opening and jambs.
      const hosts = boundarySegments(publicRoom.room, rooms, true)
        .filter(s => s.end - s.start >= 9)
        .sort((a,b) => (b.end-b.start)-(a.end-a.start));
      if (extDoor && !hosts.some(s => s.dir === extDoor.dir && s.fixed === (s.dir === 'vertical' ? extDoor.x : extDoor.y))) extDoor = null;
      if (!extDoor && hosts.length) {
        const host = hosts[0], center = (host.start + host.end) / 2;
        extDoor = { dir:host.dir, x:host.dir === 'vertical' ? host.fixed : center, y:host.dir === 'vertical' ? center : host.fixed };
      }
      if (extDoor) {
        finalDoors.push({
          x: clamp(extDoor.x, 0, lvlW),
          y: clamp(extDoor.y, 0, lvlH),
          dir: extDoor.dir,
          a: publicRoom.id,
          b: '__exterior__',
          width: maxIndoorOutdoor ? 8 : 6,
          heightFt: 7,
          slidingDoor: true,
          ...(maxIndoorOutdoor ? { indoorOutdoorOpening: true } : {}),
          ...(outdoorLiving ? { outdoorLivingDoor: true } : {}),
        });
      }
    }
  }

  // ── MAIN ENTRY EXTERIOR DOOR ────────────────────────────────────────────
  // Every level 1 needs a recognized front entry door.
  if (num(level.level, 1) === 1) {
    const frontEntryTypes = ['entry_foyer', 'entry', 'public_hall_or_gallery', 'hallway'];
    let bestEntry = null;
    const actualEntryTypes = new Set(['entry_foyer', 'entry']);

    for (const type of frontEntryTypes) {
      bestEntry = meta.find((m) => m.type === type && roomTouchesEdge(m.room, frontEdge, lvlW, lvlH));
      if (bestEntry) break;
    }
    if (!bestEntry) {
      bestEntry = meta.find((m) => actualEntryTypes.has(m.type) && touchesExterior(m.room, lvlW, lvlH));
    }
    if (!bestEntry) {
      bestEntry = meta.find((m) => m.room?.openingIntent?.entryEligible && touchesExterior(m.room, lvlW, lvlH));
    }
    if (!bestEntry) {
      bestEntry = meta.find((m) => m.room?.openingIntent?.entryEligible && roomTouchesEdge(m.room, frontEdge, lvlW, lvlH));
    }
    if (!bestEntry) bestEntry = meta.find((m) => isPublic(m.type) && roomTouchesEdge(m.room, frontEdge, lvlW, lvlH));
    if (!bestEntry) bestEntry = meta.find((m) => roomTouchesEdge(m.room, frontEdge, lvlW, lvlH));

    if (bestEntry) {
      const R = rectOf(bestEntry.room);
      let extDoor = null;
      if (frontEdge === 'bottom' && R.y2 === lvlH) extDoor = { x: R.x + R.w / 2, y: lvlH, dir: 'horizontal' };
      else if (frontEdge === 'top' && R.y === 0) extDoor = { x: R.x + R.w / 2, y: 0, dir: 'horizontal' };
      else if (frontEdge === 'left' && R.x === 0) extDoor = { x: 0, y: R.y + R.h / 2, dir: 'vertical' };
      else if (frontEdge === 'right' && R.x2 === lvlW) extDoor = { x: lvlW, y: R.y + R.h / 2, dir: 'vertical' };
      
      if (!extDoor) {
        if (R.y2 === lvlH) extDoor = { x: R.x + R.w / 2, y: lvlH, dir: 'horizontal' };
        else if (R.y === 0) extDoor = { x: R.x + R.w / 2, y: 0, dir: 'horizontal' };
        else if (R.x === 0) extDoor = { x: 0, y: R.y + R.h / 2, dir: 'vertical' };
        else if (R.x2 === lvlW) extDoor = { x: lvlW, y: R.y + R.h / 2, dir: 'vertical' };
      }

      if (extDoor) {
        finalDoors.push({
          x: clamp(extDoor.x, 0, lvlW),
          y: clamp(extDoor.y, 0, lvlH),
          dir: extDoor.dir,
          a: bestEntry.id,
          b: '__exterior__',
          isMainEntry: true,
        });
      }
    }
  }

  // ── GARAGE EXTERIOR (CAR) DOOR ────────────────────────────────────────────
  // Garages need a wide exterior door on the street-facing wall.
  // In our grid, the garage is always in the top-left corner (x=0, y=0) with its
  // exterior face at y=0 (for protrusion layouts) or the top wall.
  // We add a special 'exterior' door object that the SVG renderer draws as a
  // double-line garage door (no swing arc) centered on the garage's top wall.
  const garageMeta = meta.find((m) => m.type === 'garage');
  if (garageMeta) {
    const R = rectOf(garageMeta.room);
    const mainEntryDoor = finalDoors.find((door) => Boolean(door?.isMainEntry) && String(door?.b) === '__exterior__');
    const effectiveFrontEdge = openingEdge(mainEntryDoor, lvlW, lvlH) || frontEdge;
    const exteriorFaces = [];
    if (R.y === 0) exteriorFaces.push('top');
    if (R.y2 === lvlH) exteriorFaces.push('bottom');
    if (R.x === 0) exteriorFaces.push('left');
    if (R.x2 === lvlW) exteriorFaces.push('right');

    const garageDoorFace = exteriorFaces.includes(effectiveFrontEdge)
      ? effectiveFrontEdge
      : exteriorFaces[0] || 'top';

    let gdx, gdy, gdDir, gdWidth;
    if (garageDoorFace === 'top') {
      gdx = R.x + R.w / 2;
      gdy = R.y;
      gdDir = 'horizontal';
      gdWidth = R.w;
    } else if (garageDoorFace === 'bottom') {
      gdx = R.x + R.w / 2;
      gdy = R.y2;
      gdDir = 'horizontal';
      gdWidth = R.w;
    } else if (garageDoorFace === 'left') {
      gdx = R.x;
      gdy = R.y + R.h / 2;
      gdDir = 'vertical';
      gdWidth = R.h;
    } else {
      gdx = R.x2;
      gdy = R.y + R.h / 2;
      gdDir = 'vertical';
      gdWidth = R.h;
    }

    finalDoors.push({
      x: gdx,
      y: gdy,
      dir: gdDir,
      a: garageMeta.id,
      b: '__exterior__',
      garageDoor: true,  // flag for SVG renderer to draw as garage door
      width: Math.min(gdWidth - 1, Math.min(R.w, R.h) >= 20 ? 16 : 9),
    });
  }
  // ── END GARAGE EXTERIOR DOOR ──────────────────────────────────────────────
  const uniqueDoors = [];
  const finalDoorIndex = new Map();
  // Generic connectivity fallbacks may propose extra suite doors. Rebuild
  // owned closet openings from their physical fronts before full-span fitting.
  const ownedClosets = rooms.filter(r => r.type === 'closet' && r.ownerBedroomId);
  const ownedClosetIds = new Set(ownedClosets.map(r => String(r.id)));
  for (const d of finalDoors) {
    if (ownedClosetIds.has(String(d.a)) || ownedClosetIds.has(String(d.b))) continue;
    if (openPairs.has(pairKey(d.a, d.b))) continue;
    const sig = doorSig(d);
    if (finalDoorIndex.has(sig)) {
      const existing = uniqueDoors[finalDoorIndex.get(sig)];
      if (d.isMainEntry) existing.isMainEntry = true;
      if (d.garageDoor) existing.garageDoor = true;
      if (d.openThreshold) existing.openThreshold = true;
      if (num(d.width) > num(existing.width)) existing.width = num(d.width);
      continue;
    }
    finalDoorIndex.set(sig, uniqueDoors.length);
    uniqueDoors.push({ ...d });
  }

  for (const room of ownedClosets) {
    const layout = closetLayout(room);
    if (layout && !openPairs.has(pairKey(layout.door.a, layout.door.b))) uniqueDoors.push(layout.door);
  }

  if (wideDoorways) {
    for (const door of uniqueDoors) {
      if (door?.garageDoor) continue;
      if (num(door?.width, 0) >= 4) continue;
      door.width = 4;
    }
  }

  finalizeOpenings(level, uniqueDoors, windows);
  // Repair actual disconnected components after full-span fitting. Starting
  // every service/public room as a graph root hid sealed walls and dropped doors.
  for (let attempt = 0; attempt < rooms.length; attempt++) {
    const { root, seen } = physicalAccessState(level, openConcept);
    if (!root || seen.size === rooms.length) break;
    const candidates = adjacency.filter(edge => {
      if (seen.has(String(edge.a.id)) === seen.has(String(edge.b.id))) return false;
      const a = metaById.get(String(edge.a.id)), b = metaById.get(String(edge.b.id));
      if (ownedClosetIds.has(a?.id) || ownedClosetIds.has(b?.id)) return false;
      return edge.wall.seg >= (wideDoorways ? 5 : 4) && isAllowedDoorPair(a, b) &&
        (!(isEnsuiteOnly(a) || isEnsuiteOnly(b)) || isAllowedEnsuitePair(a, b));
    }).sort((a, b) => {
      const privacyCost = edge => [edge.a, edge.b].filter(room => isBedroomType(normalizeType(room.type)) || isBathType(normalizeType(room.type))).length;
      return privacyCost(a) - privacyCost(b) || b.wall.seg - a.wall.seg;
    });
    let added = false;
    for (const edge of candidates) {
      const door = { a: String(edge.a.id), b: String(edge.b.id), x: edge.wall.x, y: edge.wall.y,
        dir: edge.wall.kind === 'vertical' ? 'vertical' : 'horizontal', width: wideDoorways ? 4 : 3 };
      const fitted = fitOpening(level, door, 'door', [...level.doors.map(d => openingSpan(d)), ...level.windows.map(w => openingSpan(w, 'window'))]);
      if (!fitted) continue;
      level.doors.push(fitted);
      added = true;
      break;
    }
    if (!added) break;
  }
  require('./geometry/openingIdentity').assignOpeningIds(level);
  return level;
}

function placeOpenings(planSpec, surveyData = {}) {
  for (const lvl of Array.isArray(planSpec?.levels) ? planSpec.levels : []) {
    placeOpeningsForLevel(lvl, surveyData);
  }
  return planSpec;
}

module.exports = { placeOpenings, placeOpeningsForLevel, normalizeType };
