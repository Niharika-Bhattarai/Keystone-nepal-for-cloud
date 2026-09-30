'use strict';

const { buildWallModel } = require('./wallModel');
const { boundarySegments, openingSpan } = require('../openingGeometry');
const { intersection, containsRect } = require('./rectBoolean');
const { resolveOpeningSchedules } = require('./openingIdentity');
const EPS = 1e-7;
const positive = x => Number.isFinite(x) && x > 0;
const nonnegative = x => Number.isFinite(x) && x >= 0;
const same = (a, b) => Math.abs(a - b) <= EPS;
const size = f => [f.w, f.h].sort((a, b) => a - b);
const binding = w => ({ roomId: w.roomId, x: w.x, y: w.y, dir: w.dir, width: w.width });
const sameBinding = (a, b) => a && Object.keys(b).every(k => a[k] === b[k]);

// Explicit floor-relative measurements only. No assumed furniture heights or
// implied window operability/egress certification. Compile once per room shape;
// candidate furniture moves reuse the checked wall and opening geometry.
function createBedroomArchitecturalCheck(level, roomId, bedId, policy) {
  const fail = reason => ({ status: 'not_checked', reason });
  if (!policy || typeof policy !== 'object' || typeof policy.basis !== 'string' || !policy.basis.trim() ||
      !nonnegative(policy.headboardMaxGapFt) || policy.headboardMaxGapFt > 1 ||
      !Array.isArray(policy.furniture) || !Array.isArray(policy.windows)) return fail('Explicit dimensions, basis and a headboard gap from zero to one foot are required.');
  const rooms = (level.rooms || []).filter(r => r.id === roomId), room = rooms[0];
  if (rooms.length !== 1) return fail('A unique bedroom is required.');
  const furniture = (level.furniture || []).filter(f => f.roomId === roomId);
  const bed = furniture.find(f => f.id === bedId);
  if (!bed || !String(bed.kind).startsWith('bed_') || furniture.filter(f => String(f.kind).startsWith('bed_')).length !== 1 ||
      new Set(furniture.map(f => f.id)).size !== furniture.length) return fail('One unambiguous bed and furniture inventory are required.');
  const measurements = new Map();
  for (const record of policy.furniture) {
    const item = furniture.find(f => f.id === record?.furnitureId);
    if (!item || measurements.has(item.id) || record.kind !== item.kind ||
        !positive(record.widthFt) || !positive(record.lengthFt) || !positive(record.heightFt) ||
        !size(item).every((v, i) => same(v, [record.widthFt, record.lengthFt].sort((a, b) => a - b)[i]))) return fail('Furniture measurements must bind uniquely to the existing identity, kind and physical size.');
    if (item.id === bedId && (!positive(record.headboardHeightFt) || !positive(record.headboardDepthFt) ||
        record.headboardHeightFt < record.heightFt || record.headboardDepthFt > Math.min(item.w, item.h))) return fail('Explicit bed body/headboard heights and a headboard depth within its footprint are required.');
    measurements.set(item.id, structuredClone(record));
  }
  if (measurements.size !== furniture.length) return fail('Every bedroom furnishing needs an explicit height measurement.');
  const windows = (level.windows || []).filter(w => w.roomId === roomId);
  if ((level.windows || []).some(w => !w.roomId)) return fail('Unowned windows must be assigned before architectural checks.');
  if (policy.windows.length !== windows.length) return fail('Every bedroom window needs an exact geometry-bound height and operating-clearance record.');
  const model = buildWallModel(level);
  if (model.errors.length) return fail('Wall geometry is invalid.');
  const clear = model.roomClear.find(r => r.roomId === roomId)?.parts || [];
  const edges = boundarySegments(room);
  const faces = [];
  for (const wall of model.walls.filter(w => w.roomIds.includes(roomId))) for (const edge of edges) {
    if (edge.dir !== wall.orientation || !same(edge.fixed, wall.axisFt)) continue;
    const start = Math.max(edge.start, wall.startFt), end = Math.min(edge.end, wall.endFt);
    if (end - start > EPS) faces.push({ dir: edge.dir, axis: wall.axisFt + edge.side * wall.assembly.thicknessFt / 2,
      nominalAxis: wall.axisFt, side: edge.side, start, end });
  }
  const glazing = [], seen = new Set();
  for (const record of policy.windows) {
    const matches = windows.map((w, i) => ({ w, i })).filter(({ w }) => sameBinding(record?.binding, binding(w)));
    if (matches.length !== 1 || seen.has(matches[0].i) || !nonnegative(record.sillHeightFt) ||
        !positive(record.headHeightFt) || record.headHeightFt <= record.sillHeightFt || !positive(record.clearanceDepthFt)) return fail('Window records must bind uniquely to current geometry and state valid sill/head heights and a positive clearance depth.');
    seen.add(matches[0].i);
    const window = matches[0].w, span = openingSpan(window, 'window');
    const host = faces.filter(f => f.dir === span.dir && same(f.nominalAxis, span.fixed) && f.start <= span.start + EPS && f.end >= span.end - EPS);
    if (host.length !== 1) return fail('Each window must lie on one known finished wall face.');
    const face = host[0], d = record.clearanceDepthFt;
    const zone = face.dir === 'horizontal'
      ? { x: span.start, y: face.axis - (face.side < 0 ? d : 0), w: span.width, h: d }
      : { x: face.axis - (face.side < 0 ? d : 0), y: span.start, w: d, h: span.width };
    if (!containsRect(clear, zone)) return fail('Window operating reservation leaves finished room floor; coordinated geometry is required.');
    glazing.push({ ...structuredClone(record), span, zone });
  }
  const resolved = resolveOpeningSchedules(level);
  if (resolved.errors.length) return fail('Opening schedules are stale.');
  const doors = [];
  for (const [index, door] of (level.doors || []).entries()) {
    if (door.a !== roomId && door.b !== roomId) continue;
    const rough = resolved.schedules[index]?.roughWidthFt;
    if (!positive(rough) || rough < door.width) return fail('Bedroom doors need bound rough-opening widths before wall support can be verified.');
    doors.push(openingSpan({ ...door, width: rough }));
  }
  function check(items) {
    const issues = [];
    if (!Array.isArray(items) || items.length !== furniture.length || new Set(items.map(f => f.id)).size !== items.length || items.some(f => {
      const m = measurements.get(f.id);
      return !m || f.roomId !== roomId || f.kind !== m.kind || ![f.x, f.y, f.w, f.h].every(Number.isFinite) || f.w <= 0 || f.h <= 0 ||
        !size(f).every((v, i) => same(v, [m.widthFt, m.lengthFt].sort((a, b) => a - b)[i]));
    })) return { status: 'not_checked', issues: [{ code: 'FURNITURE_MEASUREMENT_STALE' }] };
    const candidate = items.find(f => f.id === bedId), m = measurements.get(bedId);
    if (![0, 90, 180, 270].includes(candidate.rotation)) return { status: 'not_checked', issues: [{ code: 'BED_ORIENTATION_REQUIRED' }] };
    const rotation = candidate.rotation, horizontal = rotation % 180 === 0;
    const head = { dir: horizontal ? 'horizontal' : 'vertical',
      axis: rotation === 0 ? candidate.y : rotation === 180 ? candidate.y + candidate.h : rotation === 90 ? candidate.x + candidate.w : candidate.x,
      side: rotation === 0 || rotation === 270 ? 1 : -1,
      start: horizontal ? candidate.x : candidate.y, end: horizontal ? candidate.x + candidate.w : candidate.y + candidate.h };
    let supported = false, support = null;
    for (const face of faces.filter(f => f.dir === head.dir && f.side === head.side)) {
      const gap = (head.axis - face.axis) * head.side;
      if (gap < -EPS || gap > policy.headboardMaxGapFt + EPS) continue;
      const peers = faces.filter(f => f.dir === face.dir && f.side === face.side && same(f.axis, face.axis) && same(f.nominalAxis, face.nominalAxis));
      let segments = peers.map(f => [f.start, f.end]);
      const holes = [...doors, ...glazing.filter(g => g.sillHeightFt < m.headboardHeightFt - EPS).map(g => g.span)]
        .filter(s => s.dir === face.dir && same(s.fixed, face.nominalAxis));
      for (const hole of holes) segments = segments.flatMap(([a, b]) => {
        if (hole.end <= a || hole.start >= b) return [[a, b]];
        return [[a, Math.min(b, hole.start)], [Math.max(a, hole.end), b]].filter(([x, y]) => y - x > EPS);
      });
      let cursor = head.start;
      for (const [a, b] of segments.sort((a, b) => a[0] - b[0])) {
        if (b <= cursor) continue;
        if (a > cursor + EPS) break;
        cursor = Math.max(cursor, b);
      }
      if (cursor >= head.end - EPS) {
        supported = true;
        support = { dir: face.dir, finishedAxisFt: face.axis, nominalAxisFt: face.nominalAxis,
          startFt: head.start, endFt: head.end, gapFt: Math.max(0, gap) };
        break;
      }
    }
    if (!supported) issues.push({ code: 'HEADBOARD_WALL_SUPPORT', furnitureId: bedId,
      message: 'The full headboard width needs a solid finished wall within the declared gap, without a door or intersecting glazing.' });
    for (const item of items) {
      const measure = measurements.get(item.id);
      const components = [{ rect: item, height: measure.heightFt, component: 'body' }];
      if (item.id === bedId) {
        const d = measure.headboardDepthFt;
        const rect = horizontal ? { x: item.x, y: rotation === 0 ? item.y : item.y + item.h - d, w: item.w, h: d }
          : { x: rotation === 270 ? item.x : item.x + item.w - d, y: item.y, w: d, h: item.h };
        components.push({ rect, height: measure.headboardHeightFt, component: 'headboard' });
      }
      for (const component of components) for (const window of glazing) {
        if (component.height > window.sillHeightFt + EPS && intersection(component.rect, window.zone)) issues.push({
          code: 'FURNITURE_WINDOW_CLEARANCE', furnitureId: item.id, component: component.component, window: window.binding,
          message: 'Furniture intersects the declared window operating space above its sill.' });
      }
    }
    return { status: issues.length ? 'conflict' : 'clear', issues, basis: policy.basis,
      headboardSupported: supported, headboardSupport: support, constructionVerified: false, egressVerified: false };
  }
  return { status: 'ready', check, faces, windowZones: glazing.map(g => g.zone) };
}

module.exports = { createBedroomArchitecturalCheck };
