// lib/tile/scoreFootprint.js
//
// Scores a generated planSpec for architectural quality.
// Higher score = better design. Used to pick the best candidate from 10 footprints.
//
// Scoring criteria:
//  1. Aspect ratio — rectangular is better than square for larger homes
//  2. Bathroom proportions — no bathroom spanning more than 50% of house width
//  3. Primary bathroom adjacency — must be inside primary bedroom zone (not hallway-accessible only)
//  4. Room proportions — no room with extreme aspect ratio (>4:1 or <1:4)
//  5. Stair orientation — stairs should run front-to-back (h > w), not sideways
//  6. Bathroom size sanity — no bathroom > 200 sqft or < 35 sqft
//  7. Room size sanity — major rooms meet minimums
//  8. Footprint shape — penalize squarish layouts for large homes

'use strict';

const { normalizeRoomType, isPublicRoomType, getFeatureKey } = require('./canonicalRoomTypes');
const { buildAccessGraph } = require('../residential/accessGraph');
const {
  boundingRectOf,
  roomArea,
  shareWall: shareWallParts,
  touchesExterior: touchesExteriorParts,
} = require('../planGeometry');
const {
  computePlanQualityMetrics,
  scorePlanQualityMetrics,
} = require('../planQualityMetrics');

function rectOf(r) { return boundingRectOf(r); }
function overlapLen(a1, a2, b1, b2) { return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)); }
function sharesWall(a, b, minSeg = 2) {
  return Boolean(shareWallParts(a, b, minSeg));
}

function roomDims(room) {
  const bounds = rectOf(room);
  return {
    width: bounds.w,
    height: bounds.h,
    shortSide: Math.min(bounds.w || 0, bounds.h || 0),
    longSide: Math.max(bounds.w || 0, bounds.h || 0),
    area: roomArea(room),
  };
}

function touchesExterior(roomRect, lvlW, lvlH) {
  return touchesExteriorParts(roomRect, lvlW, lvlH);
}

function buildWallAdjacency(rooms) {
  const map = new Map();
  for (const room of rooms) {
    map.set(String(room.id), new Set());
  }
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      // Use the same adjacency leniency as placeOpenings bridge search.
      if (!sharesWall(a, b, 1)) continue;
      const A = String(a.id);
      const B = String(b.id);
      map.get(A).add(B);
      map.get(B).add(A);
    }
  }
  return map;
}

function hasEscapePathViaDoors(startId, level, escapeTypes, brief = null) {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const roomById = new Map(rooms.map((room) => [String(room.id), room]));
  const graph = buildAccessGraph(level, brief);
  if (!graph.has(String(startId))) return false;

  const seen = new Set([String(startId)]);
  const queue = [String(startId)];

  while (queue.length) {
    const cur = queue.shift();
    for (const next of graph.get(cur) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const room = roomById.get(String(next));
      const type = normalizeRoomType(room?.type || room?.label || room?.name);
      if (escapeTypes.has(type)) return true;
      queue.push(next);
    }
  }

  return false;
}

function isIgnorableForConnectivity(type) {
  return type === 'garage' || type === 'storage';
}

function isEnsuiteOnly(meta) {
  if (!meta) return false;
  if (meta.type === 'primary_bathroom') return true;
  return meta.type === 'bathroom' && meta.bathroomUse === 'private' && Boolean(meta.attachedTo);
}

function isAllowedEnsuitePair(aMeta, bMeta) {
  if (!aMeta || !bMeta) return false;
  if (aMeta.type === 'primary_bathroom') return bMeta.type === 'primary_bedroom';
  if (bMeta.type === 'primary_bathroom') return aMeta.type === 'primary_bedroom';
  if (aMeta.type === 'bathroom' && aMeta.bathroomUse === 'private' && aMeta.attachedTo) return bMeta.id === aMeta.attachedTo;
  if (bMeta.type === 'bathroom' && bMeta.bathroomUse === 'private' && bMeta.attachedTo) return aMeta.id === bMeta.attachedTo;
  return true;
}

function chooseConnectivitySeed(meta, lvlW, lvlH) {
  let seed = meta.find((m) => m.type === 'hallway') || null;
  if (!seed) {
    seed = meta.find((m) => isPublicRoomType(m.type) && touchesExterior(m.room, lvlW, lvlH)) || null;
  }
  if (!seed && meta.length) seed = meta[0];
  return seed;
}

function assessStrictConnectivityFeasibility(planSpec) {
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  const result = {
    infeasible: false,
    issueCode: null,
    levelFindings: [],
  };

  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    if (!rooms.length) continue;

    const lvlW = Number(lvl.width) || 0;
    const lvlH = Number(lvl.height) || 0;
    const strictEnsuite = (lvlW * lvlH) >= 1000;

    const meta = rooms.map((r) => ({
      room: r,
      id: String(r.id),
      type: normalizeRoomType(r.type || r.label || r.name),
      bathroomUse: String(r.bathroomUse || ''),
      attachedTo: r.attachedTo ? String(r.attachedTo) : null,
    }));
    const metaById = new Map(meta.map((m) => [m.id, m]));
    const adj = buildWallAdjacency(rooms);
    const seed = chooseConnectivitySeed(meta, lvlW, lvlH);
    if (!seed) continue;

    const queue = [seed.id];
    const seen = new Set([seed.id]);

    while (queue.length) {
      const cur = queue.shift();
      for (const nb of adj.get(cur) || []) {
        const curMeta = metaById.get(String(cur));
        const nbMeta = metaById.get(String(nb));
        if (
          strictEnsuite &&
          (isEnsuiteOnly(curMeta) || isEnsuiteOnly(nbMeta)) &&
          !isAllowedEnsuitePair(curMeta, nbMeta)
        ) {
          continue;
        }
        if (seen.has(nb)) continue;
        seen.add(nb);
        queue.push(nb);
      }
    }

    const unreachable = [];
    for (const m of meta) {
      if (isIgnorableForConnectivity(m.type)) continue;
      if (isEnsuiteOnly(m)) continue; // score gate focuses on non-ensuite rooms.
      if (!seen.has(m.id)) unreachable.push(m);
    }

    if (unreachable.length) {
      result.infeasible = true;
      result.issueCode = 'strict_connectivity_infeasible';
      result.levelFindings.push({
        level: Number(lvl.level) || 1,
        strictEnsuite,
        seedId: seed.id,
        unreachableRoomIds: unreachable.map((u) => u.id),
        unreachableRoomTypes: unreachable.map((u) => u.type),
      });
    }
  }

  return result;
}

function requestedFeatureShortfalls(planSpec, brief) {
  const requestedItems = Array.isArray(brief?.requestedFeatureItems)
    ? brief.requestedFeatureItems
    : [];
  const requestedEntries = requestedItems.length
    ? (() => {
        const requirements = new Map();
        for (const item of requestedItems) {
          const kind = String(item?.kind || item?.requestedFeatureKind || item?.canonicalType || '').trim();
          if (!kind) continue;
          const prev = requirements.get(kind) || {
            kind,
            canonicalType: normalizeRoomType(item?.canonicalType || kind),
            label: String(item?.displayLabel || item?.requestedFeatureLabel || kind).trim() || kind,
            wantCount: 0,
          };
          prev.wantCount += 1;
          requirements.set(kind, prev);
        }
        return [...requirements.values()];
      })()
    : Object.entries(brief?.featureCounts && typeof brief.featureCounts === 'object' ? brief.featureCounts : {})
        .filter(([, count]) => Number(count) > 0)
        .map(([featureType, wantCount]) => ({
          kind: String(featureType),
          canonicalType: normalizeRoomType(featureType),
          label: String(featureType),
          wantCount: Number(wantCount) || 0,
        }));
  if (!requestedEntries.length) return [];

  const actualCanonicalCounts = new Map();
  const actualRequestedCounts = new Map();
  for (const lvl of Array.isArray(planSpec?.levels) ? planSpec.levels : []) {
    for (const room of Array.isArray(lvl?.rooms) ? lvl.rooms : []) {
      const featureKey = getFeatureKey(room?.type || room?.label || room?.name);
      actualCanonicalCounts.set(featureKey, (actualCanonicalCounts.get(featureKey) || 0) + 1);
      const requestedKind = String(room?.requestedFeatureKind || '').trim();
      const featureSource = String(room?.featureSource || '').trim().toLowerCase();
      if (requestedKind && (Boolean(room?.requestedFeature) || featureSource === 'requested')) {
        actualRequestedCounts.set(requestedKind, (actualRequestedCounts.get(requestedKind) || 0) + 1);
      }
    }
  }

  const useCanonicalFallback = actualRequestedCounts.size === 0;
  return requestedEntries
    .map((entry) => {
      const gotCount = (actualRequestedCounts.get(entry.kind) || 0)
        || (useCanonicalFallback ? (actualCanonicalCounts.get(entry.canonicalType) || 0) : 0);
      return {
        featureType: entry.kind,
        featureLabel: entry.label,
        wantCount: Number(entry.wantCount) || 0,
        gotCount,
        missingCount: Math.max(0, (Number(entry.wantCount) || 0) - gotCount),
      };
    })
    .filter((item) => item.missingCount > 0);
}

function scoreCandidate(planSpec, footprint, brief) {
  let score = 100;
  const issues = [];
  const warnings = [];

  const strictConnectivityFeasibility = assessStrictConnectivityFeasibility(planSpec);
  if (strictConnectivityFeasibility.infeasible) {
    const detail = strictConnectivityFeasibility.levelFindings
      .map((f) => `L${f.level}:${f.unreachableRoomIds.join('|')}`)
      .join(',');
    issues.push(detail
      ? `${strictConnectivityFeasibility.issueCode}:${detail}`
      : String(strictConnectivityFeasibility.issueCode || 'strict_connectivity_infeasible'));
    // Decisive penalty: infeasible topologies should not survive score ranking.
    score -= 1000;
  }

  const qualityMetrics = planSpec?.qualityMetrics || computePlanQualityMetrics(planSpec, brief);
  const qualityScore = scorePlanQualityMetrics(qualityMetrics, brief);
  score += qualityScore.delta;
  issues.push(...(Array.isArray(qualityScore?.issues) ? qualityScore.issues : []));
  warnings.push(...(Array.isArray(qualityScore?.warnings) ? qualityScore.warnings : []));

  const featureShortfalls = requestedFeatureShortfalls(planSpec, brief);
  for (const shortfall of featureShortfalls) {
    const perRoomPenalty = ['study', 'home_office', 'library'].includes(shortfall.featureType) ? 45 : 35;
    score -= perRoomPenalty * shortfall.missingCount;
    issues.push(
      `missing_requested_feature:${shortfall.featureType}:${shortfall.gotCount}/${shortfall.wantCount}`
    );
  }

  const { widthFt, heightFt, totalAreaSqFt } = footprint;
  const aspectRatio = widthFt > heightFt
    ? widthFt / heightFt
    : heightFt / widthFt;

  // ── 0. Home-size scale factor ─────────────────────────────────────────────
  // Homes < 1800 sqft physically face room-size pressure; scale thresholds
  // so constrained-but-valid plans aren't auto-penalised to zero.
  // sqrt formula: 600→0.55, 900→0.67, 1200→0.77, 1500→0.87, 1800→0.95, 2000+→1.0
  const sizeScaleFactor = totalAreaSqFt < 1800
    ? Math.sqrt(Math.max(0.35, totalAreaSqFt / 2000))
    : 1.0;

  // ── 1. Aspect ratio ──────────────────────────────────────────────────────
  // Score based on whether the footprint matches the user's intended shape.
  // frontFacing can also influence preferred AR: East/West-facing homes need
  // a WIDE footprint to present a broad street face; North/South prefer depth.
  // For very small homes (< 900 sqft) skip the shape penalty: the factor space
  // is too constrained to reliably hit a preferred AR without sacrificing room sizes.
  if (totalAreaSqFt > 900) {
    const shape = String(brief?.shape || 'RECTANGULAR').toUpperCase();
    const lot = String(brief?.lotContext || 'SUBURBAN').toUpperCase();
    const facing = String(brief?.frontFacing || '').toUpperCase();

    // Lot context can override shape expectation
    let effectiveShape =
      (lot === 'URBAN') ? 'DEEP' :
        (lot === 'WATERFRONT' || lot === 'VIEW') ? 'WIDE' :
          shape;

    // frontFacing orientation nudge: East/West-facing streets benefit from a wider
    // footprint (broad street face), so give a small bonus — but don't override the
    // user's declared shape preference, just add a tiebreaker.
    const facingWide = effectiveShape === 'RECTANGULAR' && (facing === 'EAST' || facing === 'WEST');

    // For smaller homes (900–1500 sqft) halve the penalties — factor space is limited.
    const shapePenaltyMult = totalAreaSqFt < 1500 ? 0.7 : 1.0;

    if (effectiveShape === 'WIDE') {
      if (aspectRatio >= 2.0 && aspectRatio <= 3.5) {
        score += 10;
      } else if (aspectRatio < 1.6) {
        score -= Math.round(45 * shapePenaltyMult);
        issues.push(`footprint_not_wide_enough_for_preference:${aspectRatio.toFixed(2)}`);
      }
    } else if (effectiveShape === 'DEEP') {
      if (aspectRatio >= 0.7 && aspectRatio <= 1.3) {
        score += 10;
      } else if (aspectRatio > 1.8) {
        score -= Math.round(45 * shapePenaltyMult);
        issues.push(`footprint_not_deep_enough_for_preference:${aspectRatio.toFixed(2)}`);
      }
    } else if (effectiveShape === 'SQUARE') {
      if (aspectRatio >= 0.9 && aspectRatio <= 1.1) {
        score += 10;
      } else if (aspectRatio > 1.5 || aspectRatio < 0.7) {
        score -= Math.round(40 * shapePenaltyMult);
        issues.push(`footprint_not_square_enough_for_preference:${aspectRatio.toFixed(2)}`);
      }
    } else {
      // RECTANGULAR — generic heuristic
      if (aspectRatio < 1.2) {
        score -= Math.round(28 * shapePenaltyMult);
        issues.push(`footprint_too_square:${aspectRatio.toFixed(2)}`);
      } else if (aspectRatio >= 1.4 && aspectRatio <= 2.5) {
        score += 10; // bonus for ideal rectangle
        // Extra tiebreaker: East/West street frontage benefits from a wider face
        if (facingWide && aspectRatio >= 1.8) score += 5;
      } else if (aspectRatio > 3.0) {
        score -= Math.round(28 * shapePenaltyMult);
        issues.push(`footprint_too_elongated:${aspectRatio.toFixed(2)}`);
      }
    }
  }

  // ── 2. Bathroom span check ───────────────────────────────────────────────
  // A bathroom should never span more than 60% of the house width.
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];

  // ── 2a. Stair landing access logic ───────────────────────────────────────
  // Penalize stairs that are accessible from non-hallway rooms or from multiple
  // interior doors on a level (typically indicates dead-end/invalid stair-side doors).
  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    const doors = Array.isArray(lvl?.doors) ? lvl.doors : [];
    const hallIds = new Set(
      rooms
        .filter((r) => normalizeRoomType(r.type || r.label || r.name) === 'hallway')
        .map((r) => String(r.id))
    );
    const stairRooms = rooms.filter(
      (r) => normalizeRoomType(r.type || r.label || r.name) === 'stairs'
    );

    for (const stair of stairRooms) {
      const stairId = String(stair.id);
      const landingSide = String(lvl?.stairCore?.landingSide || '').toLowerCase();
      const neighbors = [];

      for (const d of doors) {
        if (String(d?.b) === '__exterior__') continue;
        const a = String(d?.a || '');
        const b = String(d?.b || '');
        if (a === stairId) neighbors.push(b);
        else if (b === stairId) neighbors.push(a);
      }

      const uniqueNeighbors = [...new Set(neighbors)];
      const landingRoomId = String(lvl?.stairCore?.landingRoomId || lvl?.stairCore?.hallRoomId || '');
      const landingOpen = Boolean(lvl?.stairCore?.landingOpen);
      const allowedLandingIds = new Set(hallIds);
      if (landingOpen && landingRoomId) allowedLandingIds.add(landingRoomId);
      if (!uniqueNeighbors.length) {
        score -= 40;
        issues.push(`stairs_no_interior_access:L${lvl.level}:${stairId}`);
        continue;
      }

      if (allowedLandingIds.size > 0) {
        const nonHall = uniqueNeighbors.filter((id) => !allowedLandingIds.has(String(id)));
        if (nonHall.length) {
          score -= 35;
          issues.push(`stairs_non_hall_access:L${lvl.level}:${stairId}->${nonHall.join('|')}`);
        }
      }

      const landingHallId = landingRoomId;
      const hallwayOnlyMultiAccess =
        uniqueNeighbors.length > 1 &&
        uniqueNeighbors.length <= 3 &&
        uniqueNeighbors.every((id) => allowedLandingIds.has(String(id))) &&
        (!landingHallId || uniqueNeighbors.includes(landingHallId));

      if (uniqueNeighbors.length > 1 && !hallwayOnlyMultiAccess) {
        score -= 20;
        issues.push(`stairs_multiple_access_doors:L${lvl.level}:${stairId}:${uniqueNeighbors.length}`);
      }

      const shouldPreferNonSideLanding =
        Number(brief?.stories || 0) === 2 &&
        Number(brief?.primaryLevel || 1) === 2 &&
        Boolean(brief?.hasGarage) &&
        Number(lvl?.level || 1) > 1;
      if (shouldPreferNonSideLanding && (landingSide === 'left' || landingSide === 'right')) {
        score -= 14;
        issues.push(`stairs_side_landing:L${lvl.level}:${landingSide}`);
      }
    }
  }

  if (levels.length >= 2) {
    const stairCores = levels
      .map((lvl) => ({
        level: Number(lvl?.level || 0),
        protrusionFt: Number(lvl?.protrusionFt || 0),
        stair: lvl?.stairCore || null,
      }))
      .filter((item) => item.stair);

    if (stairCores.length >= 2) {
      const base = stairCores[0].stair;
      for (let i = 1; i < stairCores.length; i++) {
        const current = stairCores[i].stair;
        const dx = Math.abs((Number(current?.x) || 0) - (Number(base?.x) || 0));
        const rawDy = Math.abs((Number(current?.y) || 0) - (Number(base?.y) || 0));
        const expectedProtrusionOffset = Math.abs((Number(stairCores[0]?.protrusionFt) || 0) - (Number(stairCores[i]?.protrusionFt) || 0));
        const dy = Math.max(0, rawDy - expectedProtrusionOffset);
        const dw = Math.abs((Number(current?.w) || 0) - (Number(base?.w) || 0));
        const dh = Math.abs((Number(current?.h) || 0) - (Number(base?.h) || 0));
        const misaligned = dx > 0.5 || dy > 2 || dw > 0.5 || dh > 0.5;
        if (!misaligned) continue;

        const shaftPenalty =
          Math.round(dx * 1.5) +
          Math.round(Math.max(0, dy - 2) * 2.5) +
          Math.round(dw * 1.5) +
          Math.round(dh * 1.5);
        score -= 18 + shaftPenalty;
        issues.push(
          `stairs_misaligned_between_levels:L${stairCores[0].level}->L${stairCores[i].level}:dx=${dx}ft,dy=${dy}ft,dw=${dw}ft,dh=${dh}ft`
        );
      }
    }
  }

  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    const doors = Array.isArray(lvl?.doors) ? lvl.doors : [];
    const levelArea = Math.max(1, (Number(lvl?.width) || widthFt) * (Number(lvl?.height) || heightFt));
    const hallRooms = rooms.filter((r) => normalizeRoomType(r.type || r.label || r.name) === 'hallway');
    const levelMetric = Array.isArray(qualityMetrics?.levels)
      ? qualityMetrics.levels.find((metric) => Number(metric?.level || 1) === Number(lvl?.level || 1))
      : null;
    const hallArea = Number.isFinite(Number(levelMetric?.hall?.hallArea))
      ? Number(levelMetric.hall.hallArea)
      : hallRooms.reduce((sum, room) => sum + roomArea(room), 0);
    const hallRatio = Number.isFinite(Number(levelMetric?.hall?.hallRatio))
      ? Number(levelMetric.hall.hallRatio)
      : hallArea / levelArea;

    // Hard extra penalty for severely oversized hallways — these plans should not win
    if (hallRatio > 0.30) {
      score -= 28 + Math.round((hallRatio - 0.30) * 120);
      issues.push(`hallway_severe_bloat:L${lvl.level}:${hallRatio.toFixed(2)}`);
    }

    if (hallArea > 320) {
      const absolutePenalty = Math.round((hallArea - 320) / 10);
      score -= absolutePenalty;
      issues.push(`hallway_absolute_overage:L${lvl.level}:${hallArea}sqft`);
    }

    // Two-story plans have a structural landing corridor on level 2 that spans
    // the full width (~4ft tall). This is architecturally expected and should NOT
    // be penalized as a "full-width band" — only wider landings (> 6ft) are bad.
    const isTwoStoryLevel2 = levels.length === 2 && Number(lvl?.level || 0) === 2;
    const fullWidthBand = hallRooms.find((room) => {
      const dims = roomDims(room);
      const spansWidth = dims.width >= (Number(lvl?.width) || widthFt) * 0.80;
      const isStandardLanding = isTwoStoryLevel2 && dims.shortSide <= 6;
      return spansWidth && dims.shortSide <= 8 && !isStandardLanding;
    });
    if (fullWidthBand) {
      score -= 35;  // was 45
      issues.push(`hallway_full_width_band:L${lvl.level}:${fullWidthBand.id || fullWidthBand.label || 'hall'}`);
    }

    const entryBathDoor = doors.find((door) => {
      if (String(door?.b) === '__exterior__') return false;
      const a = rooms.find((room) => String(room.id) === String(door?.a || ''));
      const b = rooms.find((room) => String(room.id) === String(door?.b || ''));
      const pair = [normalizeRoomType(a?.type || ''), normalizeRoomType(b?.type || '')];
      return pair.includes('entry') && pair.some((type) => ['bathroom', 'primary_bathroom', 'powder_room'].includes(type));
    });
    if (entryBathDoor) {
      score -= 22;
      issues.push(`entry_bath_door:L${lvl.level}`);
    }
  }

  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    const lvlWidth = Number(lvl.width) || widthFt;

    for (const r of rooms) {
      const t = String(r.type || '').toLowerCase();
      if (!t.includes('bath') && !t.includes('powder')) continue;

      const dims = roomDims(r);
      const rW = dims.width;
      const rH = dims.height;
      const longSide = dims.longSide;
      const shortSide = dims.shortSide;

      // Bathroom spanning >60% of house width = bad design
      if (longSide > lvlWidth * 0.6) {
        score -= 30;
        issues.push(`bath_spans_full_width:L${lvl.level}:${r.label || t}:${rW}x${rH}ft`);
      }

      // Bathroom with extreme aspect ratio (>4:1) is basically a corridor
      if (shortSide > 0 && longSide / shortSide > 4) {
        score -= 28;
        issues.push(`bath_extreme_aspect:L${lvl.level}:${r.label || t}:${rW}x${rH}ft`);
      }

      // Bathroom too large (>180 sqft for a non-primary bath)
      const area = dims.area;
      if (area > 200 && !t.includes('primary')) {
        score -= 10;
        issues.push(`bath_oversized:L${lvl.level}:${r.label || t}:${area}sqft`);
      }
    }
  }

  // ── 3. Stairs orientation check ─────────────────────────────────────────
  // Stairs should run front-to-back (h > w) for typical residential layouts.
  // Left-to-right stairs (w >> h) have no logical entry/exit.
  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    for (const r of rooms) {
      const t = String(r.type || '').toLowerCase();
      if (!t.includes('stair')) continue;

      const dims = roomDims(r);
      const rW = dims.width;
      const rH = dims.height;

      // Stairs should be taller than they are wide (front-to-back flow)
      if (rW > 0 && rH > 0 && rW > rH * 1.5) {
        score -= 20;
        issues.push(`stairs_wrong_orientation:L${lvl.level}:${rW}x${rH}ft(w>h)`);
      }
    }
  }

  // ── 3b. Bar plan detection ───────────────────────────────────────────────
  // A "bar plan" is a single-story layout where public rooms (living/kitchen/dining)
  // are all arranged in a shallow side-by-side strip at the same Y position (depth < 18ft).
  // This creates a cramped, hotel-corridor aesthetic with no depth to the public zone.
  // Also catches plans where the primary bedroom dominates footprint width (>65%) and
  // public zone is still shallow.
  if (levels.length === 1) {
    const lvl0 = levels[0];
    const lvl0rooms = Array.isArray(lvl0?.rooms) ? lvl0.rooms : [];
    const publicRooms = lvl0rooms.filter((r) =>
      ['living_room', 'kitchen', 'dining_room'].includes(normalizeRoomType(r.type || ''))
    );

    if (publicRooms.length >= 2) {
      const depths = publicRooms.map((r) => roomDims(r).shortSide);
      const ys = [...new Set(publicRooms.map((r) => rectOf(r).y || 0))];
      const maxDepth = Math.max(...depths);

      // Check 1: all public rooms at same Y, all shallower than 18ft
      if (maxDepth < 9 && ys.length <= 1) {
        score -= 80;
        issues.push(`bar_plan_public_strip:maxDepth=${maxDepth * 2}ft`);
      } else {
        // Check 2: primary bedroom dominates footprint width (>65%) + public zone still shallow
        const primBed0 = lvl0rooms.find((r) => normalizeRoomType(r.type || '') === 'primary_bedroom');
        const lvl0W = Number(lvl0?.width) || widthFt;
        if (primBed0 && lvl0W > 0) {
          const bedDims = roomDims(primBed0);
          const bedLong = bedDims.longSide;
          const bedShort = bedDims.shortSide;
          const bedWidthRatio = bedLong / lvl0W;
          const bedAspect = bedShort > 0 ? bedLong / bedShort : 1;
          if (bedWidthRatio > 0.65 && bedAspect > 2.5 && maxDepth < 9) {
            score -= 80;
            issues.push(`bar_plan_bed_dominated:bedWidth=${(bedWidthRatio * 100).toFixed(0)}%`);
          }
        }
      }
    }
  }

  // ── 4. Primary bathroom adjacency ───────────────────────────────────────
  // Primary bathroom should share a wall with primary bedroom (not just hallway).
  // Approximate: they should be in the same column zone (similar x position).
  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    const primBed = rooms.find(r => String(r.type).toLowerCase() === 'primary_bedroom');
    const primBath = rooms.find(r => String(r.type).toLowerCase() === 'primary_bathroom');

    if (!primBed || !primBath) continue;
    const bedBounds = rectOf(primBed);
    const bathBounds = rectOf(primBath);

    // Check if primary bath shares a wall with primary bedroom (adjacent or overlapping).
    // "Adjacent" means xOverlap >= 0: the two rooms touch (share a wall) or overlap in x.
    // Only penalise when they are completely separated (xOverlap < 0, i.e., a gap exists).
    // The original >0 threshold was a false positive for the side-by-side private-zone layout
    // where bed fills the left column and bath fills the right column of the same private zone.
    const bedX1 = bedBounds.x, bedX2 = bedBounds.x2;
    const bathX1 = bathBounds.x, bathX2 = bathBounds.x2;

    const xOverlap = Math.min(bedX2, bathX2) - Math.max(bedX1, bathX1);
    // Accept touching (xOverlap == 0) as a shared wall; only penalise a real gap.
    const xSeparated = xOverlap < 0;

    // Additional check: they should also be in the same horizontal band, not floors apart.
    const bedY1 = bedBounds.y, bedY2 = bedBounds.y2;
    const bathY1 = bathBounds.y, bathY2 = bathBounds.y2;
    const yAdjacent = Math.abs(bedY2 - bathY1) <= 4 || Math.abs(bathY2 - bedY1) <= 4;
    const yOverlap = Math.min(bedY2, bathY2) - Math.max(bedY1, bathY1) > 0;

    if (xSeparated && !yAdjacent && !yOverlap) {
      // Bath is completely separated from bed in both x and y — clearly wrong zone
      score -= 25;
      issues.push(`primary_bath_not_adjacent_to_bed:L${lvl.level}:bed_x=${bedX1}-${bedX2},bath_x=${bathX1}-${bathX2}`);
    } else if (xSeparated) {
      // Bath is in a different x zone but at least y-adjacent (corridor plan) — small penalty
      score -= 10;
      issues.push(`primary_bath_x_separated_from_bed:L${lvl.level}:bed_x=${bedX1}-${bedX2},bath_x=${bathX1}-${bathX2}`);
    }
  }

  // ── 4b. Primary bedroom privacy ─────────────────────────────────────────
  // Primary bedroom must not share a wall with public rooms (living, kitchen, dining).
  // Direct adjacency without hallway mediation is a fundamental privacy violation.
  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    const primBed = rooms.find((r) => normalizeRoomType(r.type || '') === 'primary_bedroom');
    if (!primBed) continue;

    for (const pub of rooms) {
      const pt = normalizeRoomType(pub.type || '');
      if (!isPublicRoomType(pt)) continue;
      if (sharesWall(primBed, pub, 2)) {
        score -= 40;
        issues.push(`primary_bed_adjacent_to_public:L${lvl.level}:${pt}`);
        break; // one penalty per level is enough
      }
    }
  }

  // ── 5. Room proportions ─────────────────────────────────────────────────
  // No habitable room should be more extreme than 4:1
  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    for (const r of rooms) {
      const t = String(r.type || '').toLowerCase();
      // Skip structural/utility rooms that legitimately have odd proportions
      if (t === 'hallway' || t === 'stairs' || t === 'storage' ||
        t === 'garage' || t === 'entry' || t === 'laundry' || t === 'mudroom') continue;
      if (t.includes('bath') || t.includes('powder')) continue;

      const dims = roomDims(r);
      const rW = Math.max(1, dims.width);
      const rH = Math.max(1, dims.height);
      const ratio = Math.max(rW, rH) / Math.min(rW, rH);
      const maxRatio =
        t === 'primary_bedroom' && Number(brief?.stories || 1) === 1 && totalAreaSqFt >= 2200
          ? 4.75
          : 4;
      if (ratio > maxRatio) {
        score -= 8;
        issues.push(`room_extreme_ratio:L${lvl.level}:${r.label || t}:${rW}x${rH}ft(${ratio.toFixed(1)}:1)`);
      }
    }
  }

  // ── 6. Major room minimums ──────────────────────────────────────────────
  // Thresholds are scaled down for tiny homes where physical space is insufficient.
  // sizeScaleFactor < 1 for homes < 900 sqft prevents mass-penalisation of
  // plans that are simply constrained by the lot — not by bad layout choices.
  const BASE_MIN_SIZES = {
    living_room: { area: 120, short: 10 },
    kitchen: { area: 80, short: 8 },
    primary_bedroom: { area: 140, short: 10 },
    bedroom: { area: 90, short: 9 },
    primary_bathroom: { area: 35, short: 5 },
    bathroom: { area: 35, short: 5 },
    dining_room: { area: 70, short: 7 },
  };

  const minSizes = Object.fromEntries(
    Object.entries(BASE_MIN_SIZES).map(([k, v]) => [k, {
      area: Math.round(v.area * sizeScaleFactor),
      short: Math.round(v.short * sizeScaleFactor),
    }])
  );

  let undersizedPenaltyAccum = 0;
  const UNDERSIZED_PENALTY_PER_ROOM = 8;  // reduced from 12
  const UNDERSIZED_PENALTY_CAP = 40;       // cap prevents cascade to 0

  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    for (const r of rooms) {
      const t = String(r.type || '').toLowerCase();
      const mins = minSizes[t];
      if (!mins) continue;

      const dims = roomDims(r);
      const area = dims.area;
      const short = dims.shortSide;

      // Threshold softened from 0.7 to 0.65 — 65% of minimum is clearly bad;
      // 65-70% is borderline and should not be penalised as harshly.
      if (area < mins.area * 0.65 || short < mins.short * 0.65) {
        const roomPenalty = Math.min(UNDERSIZED_PENALTY_PER_ROOM, UNDERSIZED_PENALTY_CAP - undersizedPenaltyAccum);
        if (roomPenalty > 0) {
          score -= roomPenalty;
          undersizedPenaltyAccum += roomPenalty;
        }
        issues.push(`room_undersized:L${lvl.level}:${r.label || t}:${r.w}x${r.h}=${area}sqft`);
      }
    }
  }

  // ── 7. Trapped Room Penalty ───────────────────────────────────────────────
  // Bedrooms must physically touch a circulation room or a public room.
  // If a bedroom only touches other private rooms (e.g. ensuites or other beds/closets),
  // it is "trapped" and will inevitably lead to a connectivity error later.
  const PUBLIC_OR_CIRC_TYPES = new Set([
    'hallway', 'stairs', 'entry', 'entry_foyer', 'public_hall_or_gallery', 'mudroom', 'laundry', 'storage',
    'living_room', 'kitchen', 'dining_room', 'study', 'office',
    'game_room', 'media_room', 'bonus_loft', 'flex_room', 'garage', 'mudroom_dropzone' // Allow garage/mudroom as valid paths out
  ]);

  const FEATURE_ROOM_TYPE_SET = new Set(['study', 'gym', 'movie_room', 'gaming_room', 'library', 'music_room', 'wine_cellar']);

  for (const lvl of levels) {
    const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
    const hasInteriorDoors = Array.isArray(lvl?.doors) && lvl.doors.some((d) => String(d?.b || '') !== '__exterior__');
    for (const r of rooms) {
      const t = normalizeRoomType(r.type || '');
      const isBedroom = t === 'bedroom' || t === 'primary_bedroom' || t === 'guest_suite';
      const isFeatureRoom = FEATURE_ROOM_TYPE_SET.has(t);
      if (!isBedroom && !isFeatureRoom) continue;

      let touchesEscapeRoute = false;

      if (hasInteriorDoors) {
        touchesEscapeRoute = hasEscapePathViaDoors(r.id, lvl, PUBLIC_OR_CIRC_TYPES, brief);
      } else {
        for (const other of rooms) {
          if (r.id === other.id) continue;
          if (sharesWall(r, other, 2)) {
            const ot = normalizeRoomType(other.type || '');
            if (PUBLIC_OR_CIRC_TYPES.has(ot)) {
              touchesEscapeRoute = true;
              break;
            }
          }
        }
      }

      if (!touchesEscapeRoute) {
        // Bedrooms being isolated is a hard fault; feature rooms isolated is a significant issue
        const penalty = isBedroom ? 25 : 10;
        score -= penalty;
        issues.push(`trapped_room:L${lvl.level}:${r.label || t}(${r.id})`);
      }
    }
  }

  // ── 8. Natural light zone scoring ────────────────────────────────────────────
  // Reward plans where living/dining/kitchen rooms touch exterior walls so they
  // can receive windows and natural light. Penalize fully-interior public rooms.
  // For MAXIMUM light preference: larger exterior exposure earns a bigger bonus.
  // For MINIMAL (privacy-focused): public rooms on the front entry wall get a
  // small penalty — better to face the private garden than the street.
  // Note: applyFacingTransform in generateTilePlan already mirrors room coordinates
  // for compass orientation, so "touches exterior" is always meaningful post-transform.
  {
    const naturalLight = String(brief?.naturalLight || 'BALANCED').toUpperCase();
    const maxLight = naturalLight === 'MAXIMUM';
    const privacyFirst = naturalLight === 'MINIMAL';

    if (maxLight || privacyFirst) {
      const publicTypes = new Set(['living_room', 'dining_room', 'kitchen']);

      for (const lvl of levels) {
        const rooms = Array.isArray(lvl?.rooms) ? lvl.rooms : [];
        const lvlW = Number(lvl.width) || widthFt;
        const lvlH = Number(lvl.height) || heightFt;

        for (const r of rooms) {
          const t = normalizeRoomType(r.type || '');
          if (!publicTypes.has(t)) continue;

          const R = rectOf(r);
          const onLeft   = R.x === 0;
          const onRight  = R.x2 === lvlW;
          const onTop    = R.y === 0;
          const onBottom = R.y2 === lvlH;
          const onExterior = onLeft || onRight || onTop || onBottom;

          if (maxLight) {
            if (!onExterior) {
              // Interior public room — no exterior glazing possible
              score -= 12;
              issues.push(`public_room_no_exterior_wall:L${lvl.level}:${t}`);
            } else {
              // Bonus scales with number of exterior walls (corner = 2 walls = more light)
              const wallCount = [onLeft, onRight, onTop, onBottom].filter(Boolean).length;
              score += wallCount * 3;
            }
          }

          if (privacyFirst && onTop) {
            // Public room at y=0 (entry/street side) — slight privacy penalty
            score -= 3;
            issues.push(`public_room_street_facing:L${lvl.level}:${t}`);
          }
        }
      }
    }
  }

  // ── 9. Total rooms sanity ───────────────────────────────────────────────
  const allRooms = levels.flatMap(l => Array.isArray(l.rooms) ? l.rooms : []);
  if (allRooms.length < 4) {
    score -= 20;
    issues.push(`too_few_rooms:${allRooms.length}`);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    issues,
    warnings,
    qualityMetrics,
    strictConnectivityFeasibility,
  };
}

module.exports = { scoreCandidate, assessStrictConnectivityFeasibility };
