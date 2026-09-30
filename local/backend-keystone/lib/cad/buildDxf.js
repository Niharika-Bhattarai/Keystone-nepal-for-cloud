'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildWallModel } = require('../geometry/wallModel');
const { union, subtract, unionArea } = require('../geometry/rectBoolean');
const { boundarySegments } = require('../openingGeometry');
const { doorSwingSign, doorHeight, windowHeights } = require('../openingPresentation');
const { PRODUCT_NAME } = require('../brand');
const { validateFittedLayout } = require('../stairs/validateFittedLayout');

const fail = message => { throw Object.assign(new Error(message), { code: 'DXF_INPUT_INVALID' }); };
const partsOf = r => r.parts?.length ? r.parts : [r];
const positive = n => Number.isFinite(Number(n)) && Number(n) > 0;

function prepareDxf(plan) {
  if (!Array.isArray(plan?.levels) || !plan.levels.length || plan.levels.length > 8) fail('One to eight plan levels are required.');
  const levels = [...plan.levels].sort((a, b) => Number(a.level) - Number(b.level));
  const warnings = new Set(['Concept CAD drawings. Nominal wall-centreline dimensions; assembly thicknesses are assumed.']);
  const drawings = levels.map((level, index) => {
    if (!positive(level.width) || !positive(level.height) || level.width > 1000 || level.height > 1000) fail('Level dimensions must be positive feet, up to 1000 ft.');
    if (!Array.isArray(level.rooms) || !level.rooms.length || level.rooms.length > 250) fail('Each level requires 1 to 250 rooms.');
    if ((level.doors?.length || 0) + (level.windows?.length || 0) > 1000) fail('Too many openings.');
    if (level.furniture && (!Array.isArray(level.furniture) || level.furniture.length > 2000)) fail('Too many furniture items.');
    const rooms = level.rooms.map((r, i) => ({ ...r, id: r.id || `L${index + 1}-R${i + 1}`,
      openConcept: r.openConcept ?? plan.openConcept }));
    if (rooms.some(r => partsOf(r).length > 100)) fail('Too many room parts.');
    const model = buildWallModel({ ...level, rooms });
    if (model.errors.length) fail(model.errors.map(e => e.message).join(' '));
    const cuts = [];
    const openings = [];
    const sourceOpenings = [...(level.doors || []).map(o => ({ ...o, kind: 'door' })),
      ...(level.windows || []).map(o => ({ ...o, kind: 'window' }))];
    const counts = { door: 0, window: 0 };
    sourceOpenings.forEach((o, i) => {
      const vertical = o.dir === 'vertical';
      if (!['vertical', 'horizontal'].includes(o.dir) || ![o.x, o.y].every(v => Number.isFinite(Number(v)))) fail('Opening position and direction are required.');
      const width = Number(o.width ?? o.doorWidth ?? o.windowWidth ?? o.w);
      if (!positive(width)) fail('Saved opening width is required for CAD export.');
      const axis = Number(vertical ? o.x : o.y), center = Number(vertical ? o.y : o.x);
      const start = center - width / 2, end = center + width / 2;
      const walls = model.walls.filter(w => w.orientation === o.dir && Math.abs(w.axisFt - axis) < 1e-6 && w.endFt > start && w.startFt < end);
      // Open-concept thresholds can identify circulation without a physical wall.
      if (!walls.length && o.openThreshold) return;
      if (!walls.length) fail(`Opening ${i + 1} does not lie on a wall.`);
      const spans = walls.map(w => [Math.max(start, w.startFt), Math.min(end, w.endFt)]).sort((a, b) => a[0] - b[0]);
      let covered = start;
      for (const [a, b] of spans) { if (a > covered + 1e-6) break; covered = Math.max(covered, b); }
      if (covered < end - 1e-6) fail(`Opening ${i + 1} extends beyond its wall.`);
      if (openings.some(other => other.dir === o.dir && Math.abs((vertical ? other.x : other.y) - axis) < 1e-6
        && Math.min(end, (vertical ? other.y : other.x) + other.width / 2)
          - Math.max(start, (vertical ? other.y : other.x) - other.width / 2) > 1e-6)) fail('Openings overlap on the same wall.');
      const thickness = Math.max(...walls.map(w => w.assembly.thicknessFt));
      cuts.push(vertical ? { x: axis - thickness, y: start, w: thickness * 2, h: width }
        : { x: start, y: axis - thickness, w: width, h: thickness * 2 });
      const room = rooms.find(r => String(r.id) === String(o.roomId)) || rooms.find(r => walls.some(w => w.roomIds.includes(r.id)));
      const heights = o.kind === 'window' ? windowHeights(o, room) : { sill: 0, head: doorHeight(o, rooms) };
      if (!(heights.head > heights.sill && heights.sill >= 0)) fail(`Opening ${i + 1} has invalid heights.`);
      openings.push({ ...o, x: Number(o.x), y: Number(o.y), width, thickness,
        tag: `${o.kind === 'window' ? 'W' : 'D'}${index + 1}-${++counts[o.kind]}`,
        swingSign: o.kind === 'door' ? doorSwingSign(o, rooms) : 0, ...heights });
    });
    const solids = union(model.walls.map(w => {
      const half = w.assembly.thicknessFt / 2;
      return w.orientation === 'vertical'
        ? { x: w.axisFt - half, y: w.startFt - half, w: half * 2, h: w.lengthFt + half * 2 }
        : { x: w.startFt - half, y: w.axisFt - half, w: w.lengthFt + half * 2, h: half * 2 };
    }));
    const cutSolids = subtract(solids, cuts);
    const snap = n => Math.round(n * 1e7) / 1e7;
    const outline = boundarySegments({ parts: cutSolids.map(r => ({ x: snap(r.x), y: snap(r.y), w: snap(r.x + r.w) - snap(r.x), h: snap(r.y + r.h) - snap(r.y) })) });
    const endpoints = new Map();
    for (const edge of outline) for (const end of [edge.start, edge.end]) {
      const point = edge.dir === 'vertical' ? [edge.fixed, end] : [end, edge.fixed];
      const key = point.map(n => n.toFixed(6)).join(',');
      endpoints.set(key, (endpoints.get(key) || 0) + 1);
    }
    if ([...endpoints.values()].some(degree => degree % 2 !== 0)) fail('Wall outline contains disconnected endpoints.');
    const stairs = level.stairCore?.layout;
    if (rooms.some(r => r.type === 'stairs') && !stairs?.flights?.length) warnings.add(`Level ${level.level || index + 1}: no saved stair flights; stair room labelled only.`);
    if (stairs?.valid === false) fail('Saved stair layout is marked invalid.');
    if (stairs) {
      const check = validateFittedLayout(stairs, { core: level.stairCore });
      if (!check.valid) fail(`Invalid saved stair geometry: ${check.errors.join(' ')}`);
    }
    return { level: level.level || index + 1, topLevel: index === levels.length - 1, width: Number(level.width), height: Number(level.height), outline,
      walls: model.walls.map(w => ({ dir: w.orientation, axis: w.axisFt, start: w.startFt, end: w.endFt, thickness: w.assembly.thicknessFt, exterior: w.exterior })),
      frontFacing: level.facade?.frontFacing || plan.facade?.frontFacing || null,
      frontEdge: level.facade?.frontEdge || plan.facade?.frontEdge || null,
      rooms: rooms.map((r, ri) => ({ id: r.id, tag: `R${index + 1}-${ri + 1}`, label: r.label || r.type || 'Room', parts: partsOf(r), area: unionArea(partsOf(r)) })),
      furniture: (level.furniture || []).map(item => {
        if (![item.x, item.y, item.w, item.h].every(Number.isFinite) || item.w <= 0 || item.h <= 0) fail('Furniture footprint must have finite positive dimensions.');
        return { ...item };
      }),
      openings, stairs: stairs || null };
  });
  // Roof profiles come from the same geometry used by the interactive model,
  // never from a separately invented elevation outline.
  const { builder, meta } = require('../model3d/buildModel').buildModel(plan, { include: { furniture: false, site: false } });
  const roofTriangles = [];
  for (const [material, bucket] of (builder.nodes.get('Roof') || new Map()).entries()) {
    if (material === 'gutter') continue;
    for (let i = 0; i < bucket.indices.length; i += 3) {
      roofTriangles.push(bucket.indices.slice(i, i + 3).map(index => bucket.positions.slice(index * 3, index * 3 + 3)));
    }
  }
  for (const [index, drawing] of drawings.entries()) {
    const height = meta.levels.find(level => Number(level.level) === Number(drawing.level));
    drawing.floorZ = height.floorY;
    drawing.ceilingZ = height.ceilingY;
    const next = meta.levels.find(level => Number(level.level) === Number(drawings[index + 1]?.level));
    drawing.wallTopZ = next ? next.floorY : height.ceilingY;
  }
  warnings.add('Elevations use model roof geometry and nominal wall profiles; no surveyed grade or construction assembly is supplied.');
  return { version: 'keystone-cad-concept-v2', brand: PRODUCT_NAME, units: 'feet', levels: drawings, roofTriangles,
    modelCenter: [meta.footprint.width / 2, meta.footprint.depth / 2], warnings: [...warnings] };
}

// Debian (the service's container) installs Python 3 as `python3` only;
// Windows calls it `python`. PYTHON overrides both.
const pythonCommand = () => process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

function buildDxf(plan) {
  const payload = prepareDxf(plan);
  const result = spawnSync(pythonCommand(), [path.resolve(__dirname, '../../scripts/export/build_concept_dxf.py')], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('DXF writer failed: ' + (result.error?.message || result.stderr).slice(0, 500));
  return { dxf: result.stdout, warnings: payload.warnings, version: payload.version };
}
module.exports = { prepareDxf, buildDxf, pythonCommand };
