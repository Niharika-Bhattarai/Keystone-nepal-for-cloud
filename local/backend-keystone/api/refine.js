'use strict';

const { sanitizePlanInput } = require('../lib/sanitizePlanInput');
const { GoogleGenAI } = require('@google/genai');
const { renderPlanSvg } = require('../lib/renderPlanSvg');
const { renderElevations } = require('../lib/renderElevationSvg');
const { enrichPlanSpec } = require('../lib/buildingModel');
const { placeOpenings } = require('../lib/placeOpenings');
const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { buildEstimate } = require('../lib/estimate/buildEstimate');
const { addPlan } = require('../lib/gallery');
const { validateConnectivity } = require('../lib/validateConnectivity');
const { validateEditedPlan } = require('../lib/validateEditedPlan');
const { resizeCandidates } = require('../lib/refinementResize');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function summarizePlan(planSpec) {
  const lines = [];
  lines.push(`Total: ${planSpec.totalAreaSqFt} sqft, ${planSpec.stories} stor${planSpec.stories > 1 ? 'ies' : 'y'}`);

  for (const level of planSpec.levels || []) {
    lines.push(`\nLevel ${level.level} (${level.width}ft x ${level.height}ft):`);
    for (const room of level.rooms || []) {
      lines.push(`  - ${room.label || room.type} [id:${room.id} type:${room.type}]: x=${room.x} y=${room.y} w=${room.w} h=${room.h} -> ${room.w * room.h} sqft`);
    }
  }

  return lines.join('\n');
}

function protectedRoomIds(planSpec) {
  return new Set([
    ...(planSpec?.buildingModel?.protectedRoomIds || []),
    ...((planSpec?.stairCore || []).map((item) => item?.roomId).filter(Boolean)),
  ]);
}

function editableRoomIds(planSpec) {
  const protectedIds = protectedRoomIds(planSpec);
  const ids = [];
  for (const level of planSpec?.levels || []) {
    for (const room of level.rooms || []) {
      if (protectedIds.has(String(room.id)) || room.protected) continue;
      ids.push(String(room.id));
    }
  }
  return ids;
}

function summarizeEditableRooms(planSpec) {
  return (planSpec?.levels || []).map((level) => {
    const rooms = (level.rooms || [])
      .filter((room) => !protectedRoomIds(planSpec).has(String(room.id)) && !room.protected)
      .map((room) => `${room.id}:${room.type}:${room.zone || 'unassigned'}`);
    return `Level ${level.level} editable rooms: ${rooms.join(', ') || 'none'}`;
  }).join('\n');
}

function buildRefinePrompt(planSpec, instruction) {
  const planSummary = summarizePlan(planSpec);
  const protectedIds = [...protectedRoomIds(planSpec)];
  const editableSummary = summarizeEditableRooms(planSpec);
  const protectedText = protectedIds.length
    ? `Protected structural room ids that must not move or resize: ${protectedIds.join(', ')}.`
    : 'Protected structural rooms must not move or resize: stairs, hallway, and entry/circulation core.';

  return `You are an expert architect's assistant specializing in spatial layout and floor plan optimization. A client wants to modify their floor plan.

CURRENT FLOOR PLAN:
${planSummary}

CLIENT INSTRUCTION: "${instruction}"

RULES:
- SPATIAL AWARENESS: When moving or resizing, consider the room's neighbors. If you move a room, you must fill the gap it leaves and adjust the rooms it moves into.
- CONNECTIVITY: Ensure every room still touches a hallway or a public room (living, kitchen, dining) after your changes.
- PROPORTIONS: Avoid making rooms too long and narrow. Keep aspect ratios below 3:1.

- Each room has: id, label, type, x (left edge in feet), y (top edge in feet), w (width in feet), h (height in feet)
- Rooms must stay within the level footprint
- When you resize a room, you must also adjust adjacent rooms so there are no gaps or overlaps
- Never move or resize stairs, hallway/core circulation, or protected structural rooms
- Minimum room sizes:
  - bedroom / guest bedroom / primary bedroom: 10x10
  - bathroom / primary bathroom: 5x8
  - powder room: 4x6
  - kitchen: 10x10
  - living room: 12x12
  - dining room: 8x10
  - hallway: 4x6
- Changes must be in 2-foot increments (grid-snapped)
- Prefer minimal changes that satisfy the request
- Do not create overlaps or isolated rooms
- Prefer local room resizing or swapping over broad structural reshaping
- Keep edits to one nearby cluster of rooms on a single level whenever possible
- Touch at most 4 editable rooms total
- Only output a JSON array of changes with no explanation or markdown

${protectedText}
Editable room inventory:
${editableSummary}

OUTPUT FORMAT - a JSON array where each element is one of:
{ "action": "resize", "id": "room-id", "w": newWidth, "h": newHeight }
{ "action": "move",   "id": "room-id", "x": newX, "y": newY }
{ "action": "resize_and_move", "id": "room-id", "w": newWidth, "h": newHeight, "x": newX, "y": newY }

IMPORTANT:
- Output ONLY the raw JSON array.
- No explanation.
- No markdown.
- No backticks.
- Start with [ and end with ].`;
}

function applyDiff(planSpec, changes) {
  const updated = JSON.parse(JSON.stringify(planSpec));
  const protectedIds = protectedRoomIds(planSpec);
  const snap = value => planSpec.generatorId === 'architect_v2' ? value : snapToGrid(value);

  for (const change of changes) {
    let found = false;

    for (const level of updated.levels || []) {
      const room = (level.rooms || []).find((r) => r.id === change.id);
      if (!room) continue;

      found = true;
      if (protectedIds.has(String(room.id)) || room.protected) continue;
      const previousX = room.x, previousY = room.y;
      // Composite rooms cannot be resized as bounding rectangles. Translations
      // must also translate their actual parts, which renderers/validators use.
      if (room.parts?.length && change.action !== 'move') continue;

      if (change.action === 'resize' || change.action === 'resize_and_move') {
        if (typeof change.w === 'number' && change.w >= 4) room.w = snap(change.w);
        if (typeof change.h === 'number' && change.h >= 4) room.h = snap(change.h);
      }

      if (change.action === 'move' || change.action === 'resize_and_move') {
        if (typeof change.x === 'number') room.x = snap(change.x);
        if (typeof change.y === 'number') room.y = snap(change.y);
      }
      if (room.parts?.length) room.parts = room.parts.map(part => ({ ...part,
        x: part.x + room.x - previousX, y: part.y + room.y - previousY }));
    }

    if (!found) {
      console.log(`[refine] warning: room id "${change.id}" not found`);
    }
  }

  // totalAreaSqFt is the requested area, not a sum of bounding boxes (which
  // double-count composite rooms and include unconditioned outdoor space).
  return updated;
}

function snapToGrid(value) {
  return Math.round(value / 2) * 2;
}

function roomContextById(planSpec) {
  const map = new Map();
  for (const level of planSpec?.levels || []) {
    for (const room of level.rooms || []) {
      map.set(String(room.id), { room, level });
    }
  }
  return map;
}

function deriveChangeAction(before, after) {
  const moved = before.x !== after.x || before.y !== after.y;
  const resized = before.w !== after.w || before.h !== after.h;
  if (moved && resized) return 'resize_and_move';
  if (moved) return 'move';
  if (resized) return 'resize';
  return null;
}

function sanitizeChangesDetailed(planSpec, changes) {
  const snap = value => planSpec.generatorId === 'architect_v2' ? value : snapToGrid(value);
  const allowedIds = new Set(editableRoomIds(planSpec));
  const roomMap = roomContextById(planSpec);
  const pendingById = new Map();
  const rejectedChanges = [];

  for (const [index, change] of (Array.isArray(changes) ? changes : []).entries()) {
    if (!change || typeof change !== 'object') {
      rejectedChanges.push({ index, reason: 'invalid_change_object' });
      continue;
    }

    const id = String(change.id || '');
    const action = String(change.action || '');
    if (!id || !roomMap.has(id)) {
      rejectedChanges.push({ index, id, reason: 'unknown_room_id' });
      continue;
    }
    if (!allowedIds.has(id)) {
      rejectedChanges.push({ index, id, reason: 'protected_or_uneditable_room' });
      continue;
    }
    if (!['resize', 'move', 'resize_and_move'].includes(action)) {
      rejectedChanges.push({ index, id, reason: 'invalid_action' });
      continue;
    }

    const { room, level } = roomMap.get(id);
    if (room.parts?.length && action !== 'move') {
      rejectedChanges.push({ index, id, reason: 'composite_room_requires_boundary_edit' });
      continue;
    }
    const state = pendingById.get(id) || {
      x: room.x,
      y: room.y,
      w: room.w,
      h: room.h,
    };
    const nextState = { ...state };
    let touchedMove = false;
    let touchedSize = false;

    if (action === 'resize' || action === 'resize_and_move') {
      if (isFiniteNumber(change.w)) {
        nextState.w = Math.max(4, snap(change.w));
        touchedSize = true;
      }
      if (isFiniteNumber(change.h)) {
        nextState.h = Math.max(4, snap(change.h));
        touchedSize = true;
      }
    }
    if (action === 'move' || action === 'resize_and_move') {
      if (isFiniteNumber(change.x)) {
        nextState.x = snap(change.x);
        touchedMove = true;
      }
      if (isFiniteNumber(change.y)) {
        nextState.y = snap(change.y);
        touchedMove = true;
      }
    }

    if (action === 'resize_and_move' && (!touchedMove || !touchedSize)) {
      rejectedChanges.push({ index, id, reason: 'underspecified_resize_and_move' });
      continue;
    }
    if (!touchedMove && !touchedSize) {
      rejectedChanges.push({ index, id, reason: 'missing_numeric_fields' });
      continue;
    }

    if (!withinLevel({ ...room, ...nextState }, level)) {
      rejectedChanges.push({ index, id, reason: 'out_of_bounds_request' });
      continue;
    }

    const nextAction = deriveChangeAction(room, nextState);
    if (!nextAction) {
      rejectedChanges.push({ index, id, reason: 'no_op_change' });
      continue;
    }

    if (!pendingById.has(id) && pendingById.size >= 4) {
      rejectedChanges.push({ index, id, reason: 'room_limit_exceeded' });
      continue;
    }

    pendingById.set(id, nextState);
  }

  const sanitized = [];
  for (const [id, nextState] of pendingById.entries()) {
    const { room } = roomMap.get(id);
    const action = deriveChangeAction(room, nextState);
    if (!action) continue;
    const change = { action, id };
    if (action === 'resize' || action === 'resize_and_move') {
      change.w = nextState.w;
      change.h = nextState.h;
    }
    if (action === 'move' || action === 'resize_and_move') {
      change.x = nextState.x;
      change.y = nextState.y;
    }
    sanitized.push(change);
  }

  return {
    changes: sanitized,
    rejectedChanges,
  };
}

function sanitizeChanges(planSpec, changes) {
  return sanitizeChangesDetailed(planSpec, changes).changes;
}

function parseGeminiDiff(text) {
  let clean = String(text || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error('No JSON array found in Gemini response');
  }

  return JSON.parse(clean.slice(start, end + 1));
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function roomMinSizeByType(type) {
  switch (String(type || '').toLowerCase()) {
    case 'primary_bedroom':
    case 'bedroom':
    case 'guest_bedroom':
      return { minW: 10, minH: 10, maxRatio: 4 };
    case 'primary_bathroom':
    case 'bathroom':
      return { minW: 5, minH: 8, maxRatio: 5 };
    case 'powder_room':
      return { minW: 4, minH: 6, maxRatio: 5 };
    case 'kitchen':
      return { minW: 10, minH: 10, maxRatio: 4 };
    case 'living_room':
      return { minW: 12, minH: 12, maxRatio: 4 };
    case 'dining_room':
      return { minW: 8, minH: 10, maxRatio: 4 };
    case 'hallway':
      return { minW: 4, minH: 6, maxRatio: 10 };
    case 'laundry':
    case 'mudroom':
    case 'entry':
      return { minW: 4, minH: 6, maxRatio: 6 };
    case 'garage':
      return { minW: 10, minH: 10, maxRatio: 10 };
    case 'stairs':
      return { minW: 4, minH: 8, maxRatio: 4 };
    default:
      return { minW: 4, minH: 4, maxRatio: 5 };
  }
}

function rectsOverlap(a, b) {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function withinLevel(room, level) {
  return (
    room.x >= 0 &&
    room.y >= 0 &&
    room.w > 0 &&
    room.h > 0 &&
    room.x + room.w <= level.width &&
    room.y + room.h <= level.height
  );
}

function roomArea(room) {
  return Math.max(0, room.w || 0) * Math.max(0, room.h || 0);
}

function maxSideRatio(room) {
  const shortSide = Math.max(1, Math.min(room.w || 0, room.h || 0));
  const longSide = Math.max(room.w || 0, room.h || 0);
  return longSide / shortSide;
}

function bathSpansTooMuch(room, level) {
  const t = String(room.type || '').toLowerCase();
  if (!(t === 'bathroom' || t === 'primary_bathroom' || t === 'powder_room')) return false;
  return room.w > (level.width * 0.60);
}

function rangesOverlap(startA, endA, startB, endB) {
  return Math.min(endA, endB) > Math.max(startA, startB);
}

// ── Deterministic exact-dimension instruction parser ──────────────────────────
// Matches: "resize kitchen to 12x14", "change the kitchen to 12ft × 14ft",
//          "make kitchen 12 by 14", "kitchen: 12x14", etc.
const EXACT_RESIZE_PATTERNS = [
  /(?:change|resize|set|update)\s+(?:the\s+)?(.+?)\s+(?:from\s+[\d.]+\s*(?:ft|feet)?\s*(?:x|×|by)\s*[\d.]+\s*(?:ft|feet)?\s+)?to\s+([\d.]+)\s*(?:ft|feet|foot)?\s*(?:x|×|by)\s*([\d.]+)\s*(?:ft|feet|foot)?/i,
  /make\s+(?:the\s+)?(.+?)\s+([\d.]+)\s*(?:ft|feet|foot)?\s*(?:wide\s+)?(?:x|×|by)\s*([\d.]+)\s*(?:ft|feet|foot)?/i,
  /(.+?)\s+should\s+be\s+([\d.]+)\s*(?:ft|feet|foot)?\s*(?:x|×|by)\s*([\d.]+)\s*(?:ft|feet|foot)?/i,
  /(.+?)\s*:\s*([\d.]+)\s*[x×]\s*([\d.]+)/i,
];

function parseExactInstruction(instruction, planSpec) {
  const text = String(instruction || '').trim();
  for (const pattern of EXACT_RESIZE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const [, roomQuery, wStr, hStr] = match;
    const newW = parseFloat(wStr);
    const newH = parseFloat(hStr);
    if (!Number.isFinite(newW) || !Number.isFinite(newH)) continue;
    if (newW < 4 || newH < 4 || newW > 200 || newH > 200) continue;
    const query = String(roomQuery || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (query.length < 2) continue;
    for (const level of planSpec?.levels || []) {
      for (const room of level.rooms || []) {
        const label = String(room.label || '').toLowerCase();
        const type = String(room.type || '').replace(/_/g, ' ').toLowerCase();
        if ((label && (label === query || label.includes(query))) || (type && (type === query || type.includes(query)))) {
          return { room, level, newW, newH };
        }
      }
    }
  }
  return null;
}

function computeExactResizeChanges(planSpec, targetRoom, targetLevel, newW, newH) {
  const changes = [];
  const prevW = targetRoom.w || 0;
  const prevH = targetRoom.h || 0;
  changes.push({ action: 'resize_and_move', id: targetRoom.id, x: targetRoom.x, y: targetRoom.y, w: newW, h: newH });

  const peers = (targetLevel.rooms || []).filter((r) => r.id !== targetRoom.id);
  const prevRight = targetRoom.x + prevW;
  const newRight = targetRoom.x + newW;
  const prevBottom = targetRoom.y + prevH;
  const newBottom = targetRoom.y + newH;

  // Width changed: adjust first room touching the right edge in the Y band
  if (newRight !== prevRight) {
    const delta = newRight - prevRight;
    for (const r of peers) {
      if (r.x !== prevRight) continue;
      if (!rangesOverlap(targetRoom.y, targetRoom.y + Math.max(prevH, newH), r.y, r.y + r.h)) continue;
      if (delta > 0) {
        const minW = roomMinSizeByType(r.type).minW || 4;
        const candidateW = r.w - delta;
        if (candidateW >= minW) {
          changes.push({ action: 'resize_and_move', id: r.id, x: r.x + delta, y: r.y, w: candidateW, h: r.h });
        }
      } else {
        // Room shrank — expand neighbor leftward to fill gap
        changes.push({ action: 'resize_and_move', id: r.id, x: r.x + delta, y: r.y, w: r.w - delta, h: r.h });
      }
      break; // only adjust the first touching neighbor
    }
  }

  // Height changed: adjust first room touching the bottom edge in the X band
  if (newBottom !== prevBottom) {
    const delta = newBottom - prevBottom;
    for (const r of peers) {
      if (r.y !== prevBottom) continue;
      if (!rangesOverlap(targetRoom.x, targetRoom.x + Math.max(prevW, newW), r.x, r.x + r.w)) continue;
      if (delta > 0) {
        const minH = roomMinSizeByType(r.type).minH || 4;
        const candidateH = r.h - delta;
        if (candidateH >= minH) {
          changes.push({ action: 'resize_and_move', id: r.id, x: r.x, y: r.y + delta, w: r.w, h: candidateH });
        }
      } else {
        // Room shrank — expand neighbor upward to fill gap
        changes.push({ action: 'resize_and_move', id: r.id, x: r.x, y: r.y + delta, w: r.w, h: r.h - delta });
      }
      break;
    }
  }

  return changes;
}

function shareBoundary(a, b) {
  const verticalTouch =
    (a.x + a.w === b.x || b.x + b.w === a.x) &&
    rangesOverlap(a.y, a.y + a.h, b.y, b.y + b.h);
  const horizontalTouch =
    (a.y + a.h === b.y || b.y + b.h === a.y) &&
    rangesOverlap(a.x, a.x + a.w, b.x, b.x + b.w);
  return verticalTouch || horizontalTouch;
}

function addGraphEdge(graph, a, b) {
  if (!a || !b) return;
  if (!graph.has(a)) graph.set(a, new Set());
  if (!graph.has(b)) graph.set(b, new Set());
  graph.get(a).add(b);
  graph.get(b).add(a);
}

function buildLevelAdjacency(level) {
  const graph = new Map();
  const rooms = level?.rooms || [];
  for (const room of rooms) graph.set(String(room.id), new Set());

  for (const door of level?.doors || []) {
    if (!door || door.a === '__exterior__' || door.b === '__exterior__') continue;
    addGraphEdge(graph, String(door.a), String(door.b));
  }

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (shareBoundary(rooms[i], rooms[j])) {
        addGraphEdge(graph, String(rooms[i].id), String(rooms[j].id));
      }
    }
  }

  return graph;
}

function shortestGraphDistance(graph, start, goal) {
  if (start === goal) return 0;
  const queue = [{ id: start, distance: 0 }];
  const visited = new Set([start]);

  while (queue.length) {
    const current = queue.shift();
    const neighbors = graph.get(current.id) || [];
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      const nextDistance = current.distance + 1;
      if (neighbor === goal) return nextDistance;
      visited.add(neighbor);
      queue.push({ id: neighbor, distance: nextDistance });
    }
  }

  return Number.POSITIVE_INFINITY;
}

function basicSchemaIssues(planSpec) {
  const issues = [];

  if (!planSpec || typeof planSpec !== 'object') {
    issues.push('planSpec_missing');
    return issues;
  }

  if (!Array.isArray(planSpec.levels) || !planSpec.levels.length) {
    issues.push('levels_missing');
    return issues;
  }

  for (const level of planSpec.levels) {
    if (!isFiniteNumber(level.width) || !isFiniteNumber(level.height) || level.width <= 0 || level.height <= 0) {
      issues.push(`invalid_level_dimensions_l${level.level}`);
    }

    if (!Array.isArray(level.rooms)) {
      issues.push(`missing_rooms_l${level.level}`);
      continue;
    }

    for (const room of level.rooms) {
      if (!room?.id) issues.push(`room_missing_id_l${level.level}`);
      if (!room?.type) issues.push(`room_missing_type_${room?.id || 'unknown'}`);
      if (!isFiniteNumber(room?.x) || !isFiniteNumber(room?.y) || !isFiniteNumber(room?.w) || !isFiniteNumber(room?.h)) {
        issues.push(`room_invalid_geometry_${room?.id || 'unknown'}`);
      }
    }
  }

  return issues;
}

function geometricIssues(planSpec) {
  const issues = [];

  for (const level of planSpec.levels || []) {
    for (const room of level.rooms || []) {
      if (!withinLevel(room, level)) issues.push(`out_of_bounds_${room.id}`);

      const rules = roomMinSizeByType(room.type);
      const shortSide = Math.min(room.w || 0, room.h || 0);
      const longSide = Math.max(room.w || 0, room.h || 0);

      if (shortSide < Math.min(rules.minW, rules.minH) && String(room.type) !== 'hallway') {
        issues.push(`undersized_short_side_${room.id}`);
      }

      if ((room.w || 0) < rules.minW && (room.h || 0) < rules.minH && String(room.type) !== 'hallway') {
        issues.push(`undersized_room_${room.id}`);
      }

      if (maxSideRatio(room) > rules.maxRatio) issues.push(`bad_aspect_ratio_${room.id}`);
      if (bathSpansTooMuch(room, level)) issues.push(`bath_too_wide_${room.id}`);
      if ((room.w || 0) % 2 !== 0 || (room.h || 0) % 2 !== 0 || (room.x || 0) % 2 !== 0 || (room.y || 0) % 2 !== 0) {
        issues.push(`off_grid_${room.id}`);
      }
      if (roomArea(room) <= 0) issues.push(`zero_area_${room.id}`);
      if (longSide <= 0) issues.push(`invalid_size_${room.id}`);
    }

    const rooms = level.rooms || [];
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        if (rectsOverlap(rooms[i], rooms[j])) issues.push(`overlap_${rooms[i].id}_${rooms[j].id}`);
      }
    }

    const levelArea = (level.width || 0) * (level.height || 0);
    const roomsArea = rooms.reduce((sum, room) => sum + roomArea(room), 0);

    if (roomsArea > levelArea) issues.push(`level_overfilled_l${level.level}`);
    else if (levelArea - roomsArea > Math.max(16, levelArea * 0.15)) issues.push(`large_gap_area_l${level.level}`);
  }

  return issues;
}

function estimatePlanQuality(planSpec) {
  const schema = basicSchemaIssues(planSpec);
  const geometry = geometricIssues(planSpec);
  const issues = [...schema, ...geometry];

  let score = 100;
  for (const issue of issues) {
    if (issue.startsWith('overlap_')) score -= 20;
    else if (issue.startsWith('out_of_bounds_')) score -= 20;
    else if (issue.startsWith('undersized_room_')) score -= 12;
    else if (issue.startsWith('undersized_short_side_')) score -= 10;
    else if (issue.startsWith('bad_aspect_ratio_')) score -= 8;
    else if (issue.startsWith('bath_too_wide_')) score -= 10;
    else if (issue.startsWith('off_grid_')) score -= 5;
    else if (issue.startsWith('large_gap_area_')) score -= 6;
    else if (issue.startsWith('level_overfilled_')) score -= 15;
    else score -= 4;
  }

  return {
    issues,
    score,
    valid: issues.length === 0,
  };
}

function collectProtectedIssues(beforePlan, afterPlan) {
  const issues = [];
  const protectedIds = protectedRoomIds(beforePlan);
  const beforeRooms = new Map();

  for (const level of beforePlan?.levels || []) {
    for (const room of level.rooms || []) {
      if (protectedIds.has(String(room.id)) || room.protected) {
        beforeRooms.set(String(room.id), { x: room.x, y: room.y, w: room.w, h: room.h });
      }
    }
  }

  for (const level of afterPlan?.levels || []) {
    for (const room of level.rooms || []) {
      const before = beforeRooms.get(String(room.id));
      if (!before) continue;
      if (before.x !== room.x || before.y !== room.y || before.w !== room.w || before.h !== room.h) {
        issues.push(`protected_room_changed_${room.id}`);
      }
    }
  }

  const beforeStairs = (beforePlan?.stairCore || []).map((item) => `${item.level}:${item.x}:${item.w}`).join('|');
  const afterStairs = (afterPlan?.stairCore || []).map((item) => `${item.level}:${item.x}:${item.w}`).join('|');
  if (beforeStairs && afterStairs && beforeStairs !== afterStairs) issues.push('stair_core_changed');

  return issues;
}

function collectRefinementScopeIssues(beforePlan, changes, afterPlan) {
  const issues = [];
  const changedIds = [...new Set((changes || []).map((change) => String(change.id || '')).filter(Boolean))];
  if (changedIds.length > 6) issues.push('too_many_rooms_changed');

  const beforeById = new Map();
  const beforeLevels = new Map();
  for (const level of beforePlan?.levels || []) {
    beforeLevels.set(level.level, level);
    for (const room of level.rooms || []) {
      beforeById.set(String(room.id), { level: level.level, zone: room.zone || 'unassigned', room });
    }
  }

  const touchedLevels = new Set();
  const touchedZones = new Set();
  let largeShiftCount = 0;
  for (const level of afterPlan?.levels || []) {
    for (const room of level.rooms || []) {
      const before = beforeById.get(String(room.id));
      if (!before || !changedIds.includes(String(room.id))) continue;
      touchedLevels.add(before.level);
      touchedZones.add(before.zone || 'unassigned');
      const moveDelta = Math.abs((room.x || 0) - (before.room.x || 0)) + Math.abs((room.y || 0) - (before.room.y || 0));
      const sizeDelta = Math.abs((room.w || 0) - (before.room.w || 0)) + Math.abs((room.h || 0) - (before.room.h || 0));
      if (moveDelta + sizeDelta > 12) largeShiftCount += 1;
    }
  }

  if (touchedLevels.size > 1) issues.push('cross_level_refinement');
  if (touchedZones.size > 2) issues.push('cross_zone_refinement');
  if (largeShiftCount > 4) issues.push('refinement_too_broad');

  if (touchedLevels.size === 1 && changedIds.length > 1) {
    const targetLevel = [...touchedLevels][0];
    const level = beforeLevels.get(targetLevel);
    const graph = buildLevelAdjacency(level);
    let maxDistance = 0;

    for (let i = 0; i < changedIds.length; i++) {
      for (let j = i + 1; j < changedIds.length; j++) {
        const distance = shortestGraphDistance(graph, changedIds[i], changedIds[j]);
        if (!Number.isFinite(distance)) {
          issues.push('disconnected_refinement_cluster');
          break;
        }
        maxDistance = Math.max(maxDistance, distance);
      }
      if (issues.includes('disconnected_refinement_cluster')) break;
    }

    if (!issues.includes('disconnected_refinement_cluster') && maxDistance > 3) {
      issues.push('scattered_refinement_cluster');
    }

    const changedRooms = changedIds
      .map((id) => beforeById.get(id)?.room)
      .filter(Boolean);
    if (level && changedRooms.length >= 3) {
      const minX = Math.min(...changedRooms.map((room) => room.x));
      const minY = Math.min(...changedRooms.map((room) => room.y));
      const maxX = Math.max(...changedRooms.map((room) => room.x + room.w));
      const maxY = Math.max(...changedRooms.map((room) => room.y + room.h));
      const bboxArea = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
      const levelArea = Math.max(1, (level.width || 0) * (level.height || 0));
      if (bboxArea > levelArea * 0.80) issues.push('refinement_coverage_too_wide');
    }
  }

  return issues;
}

async function refineHandler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);

    const { refinementInstruction } = body;
    const currentPlanSpec = sanitizePlanInput(body.currentPlanSpec);
    const surveyData = currentPlanSpec?.designSurvey || body.surveyData || {};
    if (!currentPlanSpec || !refinementInstruction) {
      return res.status(400).json({ success: false, message: 'Missing currentPlanSpec or refinementInstruction' });
    }

    const baselineDiagnostics = estimatePlanQuality(currentPlanSpec);
    // A plan edited by hand may already break generator rules the person chose
    // to keep (lib/planEdit); a refinement is held to adding no new ones.
    const accepted = currentPlanSpec.edited ? new Set(validateEditedPlan(currentPlanSpec, surveyData || {})) : null;
    const newErrors = (errors) => (accepted ? errors.filter((e) => !accepted.has(e)) : errors);
    const normalizedBrief = normalizeBrief(surveyData || {});
    const prepareEdit = (candidateChanges) => {
      let plan = applyDiff(currentPlanSpec, candidateChanges);
      for (const level of plan.levels || []) { level.doors = []; level.windows = []; }
      const options = { brief: normalizedBrief, footprint: currentPlanSpec.buildingModel?.footprint || {},
        archetype: currentPlanSpec.archetype || null, surveyData: surveyData || {} };
      plan = enrichPlanSpec(plan, options);
      plan = placeOpenings(plan, surveyData || {});
      return enrichPlanSpec(plan, options);
    };

    // ── Try deterministic exact-dimension parse before calling Gemini ──────────
    const exactMatch = parseExactInstruction(refinementInstruction, currentPlanSpec);
    let changes;
    let sanitization;

    if (exactMatch) {
      const candidates = resizeCandidates(currentPlanSpec, exactMatch.room.id, exactMatch.newW, exactMatch.newH);
      let validationErrors = [];
      for (const rawChanges of candidates) {
        const checked = sanitizeChangesDetailed(currentPlanSpec, rawChanges);
        // Boundary edits are atomic. Dropping one neighbor leaves a hole.
        if (checked.rejectedChanges.some(c => c.reason !== 'no_op_change')) continue;
        const proposed = prepareEdit(checked.changes);
        validationErrors = newErrors(validateEditedPlan(proposed, surveyData || {}));
        if (!validationErrors.length) { sanitization = checked; changes = checked.changes; break; }
      }
      if (!changes) return res.status(422).json({ success: false, rejected: true,
        code: 'RESIZE_DOES_NOT_FIT',
        message: `The requested ${exactMatch.newW} × ${exactMatch.newH} ft size cannot fit without disrupting adjacent rooms or protected circulation. Your current plan is unchanged.`,
        diagnostics: { validationErrors } });
    } else {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) return res.status(503).json({ success: false, code: 'REFINEMENT_AI_UNAVAILABLE',
        message: 'Natural-language refinement is unavailable. Exact room sizes can still be edited, for example: resize kitchen to 12 by 14.' });
      // ── Gemini path ────────────────────────────────────────────────────────────
      const prompt = buildRefinePrompt(currentPlanSpec, refinementInstruction, surveyData || {});
      const ai = new GoogleGenAI({ apiKey });

      let rawText = '';
      try {
        const response = await ai.models.generateContent({
          model: process.env.GEMINI_REFINE_MODEL || 'gemini-3.1-pro-preview',
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            temperature: 0.15,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
          },
        });
        rawText =
          response?.candidates?.[0]?.content?.parts?.[0]?.text ||
          response?.text ||
          '';
        console.log('[refine] Gemini raw response:', rawText.slice(0, 500));
      } catch (geminiErr) {
        console.error('[refine] Gemini call failed:', geminiErr?.message, geminiErr?.status);
        return res.status(502).json({
          success: false,
          message: `Gemini API error: ${geminiErr?.message || String(geminiErr)}`,
        });
      }

      let rawChanges;
      try {
        rawChanges = parseGeminiDiff(rawText);
      } catch (parseErr) {
        console.error('[refine] Failed to parse Gemini response:', rawText);
        return res.status(422).json({
          success: false,
          message: `Could not parse Gemini response: ${parseErr.message}. Raw: ${rawText.slice(0, 200)}`,
        });
      }

      if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
        return res.status(422).json({
          success: false,
          message: 'Gemini returned no changes for that instruction. Try being more specific.',
        });
      }

      sanitization = sanitizeChangesDetailed(currentPlanSpec, rawChanges);
      changes = sanitization.changes;
      console.log('[refine] applying', changes.length, 'sanitized changes:', JSON.stringify(changes));
      if (sanitization.rejectedChanges.length) {
        console.log('[refine] rejected raw changes:', JSON.stringify(sanitization.rejectedChanges));
      }
    }

    if (!changes.length) {
      return res.status(422).json({
        success: false,
        rejected: true,
        message: 'Refinement was rejected because it only targeted protected or invalid rooms.',
        rejectedChanges: sanitization.rejectedChanges,
      });
    }

    let updatedPlanSpec = applyDiff(currentPlanSpec, changes);

    // Re-validate connectivity after applying diff so we catch rooms that become
    // unreachable after a move/resize. This mirrors the pipeline validation in plan.js.
    const connectivityErrors = validateConnectivity(updatedPlanSpec, surveyData || {});
    if (connectivityErrors.length) {
      console.warn('[refine] connectivity errors after applyDiff:', connectivityErrors.slice(0, 5));
    }

    const briefLike = normalizedBrief;
    updatedPlanSpec = enrichPlanSpec(updatedPlanSpec, {
      brief: briefLike,
      footprint: currentPlanSpec?.buildingModel?.footprint || {},
      archetype: currentPlanSpec?.archetype || null,
      surveyData,
    });
    // Clear stale openings so placeOpenings recomputes door/window positions
    // from the new room geometry. Without this, old door coordinates are copied
    // verbatim and rooms move but doors don't.
    for (const level of updatedPlanSpec.levels || []) {
      level.doors = [];
      level.windows = [];
    }
    updatedPlanSpec = placeOpenings(updatedPlanSpec, surveyData || {});
    updatedPlanSpec = enrichPlanSpec(updatedPlanSpec, {
      brief: briefLike,
      footprint: currentPlanSpec?.buildingModel?.footprint || {},
      archetype: currentPlanSpec?.archetype || null,
      surveyData,
    });
    const finalErrors = newErrors(validateEditedPlan(updatedPlanSpec, surveyData || {}));
    if (finalErrors.length) {
      return res.status(422).json({
        success: false,
        rejected: true,
        message: 'Refinement could not preserve a valid layout. Try a smaller change.',
        diagnostics: { validationErrors: finalErrors },
      });
    }
    updatedPlanSpec.elevations = renderElevations(updatedPlanSpec, surveyData);
    updatedPlanSpec.surveyFulfillment=require('../lib/surveyFulfillment').buildSurveyFulfillment(updatedPlanSpec,surveyData);
    updatedPlanSpec.estimate = buildEstimate(updatedPlanSpec, {
      brief: normalizeBrief(surveyData || {}),
      surveyData: surveyData || {},
    });

    const refinedDiagnostics = estimatePlanQuality(updatedPlanSpec);
    const protectedIssues = collectProtectedIssues(currentPlanSpec, updatedPlanSpec);
    const scopeIssues = collectRefinementScopeIssues(currentPlanSpec, changes, updatedPlanSpec);
    if (protectedIssues.length) {
      return res.status(422).json({
        success: false,
        rejected: true,
        message: 'Refinement was rejected because it changed protected structural elements.',
        appliedChanges: changes,
        rejectedChanges: sanitization.rejectedChanges,
        diagnostics: {
          baseline: baselineDiagnostics,
          refined: refinedDiagnostics,
          protectedIssues,
        },
      });
    }

    if (scopeIssues.length) {
      return res.status(422).json({
        success: false,
        rejected: true,
        message: 'Refinement was rejected because it attempted a structurally broad edit.',
        appliedChanges: changes,
        rejectedChanges: sanitization.rejectedChanges,
        diagnostics: {
          baseline: baselineDiagnostics,
          refined: refinedDiagnostics,
          scopeIssues,
        },
      });
    }

    const worsened =
      refinedDiagnostics.score < baselineDiagnostics.score ||
      refinedDiagnostics.issues.length > baselineDiagnostics.issues.length;

    if (!refinedDiagnostics.valid && worsened) {
      return res.status(422).json({
        success: false,
        rejected: true,
        message: 'Refinement was rejected because it made the plan worse.',
        appliedChanges: changes,
        rejectedChanges: sanitization.rejectedChanges,
        diagnostics: {
          baseline: baselineDiagnostics,
          refined: refinedDiagnostics,
        },
      });
    }

    if (refinedDiagnostics.score + 8 < baselineDiagnostics.score) {
      return res.status(422).json({
        success: false,
        rejected: true,
        message: 'Refinement was rejected because plan quality dropped materially.',
        appliedChanges: changes,
        rejectedChanges: sanitization.rejectedChanges,
        diagnostics: {
          baseline: baselineDiagnostics,
          refined: refinedDiagnostics,
        },
      });
    }

    let svgString;
    try {
      svgString = renderPlanSvg(updatedPlanSpec);
    } catch (renderErr) {
      return res.status(422).json({
        success: false,
        rejected: true,
        message: `Refinement produced an unrenderable plan: ${renderErr.message}`,
        appliedChanges: changes,
        rejectedChanges: sanitization.rejectedChanges,
        diagnostics: {
          baseline: baselineDiagnostics,
          refined: refinedDiagnostics,
        },
      });
    }

    const galleryId = await addPlan(surveyData || {}, updatedPlanSpec, svgString);
    return res.status(200).json({
      success: true,
      planSpec: updatedPlanSpec,
      estimate: updatedPlanSpec?.estimate || null,
      svg: svgString,
      elevations: updatedPlanSpec?.elevations || {},
      archetype: updatedPlanSpec?.archetype || null,
      galleryId,
      appliedChanges: changes,
      rejectedChanges: sanitization.rejectedChanges,
      diagnostics: {
        baseline: baselineDiagnostics,
        refined: refinedDiagnostics,
      },
    });
  } catch (err) {
    console.error('[refine] error:', err);
    return res.status(500).json({
      success: false,
      message: `Refinement failed: ${err?.message || String(err)}`,
    });
  }
}

module.exports = refineHandler;
module.exports.__test = {
  applyDiff,
  collectProtectedIssues,
  collectRefinementScopeIssues,
  computeExactResizeChanges,
  estimatePlanQuality,
  parseExactInstruction,
  parseGeminiDiff,
  sanitizeChanges,
  sanitizeChangesDetailed,
};
