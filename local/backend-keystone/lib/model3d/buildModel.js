'use strict';

// planSpec -> 3D house model.
//
// Pure geometry: no rendering, no dependencies. The output is a MeshBuilder
// full of triangles grouped by node ("Level 1", "Ceiling 1", "Furniture 1",
// "Roof", "Site") and material, plus metadata a viewer or the Blender bake
// needs: levels, rooms, main entry, stair path, light slots and furniture
// slots.
//
// Frame: feet, X = plan x, Z = plan y, Y = up, centred on the footprint.
// Heights come from planSpec.verticalModel, stairs from each level's
// stairCore.layout (flights, landings, floor opening), finishes from
// planSpec.finishSpec. Every number read from the plan is passed through
// num(), so strings in a client-supplied plan cannot reach the output.
//
// Walls: every boundary between two rooms is classified. Open-concept public
// rooms, joined halls and lofts get no wall; the edge of a stairwell gets a
// guard rail on the floor above and a stringer knee wall with a sloped rail
// beside the flight; everything else is a full wall cut by its doors and
// windows.

const { MeshBuilder, FT } = require('./meshBuilder');
const { buildPalette, floorMaterialFor } = require('./materials');
const { addFurniture, furnitureSide } = require('./furniture');
const { doorSwingSign, doorHeight, windowHeights } = require('../openingPresentation');
const { validateFittedLayout } = require('../stairs/validateFittedLayout');
const { openPairKeys, pairKey } = require('../openEdges');

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const EPS = 1e-6;

const WALL_EXT = 0.6;       // ~7 in
const WALL_INT = 0.4;       // ~5 in
const ACCENT_H = 3.0;       // stone/brick base course on the ground floor
const BASE_H = 0.35;        // baseboard, ~4 in
const SIDELIGHT = 1.25;     // entry sidelight width, ft
const RAIL_H = 3.0;         // guard height, 36 in
const BALUSTER_GAP = 0.36;  // centres, keeps the 4 in sphere rule
const GRADE = -0.5;         // finished ground: 6 in of foundation shows

const PUBLIC = /^(kitchen|dining_room|dining|living_room|family_room|great_room|breakfast_nook|nook)$/;
const CIRC = /^(hallway|hall|landing|foyer|entry|gallery)$/;
const STAIR = /^stairs?$/;
const STAIR_OPEN_TO = /^(hallway|hall|landing|foyer|entry|loft|living_room|family_room|great_room)$/;

function roomRects(level) {
  const out = [];
  for (const r of level.rooms || []) {
    const parts = Array.isArray(r.parts) && r.parts.length ? r.parts : [r];
    for (const p of parts) {
      const x = num(p.x), y = num(p.y), w = num(p.w), h = num(p.h);
      if (w > EPS && h > EPS) out.push({ x0: x, y0: y, x1: x + w, y1: y + h, room: r });
    }
  }
  return out;
}

function subtractRect(r, hole) {
  if (!hole || hole.x1 <= r.x0 || hole.x0 >= r.x1 || hole.y1 <= r.y0 || hole.y0 >= r.y1) return [r];
  const out = [];
  if (hole.y0 > r.y0) out.push({ ...r, y1: hole.y0 });
  if (hole.y1 < r.y1) out.push({ ...r, y0: hole.y1 });
  const ya = Math.max(r.y0, hole.y0), yb = Math.min(r.y1, hole.y1);
  if (hole.x0 > r.x0) out.push({ ...r, y0: ya, y1: yb, x1: hole.x0 });
  if (hole.x1 < r.x1) out.push({ ...r, y0: ya, y1: yb, x0: hole.x1 });
  return out.filter((q) => q.x1 - q.x0 > EPS && q.y1 - q.y0 > EPS);
}
const subtractAll = (rects, holes) => holes.reduce((acc, h) => acc.flatMap((r) => subtractRect(r, h)), rects);

function levelHeights(planSpec, level, idx) {
  const vm = (planSpec.verticalModel?.levels || []).find((l) => num(l.level) === num(level.level));
  const floorZ = vm ? num(vm.floorZFt) : idx * 10;
  const clear = vm ? num(vm.clearHeightFt, 9) : 9;
  const f2f = vm ? num(vm.floorToFloorFt, clear + 1) : clear + 1;
  const structure = vm ? num(vm.structureThicknessFt, 1) : 1;
  return { floorZ, clear, f2f, structure, isTop: vm ? Boolean(vm.isTopLevel) : false };
}

function roofStyle(planSpec, options) {
  const kind = String(options.roofKind || planSpec.elevations?.meta?.roofKind || planSpec.estimate?.summary?.roofKind || 'gable').toLowerCase();
  if (/flat|membrane/.test(kind)) return { type: 'flat', pitch: 0, overhang: 1, kind };
  const pitch = /craftsman/.test(kind) ? 5 / 12 : /farm|colonial|steep/.test(kind) ? 8 / 12 : /shed|modern|contemporary/.test(kind) ? 3 / 12 : 6 / 12;
  const overhang = /craftsman/.test(kind) ? 2 : 1.5;
  return { type: /hip/.test(kind) ? 'hip' : 'gable', pitch, overhang, kind };
}

// What stands on the line between two rooms.
function boundaryKind(ra, rb, ctx) {
  if (ra === rb) return 'none';
  // A wall a person took out in the Studio's edit mode.
  if (ctx.openPairs?.has(pairKey(ra.id, rb.id))) return 'open';
  const ta = String(ra.type || ''), tb = String(rb.type || '');
  const either = (p, q) => (p.test(ta) && q.test(tb)) || (p.test(tb) && q.test(ta));
  if (ctx.openConcept && PUBLIC.test(ta) && PUBLIC.test(tb)) return 'open';
  if (CIRC.test(ta) && CIRC.test(tb)) return 'open';
  if (either(/^loft$/, CIRC)) return 'open';
  if (ctx.stairMode !== 'none' && either(STAIR, STAIR_OPEN_TO)) return ctx.stairMode === 'flights' ? 'stringer' : 'rail';
  return 'wall';
}

// Rectangles that together cover a set of room rectangles (plan feet), big
// ones first: each is the all-filled rectangle adding the most uncovered
// area. Overlaps are allowed (the roofs over them intersect).
function coverRects(rects, minArea = 40, maxPieces = 4) {
  if (!rects.length) return [];
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  const filled = [], covered = [];
  for (let i = 0; i < nx; i++) {
    filled.push([]);
    covered.push([]);
    for (let j = 0; j < ny; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      filled[i].push(rects.some((r) => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1));
      covered[i].push(false);
    }
  }
  const cellA = (i, j) => (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  const out = [];
  for (let k = 0; k < maxPieces; k++) {
    let best = null;
    for (let i0 = 0; i0 < nx; i0++) {
      for (let j0 = 0; j0 < ny; j0++) {
        if (!filled[i0][j0]) continue;
        let jMax = ny;
        for (let i1 = i0; i1 < nx && filled[i1][j0]; i1++) {
          let j1 = j0;
          while (j1 < jMax && filled[i1][j1]) j1++;
          jMax = j1;
          let area = 0, fresh = 0;
          for (let i = i0; i <= i1; i++) for (let j = j0; j < jMax; j++) { const a = cellA(i, j); area += a; if (!covered[i][j]) fresh += a; }
          if (fresh > 0 && (!best || fresh > best.fresh || (fresh === best.fresh && area > best.area))) best = { i0, i1, j0, j1: jMax - 1, area, fresh };
        }
      }
    }
    if (!best || best.fresh < minArea) break;
    for (let i = best.i0; i <= best.i1; i++) for (let j = best.j0; j <= best.j1; j++) covered[i][j] = true;
    out.push({ x0: xs[best.i0], x1: xs[best.i1 + 1], y0: ys[best.j0], y1: ys[best.j1 + 1] });
  }
  return out;
}

// A stair for plans that name a stairs room but carry no stair layout (the
// older tile generator): a straight flight when the room is long enough,
// otherwise two flights turning at a landing. Same shape as stairCore.layout.
function synthStairLayout(level, hts) {
  const room = (level.rooms || []).find((r) => STAIR.test(String(r.type || '')));
  if (!room) return null;
  const r = { x: num(room.x), y: num(room.y), w: num(room.w), h: num(room.h) };
  if (r.w < 3 || r.h < 3) return null;
  const rise = hts.f2f;
  const risers = Math.max(8, Math.ceil((rise * 12) / 7.75));
  const tread = 10 / 12;
  const alongX = r.w >= r.h;
  const L = alongX ? r.w : r.h, Wd = alongX ? r.h : r.w;
  const s0 = alongX ? r.x : r.y, c0 = alongX ? r.y : r.x;
  const need = (risers - 1) * tread;
  const mk = (a, b, cA, cB, fromZ, toZ, n) => {
    const rect = alongX ? { x: Math.min(a, b), y: cA, w: Math.abs(b - a), h: cB - cA } : { x: cA, y: Math.min(a, b), w: cB - cA, h: Math.abs(b - a) };
    const mid = (cA + cB) / 2;
    return { rect, from: alongX ? { x: a, y: mid } : { x: mid, y: a }, to: alongX ? { x: b, y: mid } : { x: mid, y: b }, risers: n, fromZFt: fromZ, toZFt: toZ };
  };
  if (L >= need + 3) {
    const a = s0 + 1.5;
    return { flights: [mk(a, a + need, c0, c0 + Math.min(Wd, 3.6), 0, rise, risers)], landings: [], floorOpening: { ...r } };
  }
  // U-turn: up one half of the room, a landing across the far end, back along the other half
  const half = Math.min(Wd / 2, 3.6);
  const n1 = Math.ceil(risers / 2), n2 = risers - n1;
  const zMid = (rise * n1) / risers;
  const run1 = (n1 - 1) * tread, run2 = (n2 - 1) * tread;
  const land = Math.max(3, Math.min(4, L - Math.max(run1, run2)));
  const end = s0 + L - land;
  const f1 = mk(end - run1, end, c0, c0 + half, 0, zMid, n1);
  const f2 = mk(end, end - run2, c0 + Wd - half, c0 + Wd, zMid, rise, n2);
  const landing = alongX ? { x: end, y: c0, w: land, h: Wd } : { x: c0, y: end, w: Wd, h: land };
  return { flights: [f1, f2], landings: [landing], floorOpening: { ...r } };
}

function parseStair(lay) {
  const flights = lay.flights.map((f) => ({
    rect: { x0: num(f.rect?.x), y0: num(f.rect?.y), x1: num(f.rect?.x) + num(f.rect?.w), y1: num(f.rect?.y) + num(f.rect?.h) },
    from: { x: num(f.from?.x), y: num(f.from?.y) }, to: { x: num(f.to?.x), y: num(f.to?.y) },
    risers: Math.max(1, Math.round(num(f.risers, 1))), fromZ: num(f.fromZFt), toZ: num(f.toZFt),
  }));
  const landings = (lay.landings || []).map((l) => {
    const r = { x0: num(l.x), y0: num(l.y), x1: num(l.x) + num(l.w), y1: num(l.y) + num(l.h) };
    const c = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
    let z = 0, bd = Infinity;
    for (const f of flights) for (const [p, fz] of [[f.from, f.fromZ], [f.to, f.toZ]]) {
      const d = Math.hypot(p.x - c[0], p.y - c[1]);
      if (d < bd) { bd = d; z = fz; }
    }
    return { rect: r, z };
  });
  // Walking-surface height (relative to the level floor) near a plan point,
  // or null when the point is not beside a flight or landing.
  const surface = (px, py, grow = 0.75) => {
    let h = null;
    for (const f of flights) {
      const r = f.rect;
      if (px < r.x0 - grow || px > r.x1 + grow || py < r.y0 - grow || py > r.y1 + grow) continue;
      const alongX = Math.abs(f.to.x - f.from.x) >= Math.abs(f.to.y - f.from.y);
      const s0 = alongX ? f.from.x : f.from.y, s1 = alongX ? f.to.x : f.to.y, s = alongX ? px : py;
      const t = Math.max(0, Math.min(1, (s - s0) / ((s1 - s0) || 1)));
      const z = f.fromZ + t * (f.toZ - f.fromZ);
      h = h == null ? z : Math.max(h, z);
    }
    for (const l of landings) {
      const r = l.rect;
      if (px >= r.x0 - grow && px <= r.x1 + grow && py >= r.y0 - grow && py <= r.y1 + grow) h = h == null ? l.z : Math.max(h, l.z);
    }
    return h;
  };
  return { flights, landings, surface };
}

function buildModel(planSpec, options = {}) {
  if (!planSpec || !Array.isArray(planSpec.levels) || !planSpec.levels.length) throw new Error('planSpec with levels is required');
  const include = { furniture: true, roof: true, site: true, ...(options.include || {}) };
  const mb = new MeshBuilder();
  const palette = buildPalette(planSpec.finishSpec || {});
  const levels = [...planSpec.levels].sort((a, b) => num(a.level) - num(b.level));
  const openConcept = planSpec.openConcept === true || /open/i.test(String(planSpec.openConcept || planSpec.designSurvey?.openConcept || ''));

  const W = Math.max(...levels.map((l) => num(l.width))), D = Math.max(...levels.map((l) => num(l.height)));
  const cx = W / 2, cz = D / 2;
  const X = (x) => x - cx, Z = (y) => y - cz;

  const fin = planSpec.finishSpec || {};
  const str = (v) => String(v || '').slice(0, 60);
  const meta = {
    units: 'feet', footprint: { width: W, depth: D }, grade: GRADE, levels: [], rooms: [], entry: null,
    stairPath: [], roof: null, lights: [], furniture: [], dressing: [], exteriorDoors: [], windows: [], doors: [], site: null,
    finish: {
      primaryCladding: str(fin.exterior?.primaryCladding?.material), accentCladding: str(fin.exterior?.accentCladding?.material),
      roofing: str(fin.roofing?.material), floorPublic: str(fin.interiorFinishes?.flooring?.public?.material),
      floorWet: str(fin.interiorFinishes?.flooring?.wet?.material), floorBedroom: str(fin.interiorFinishes?.flooring?.bedroom?.material),
      style: str(fin.styleLabel || planSpec.designSurvey?.materials),
    },
  };
  const lowerOpening = new Map(); // level number -> floor opening rect (plan feet) cut into that level's slab

  levels.forEach((level, idx) => {
    const lv = num(level.level, idx + 1);
    const node = `Level ${lv}`;
    const ceilNode = `Ceiling ${lv}`;
    const furnNode = `Furniture ${lv}`;
    const hts = levelHeights(planSpec, level, idx);
    const top = idx === levels.length - 1;
    const y0 = hts.floorZ;
    const rects = roomRects(level);
    const roomAt = (px, py) => {
      for (const r of rects) if (px > r.x0 + EPS && px < r.x1 - EPS && py > r.y0 + EPS && py < r.y1 - EPS) return r.room;
      return null;
    };
    meta.levels.push({ level: lv, floorY: y0, ceilingY: y0 + hts.clear, name: node });

    const planned = level.stairCore?.layout;
    if (!top && planned) {
      const core = (level.rooms || []).find(r => r.id === level.stairCore.roomId);
      const checked = validateFittedLayout(planned, { core, profile: planned.codeProfileId });
      const next = levelHeights(planSpec, levels[idx + 1], idx + 1);
      const upperLevel = levels[idx + 1];
      const upperCore = (upperLevel.rooms || []).find(r => r.id === upperLevel.stairCore?.roomId);
      const opening = planned.floorOpening;
      const validOpening = opening && core && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(opening[k]) && Math.abs(opening[k] - core[k]) < EPS);
      const aligned = upperCore && core && ['x', 'y', 'w', 'h'].every(k => Math.abs(upperCore[k] - core[k]) < EPS);
      if (planned.valid === false || !checked.valid || !validOpening || !aligned || Math.abs(next.floorZ - y0 - planned.riseFt) > EPS) {
        throw Object.assign(new Error(`Stair layout on level ${lv} needs refitting to its core and floor elevations.`), { code: 'MODEL_STAIR_LAYOUT_INVALID' });
      }
    }
    const lay = planned && planned.valid !== false && Array.isArray(planned.flights) ? planned : (!top ? synthStairLayout(level, hts) : null);
    const stair = !top && lay ? parseStair(lay) : null;
    const ctx = { openConcept, openPairs: openPairKeys(level), stairMode: stair ? 'flights' : lowerOpening.has(lv) ? 'opening' : 'none' };

    // ---- floors, slabs and ceilings ------------------------------------------
    const hole = lowerOpening.get(lv);
    const floorRects = subtractAll(rects, hole ? [hole] : []);
    for (const r of floorRects) {
      const box = [[X(r.x0), 0, Z(r.y0)], [X(r.x1), 0, Z(r.y1)]];
      if (idx === 0) mb.addBox(node, [box[0][0], y0 - 0.5, box[0][2]], [box[1][0], y0 - 0.04, box[1][2]], (k) => (k === 'py' ? 'slab' : 'foundation'));
      else mb.addBox(node, [box[0][0], y0 - hts.structure, box[0][2]], [box[1][0], y0 - 0.04, box[1][2]], (k) => (k === 'ny' ? 'ceiling' : 'slab'));
      // floorZFt is the finished-floor datum shared with stair elevations. Stair
      // rooms are finished too (the floor around and under the first flight);
      // the upper storey's stair opening is already cut out of floorRects.
      mb.addBox(node, [box[0][0], y0 - 0.04, box[0][2]], [box[1][0], y0, box[1][2]], palette[floorMaterialFor(r.room.type)] ? floorMaterialFor(r.room.type) : 'floor-public');
    }
    if (top) for (const r of rects) mb.addBox(ceilNode, [X(r.x0), y0 + hts.clear, Z(r.y0)], [X(r.x1), y0 + hts.clear + 0.1, Z(r.y1)], (k) => (k === 'ny' ? 'ceiling' : 'soffit'));

    const byRoom = new Map();
    for (const r of rects) {
      const a = (r.x1 - r.x0) * (r.y1 - r.y0);
      if (!byRoom.has(r.room) || byRoom.get(r.room).a < a) byRoom.set(r.room, { ...r, a });
    }
    for (const r of level.rooms || []) {
      meta.rooms.push({ id: String(r.id || ''), label: String(r.label || r.type || '').replace(/_/g, ' '), type: String(r.type || ''), level: lv,
        center: [X(num(r.x) + num(r.w) / 2), Z(num(r.y) + num(r.h) / 2)], floorY: y0,
        rect: [X(num(r.x)), X(num(r.x) + num(r.w)), Z(num(r.y)), Z(num(r.y) + num(r.h))] });
    }

    // ---- light slots: a fixture on in every room -------------------------------
    for (const [room, r] of byRoom) {
      const type = String(room.type || '');
      if (STAIR.test(type) && stair) continue; // the opening above is lit from the floor above
      const w = r.x1 - r.x0, d = r.y1 - r.y0;
      const at = [X((r.x0 + r.x1) / 2), y0 + hts.clear, Z((r.y0 + r.y1) / 2)];
      const kind = /closet|storage/.test(type) ? 'closet' : /garage/.test(type) ? 'utility' : /bath|powder/.test(type) ? 'bath' : /kitchen/.test(type) ? 'kitchen' : 'ceiling';
      meta.lights.push({ level: lv, room: String(room.id || ''), type, kind, position: at, size: [w, d], area: w * d });
      const rad = kind === 'closet' ? 0.35 : kind === 'utility' ? 0.7 : 0.55;
      const oct = [...Array(8).keys()].map((i) => [at[0] + rad * Math.cos((i + 0.5) * Math.PI / 4), at[2] + rad * Math.sin((i + 0.5) * Math.PI / 4)]);
      mb.addPrism(ceilNode, oct, at[1] - 0.18, at[1] - 0.02, (k) => (k === 'ny' ? 'fixture' : 'metal'));
    }

    // ---- walls, cut by doors and windows ------------------------------------
    const lines = new Map(); // 'h:y' | 'v:x' -> [[a,b]...]
    const addLine = (dir, k, a, b) => { const key = `${dir}:${+k.toFixed(3)}`; if (!lines.has(key)) lines.set(key, []); lines.get(key).push([Math.min(a, b), Math.max(a, b)]); };
    for (const r of rects) { addLine('h', r.y0, r.x0, r.x1); addLine('h', r.y1, r.x0, r.x1); addLine('v', r.x0, r.y0, r.y1); addLine('v', r.x1, r.y0, r.y1); }

    const openings = [];
    for (const d of level.doors || []) {
      const w = num(d.width ?? d.doorWidth, 3);
      const kind = d.garageDoor ? 'garage' : d.slidingDoor ? 'sliding' : (d.openThreshold || d.stairEndpoint) ? 'cased' : String(d.b) === '__exterior__' || String(d.a) === '__exterior__' ? 'exterior' : 'door';
      openings.push({ dir: d.dir === 'vertical' ? 'v' : 'h', k: d.dir === 'vertical' ? num(d.x) : num(d.y), c: d.dir === 'vertical' ? num(d.y) : num(d.x), w, kind, main: Boolean(d.isMainEntry), head: doorHeight(d, level.rooms || []), sill: 0, swing: doorSwingSign(d, level.rooms || []) });
      // Every door, for the bake's styling to keep clear of (engine feet).
      const exterior = String(d.b) === '__exterior__' || String(d.a) === '__exterior__';
      meta.doors.push({ id: d.id ?? null, level: lv, position: [X(num(d.x)), Z(num(d.y))], width: w, alongX: d.dir !== 'vertical', exterior, kind });
    }
    for (const win of level.windows || []) {
      const w = num(win.width ?? win.windowWidth, 4);
      const room = (level.rooms || []).find(r => String(r.id) === String(win.roomId)) || roomAt(num(win.x) + 0.01, num(win.y) + 0.01) || roomAt(num(win.x) - 0.01, num(win.y) - 0.01);
      openings.push({ dir: win.dir === 'vertical' ? 'v' : 'h', k: win.dir === 'vertical' ? num(win.x) : num(win.y), c: win.dir === 'vertical' ? num(win.y) : num(win.x), w, kind: 'window', ...windowHeights(win, room) });
    }
    // The front entrance: glass sidelights either side of the door when the wall
    // beside it is solid exterior wall of the same room with no other opening
    // near, and a transom above when the ceiling leaves room. The plan's door
    // (its width, swing and position) is unchanged; only the 3D opening grows.
    for (const o of openings) {
      if (!o.main || o.kind !== 'exterior') continue;
      const sides = (s) => (o.dir === 'h' ? [roomAt(s, o.k - 0.25), roomAt(s, o.k + 0.25)] : [roomAt(o.k - 0.25, s), roomAt(o.k + 0.25, s)]);
      const [a0, b0] = sides(o.c);
      const inside = a0 || b0;
      if (!inside || (a0 && b0)) continue;
      // The widest sidelights that fit (none in a very narrow hall); the entrance
      // gets its door, transom and surround either way.
      const fits = (sw) => {
        const lo = o.c - o.w / 2 - sw, hi = o.c + o.w / 2 + sw;
        const near = openings.some((q) => q !== o && q.dir === o.dir && Math.abs(q.k - o.k) < 0.01 && q.c + q.w / 2 > lo - 0.4 && q.c - q.w / 2 < hi + 0.4);
        return !near && [lo - 0.3, lo, (lo + o.c) / 2, (o.c + hi) / 2, hi, hi + 0.3]
          .every((s) => { const [a, b] = sides(s); return (a || b) === inside && !(a && b); });
      };
      const sw = [SIDELIGHT, 1.0, 0.75].find(fits) || 0;
      o.doorW = o.w; o.doorHead = o.head;
      o.w += 2 * sw; o.kind = 'entry';
      if (hts.clear - o.head >= 0.9) o.head = Math.min(hts.clear - 0.3, o.head + 1.1);
    }
    if (openings.some(o => !(o.w > 0 && o.sill >= 0 && o.head > o.sill && o.head <= hts.clear))) {
      throw Object.assign(new Error(`Opening heights on level ${lv} must fit below its ceiling.`), { code: 'MODEL_OPENING_INVALID' });
    }

    const accent = palette._hasAccent && idx === 0;
    const siding = palette._siding;
    for (const [key, intervals] of lines) {
      const [dir, kStr] = key.split(':');
      const k = Number(kStr);
      const P = (s, y, d) => (dir === 'h' ? [X(s), y, Z(k) + d] : [X(k) + d, y, Z(s)]);
      const pts = [...new Set(intervals.flat())].sort((a, b) => a - b);
      // elementary pieces, merged into runs of the same kind
      const pieces = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], m = (a + b) / 2;
        if (!intervals.some(([p, q]) => p <= m && q >= m)) continue;
        const neg = dir === 'h' ? roomAt(m, k - 0.25) : roomAt(k - 0.25, m);
        const pos = dir === 'h' ? roomAt(m, k + 0.25) : roomAt(k + 0.25, m);
        if (!neg && !pos) continue;
        const cls = neg && pos ? 0 : neg ? 1 : -1; // exterior side sign
        const kind = cls ? 'ext' : boundaryKind(neg, pos, ctx);
        if (kind === 'none') continue;
        const bare = [neg, pos].map((r) => !r || /garage/.test(String(r.type || ''))); // no baseboard on that side
        const last = pieces[pieces.length - 1];
        if (last && last.cls === cls && last.kind === kind && Math.abs(last.b - a) < EPS) { last.b = b; last.parts.push({ a, b, bare }); }
        else pieces.push({ a, b, cls, kind, parts: [{ a, b, bare }] });
      }
      for (const run of pieces) {
        if (run.kind === 'open') continue;
        const ext = run.cls !== 0;
        const t = ext ? WALL_EXT : WALL_INT;
        const H = ext ? (hts.isTop || top ? hts.clear : hts.f2f) : hts.clear;
        // Exterior runs reach past their ends to close the corners; interior
        // runs stop at the wall line and tuck into whatever they meet.
        const a = ext ? run.a - t / 2 : run.a;
        const b = ext ? run.b + t / 2 : run.b;
        const outward = dir === 'h' ? [0, 0, run.cls] : [run.cls, 0, 0];
        const cuts = openings.filter((o) => o.dir === dir && Math.abs(o.k - k) < 0.01 && o.c + o.w / 2 > a && o.c - o.w / 2 < b)
          .map((o) => ({ ...o, a: Math.max(a, o.c - o.w / 2), b: Math.min(b, o.c + o.w / 2) }))
          .sort((p, q) => p.a - q.a);

        if (run.kind === 'rail' || run.kind === 'stringer') {
          addGuard(mb, node, { run, cuts, P, k, dir, y0, stair: run.kind === 'stringer' ? stair : null });
          continue;
        }

        const wallMat = (lowY) => (key2, n) => {
          if (!ext) return 'wall-paint';
          const along = dir === 'h' ? Math.abs(n[0]) : Math.abs(n[2]);
          const out = n[0] * outward[0] + n[2] * outward[2];
          if (out > 0.5 || along > 0.5) return accent && lowY < ACCENT_H - EPS ? 'cladding-accent' : 'cladding';
          return 'wall-paint';
        };
        const piece = (p, q, z0, z1) => {
          if (q - p < EPS || z1 - z0 < EPS) return;
          const bands = accent && ext && z0 < ACCENT_H && z1 > ACCENT_H ? [[z0, ACCENT_H], [ACCENT_H, z1]] : [[z0, z1]];
          for (const [u, v] of bands) mb.addBox(node, P(p, y0 + u, -t / 2), P(q, y0 + v, t / 2), wallMat(u));
          if (z0 < EPS) {
            // baseboards on the room faces
            for (const s of [-1, 1]) {
              if (ext && s === run.cls) continue;
              const d0 = s * t / 2, d1 = s * (t / 2 + 0.05);
              for (const part of run.parts) {
                if (part.bare[s < 0 ? 0 : 1]) continue;
                const lo = Math.max(p, part.a), hi = Math.min(q, part.b);
                if (hi - lo > EPS) mb.addBox(node, P(lo, y0, Math.min(d0, d1)), P(hi, y0 + BASE_H, Math.max(d0, d1)), 'baseboard');
              }
            }
          }
        };
        let cur = a;
        for (const c of cuts) {
          piece(cur, c.a, 0, H);
          const topH = c.head;
          piece(c.a, c.b, Math.min(topH, H), H);
          if (c.kind === 'window') piece(c.a, c.b, 0, c.sill);
          addOpeningDetail(mb, node, { dir, k, a: c.a, b: c.b, t, kind: c.kind, main: c.main, y0, top: topH, sill: c.sill, swing: c.swing, outward, ext, P, cls: run.cls, doorW: c.doorW, doorHead: c.doorHead });
          if (c.kind === 'window') {
            const mid = (c.a + c.b) / 2;
            meta.windows.push({ level: lv, position: dir === 'h' ? [X(mid), Z(k)] : [X(k), Z(mid)], width: c.b - c.a, sill: y0 + c.sill, head: y0 + topH, outward: [outward[0], outward[2]], exterior: ext });
          }
          if (ext && c.kind !== 'window') {
            const mid = (c.a + c.b) / 2;
            const at = dir === 'h' ? [X(mid), Z(k)] : [X(k), Z(mid)];
            // The bake gets the door itself, not the sidelights around it.
            const door = { level: lv, kind: c.kind === 'entry' ? 'exterior' : c.kind, main: c.main, position: at, outward: [outward[0], outward[2]], width: c.doorW ?? c.b - c.a, floorY: y0 };
            meta.exteriorDoors.push(door);
            if (c.main) meta.entry = { level: lv, position: at, inward: [-outward[0], -outward[2]], floorY: y0 };
            // wall lights either side of the entry and over the garage door
            if (c.main || c.kind === 'garage') {
              const sides = c.kind === 'garage' ? [mid] : [c.a - 0.9, c.b + 0.9];
              for (const s of sides) {
                const hgt = c.kind === 'garage' ? topH + 0.9 : 6.2;
                const face = run.cls * (t / 2);
                const d1 = face + run.cls * 0.35;
                mb.addBox(node, P(s - 0.22, y0 + hgt - 0.55, Math.min(face, d1)), P(s + 0.22, y0 + hgt, Math.max(face, d1)), (kk, n) => (Math.abs(n[1]) > 0.5 ? 'metal' : 'fixture'));
                const lp = P(s, y0 + hgt - 0.3, face + run.cls * 0.5);
                meta.lights.push({ level: lv, room: 'exterior', type: 'exterior', kind: 'sconce', position: lp, size: [0.5, 0.5], area: 0, facing: [outward[0], outward[2]] });
              }
            }
          }
          cur = Math.max(cur, c.b);
        }
        piece(cur, b, 0, H);

        // corner boards where lap siding turns a corner
        if (ext && siding) {
          const base = accent ? ACCENT_H : 0;
          const s = run.cls;
          for (const [p, q] of [[a - 0.04, a + 0.42], [b - 0.42, b + 0.04]]) {
            mb.addBox(node, P(p, y0 + base, Math.min(s * (t / 2 - 0.01), s * (t / 2 + 0.07))), P(q, y0 + H, Math.max(s * (t / 2 - 0.01), s * (t / 2 + 0.07))), 'trim');
          }
        }
      }
    }

    // ---- stairs -----------------------------------------------------------
    // Built once, from the level they climb out of; the floor above gets the
    // matching opening and a guard rail around it.
    if (stair) {
      for (const f of stair.flights) {
        const alongX = Math.abs(f.to.x - f.from.x) >= Math.abs(f.to.y - f.from.y);
        const run = alongX ? f.to.x - f.from.x : f.to.y - f.from.y;
        const treads = Math.max(1, f.risers - 1);
        const tread = run / treads;
        const rise = (f.toZ - f.fromZ) / f.risers;
        const dirSign = Math.sign(run) || 1;
        for (let i = 1; i <= treads; i++) {
          const s0 = (alongX ? f.from.x : f.from.y) + (i - 1) * tread, s1 = s0 + tread;
          const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
          const topY = y0 + f.fromZ + i * rise;
          const q = alongX ? { x0: lo, x1: hi, y0: f.rect.y0, y1: f.rect.y1 } : { x0: f.rect.x0, x1: f.rect.x1, y0: lo, y1: hi };
          // riser body in paint-grade white, a wood tread with a small nosing on top
          mb.addBox(node, [X(q.x0), y0 + f.fromZ, Z(q.y0)], [X(q.x1), topY - 0.09, Z(q.y1)], 'stair-riser');
          const nose = 0.08 * -dirSign;
          const tq = alongX ? { ...q, x0: q.x0 + Math.min(0, nose), x1: q.x1 + Math.max(0, nose) } : { ...q, y0: q.y0 + Math.min(0, nose), y1: q.y1 + Math.max(0, nose) };
          mb.addBox(node, [X(tq.x0), topY - 0.09, Z(tq.y0)], [X(tq.x1), topY, Z(tq.y1)], 'stair');
        }
        meta.stairPath.push({ from: [X(f.from.x), y0 + f.fromZ, Z(f.from.y)], to: [X(f.to.x), y0 + f.toZ, Z(f.to.y)] });
      }
      for (const l of stair.landings) {
        if (l.z > EPS) {
          mb.addBox(node, [X(l.rect.x0), y0, Z(l.rect.y0)], [X(l.rect.x1), y0 + l.z - 0.09, Z(l.rect.y1)], 'stair-riser');
          mb.addBox(node, [X(l.rect.x0), y0 + l.z - 0.09, Z(l.rect.y0)], [X(l.rect.x1), y0 + l.z, Z(l.rect.y1)], 'stair');
        }
      }
      const fo = lay.floorOpening;
      if (fo) lowerOpening.set(num(levels[idx + 1].level, idx + 2), { x0: num(fo.x), y0: num(fo.y), x1: num(fo.x) + num(fo.w), y1: num(fo.y) + num(fo.h) });
    }

    // ---- furniture ----------------------------------------------------------
    // Simple stand-ins for the instant model, plus a slot per piece that the
    // Blender bake swaps for a real model.
    if (include.furniture) {
      const byId = new Map((level.rooms || []).map((r) => [r.id, r]));
      const worldRect = (it) => ({ x0: X(num(it.x)), x1: X(num(it.x) + num(it.w)), z0: Z(num(it.y)), z1: Z(num(it.y) + num(it.h)) });
      // Is this stretch of a room's wall (world feet along it) a real wall with no
      // door or window? Art, mirrors, upper cabinets and hoods only go on those.
      const wallClear = (room) => (side, wa, wb) => {
        const horizontal = side === 'n' || side === 's';
        const lo = Math.min(wa, wb) + (horizontal ? cx : cz), hi = Math.max(wa, wb) + (horizontal ? cx : cz);
        const line = side === 'n' ? num(room.y) : side === 's' ? num(room.y) + num(room.h) : side === 'w' ? num(room.x) : num(room.x) + num(room.w);
        const dir = horizontal ? 'h' : 'v', out = side === 'n' || side === 'w' ? -0.25 : 0.25;
        if (openings.some((o) => o.dir === dir && Math.abs(o.k - line) < 0.3 && o.c + o.w / 2 > lo - 0.25 && o.c - o.w / 2 < hi + 0.25)) return false;
        for (let s = lo; s <= hi + EPS; s += Math.max(0.5, (hi - lo) / 6)) {
          const self = horizontal ? roomAt(s, line - out) : roomAt(line - out, s);
          const other = horizontal ? roomAt(s, line + out) : roomAt(line + out, s);
          if (self !== room) return false;
          if (other && boundaryKind(other, room, ctx) !== 'wall') return false;
        }
        return true;
      };
      // Door zones (3 ft each side of every doorway), for free-standing dressing.
      const doorZones = (level.doors || []).map((d) => {
        const w = num(d.width, 3), vertical = d.dir === 'vertical';
        return vertical ? { x0: X(num(d.x) - 3), x1: X(num(d.x) + 3), z0: Z(num(d.y) - w / 2), z1: Z(num(d.y) + w / 2) }
          : { x0: X(num(d.x) - w / 2), x1: X(num(d.x) + w / 2), z0: Z(num(d.y) - 3), z1: Z(num(d.y) + 3) };
      });
      const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
      for (const it of level.furniture || []) {
        const room = byId.get(it.roomId);
        const rr = room ? { x0: X(num(room.x)), x1: X(num(room.x) + num(room.w)), z0: Z(num(room.y)), z1: Z(num(room.y) + num(room.h)) } : null;
        const rect = worldRect(it);
        if (rect.x1 - rect.x0 < EPS || rect.z1 - rect.z0 < EPS) continue;
        const kind = String(it.kind || '').replace(/_\d+$/, '');
        const placement = { kind, rect, rotation: it.rotation, back: it.back, closetFront: room?.type === 'closet' ? room.closetFront : undefined };
        const siblings = (level.furniture || []).filter((o) => o !== it && String(o.roomId) === String(it.roomId))
          .map((o) => ({ kind: String(o.kind || '').replace(/_\d+$/, ''), rect: worldRect(o) }));
        const furnishing = room ? {
          roomType: String(room.type || ''), ceiling: hts.clear, siblings,
          wallClear: wallClear(room),
          free: (q) => q.x0 > rr.x0 + 0.3 && q.x1 < rr.x1 - 0.3 && q.z0 > rr.z0 + 0.3 && q.z1 < rr.z1 - 0.3 &&
            !doorZones.some((z) => hit(q, z)) && !siblings.some((o) => hit(q, o.rect)) && !hit(q, rect),
          // What the instant model adds beyond the plan, for the photoreal bake to match.
          record: (d) => meta.dressing.push({ ...d, level: lv, room: String(it.roomId || ''), roomType: String(room.type || ''), item: kind, floorY: y0, itemRect: rect }),
        } : {};
        addFurniture(mb, furnNode, placement, rr || rect, y0, furnishing);
        meta.furniture.push({
          kind, level: lv, room: String(it.roomId || ''), roomType: String(room?.type || ''),
          center: [(rect.x0 + rect.x1) / 2, y0, (rect.z0 + rect.z1) / 2],
          size: [rect.x1 - rect.x0, rect.z1 - rect.z0], against: furnitureSide(placement, rr || rect),
        });
      }
    }
  });

  // ---- roofs ---------------------------------------------------------------
  // A rectangular storey gets one roof. An L, T or stepped storey is split
  // into its main rectangles, each with its own roof, so they intersect the
  // way a cross-gable or cross-hip house does. Parts of a lower storey not
  // covered by the one above (a garage wing, a bay) get low hip roofs, or
  // flat roofs on a flat-roof style.
  if (include.roof) {
    const style = roofStyle(planSpec, options);
    meta.roof = style;
    const piece = (r, eaveY, st, opts) => addRoof(mb, { x0: X(r.x0), x1: X(r.x1), z0: Z(r.y0), z1: Z(r.y1), eaveY }, st, opts);
    levels.forEach((level, idx) => {
      const hts = levelHeights(planSpec, level, idx);
      const above = levels[idx + 1];
      const rects = roomRects(level);
      if (above) {
        const exposed = subtractAll(rects.map((r) => ({ ...r })), roomRects(above));
        if (!exposed.length) return;
        const eaveY = hts.floorZ + hts.f2f;
        if (style.type === 'flat') {
          for (const r of exposed) mb.addBox('Roof', [X(r.x0) - 0.3, eaveY, Z(r.y0) - 0.3], [X(r.x1) + 0.3, eaveY + 0.6, Z(r.y1) + 0.3], (k) => (k === 'py' ? 'roof' : 'trim'));
          return;
        }
        for (const r of coverRects(exposed, 24)) piece(r, eaveY, { ...style, type: 'hip', overhang: Math.min(style.overhang, 1.5) }, { downspouts: false });
        return;
      }
      const eaveY = hts.floorZ + hts.clear;
      const parts = coverRects(rects, 40);
      if (parts.length <= 1) {
        const x0 = Math.min(...rects.map((r) => r.x0)), x1 = Math.max(...rects.map((r) => r.x1));
        const y0 = Math.min(...rects.map((r) => r.y0)), y1 = Math.max(...rects.map((r) => r.y1));
        piece({ x0, x1, y0, y1 }, eaveY, style);
        return;
      }
      meta.roof = { ...style, pieces: parts.length };
      parts.forEach((r, i) => piece(r, eaveY, i === 0 ? style : { ...style, type: style.type === 'flat' ? 'flat' : 'hip' }, { downspouts: i === 0 }));
    });
  }

  // ---- site: driveway, walk, a porch at the front door, planting --------------
  // Illustrative site dressing, not plan content: the survey sets no paving or
  // porch, so everything here is published in meta.site (and planting in
  // meta.dressing) for the photoreal bake to reproduce, and labelled as such.
  // The owner asked for a porch (2026-09-28): a raised floor with two steps, two
  // posts and a flat canopy just above the door head, on the Site node (not the
  // roof, which the quick views hide).
  if (include.site) {
    meta.site = { illustrative: true, paving: [], porch: null };
    const pave = (kind, [ax, az, bx, bz], top, mat) => {
      mb.addBox('Site', [ax, GRADE - 0.3, az], [bx, top, bz], (k) => (k === 'py' ? mat : 'foundation'));
      meta.site.paving.push({ kind, rect: [ax, bx, az, bz] });
    };
    for (const d of meta.exteriorDoors) {
      if (d.level !== meta.levels[0].level) continue;
      const [ox, oz] = d.outward;
      const [px, pz] = d.position;
      const w = d.width;
      const rect = (depth0, depth1, half) => {
        const a = [px + ox * depth0, pz + oz * depth0], b = [px + ox * depth1, pz + oz * depth1];
        const sx = Math.abs(oz) * half, sz = Math.abs(ox) * half;
        return [Math.min(a[0], b[0]) - sx, Math.min(a[1], b[1]) - sz, Math.max(a[0], b[0]) + sx, Math.max(a[1], b[1]) + sz];
      };
      if (d.kind === 'garage') {
        pave('driveway', rect(WALL_EXT / 2, 26, w / 2 + 1), GRADE + 0.12, 'driveway');
      } else if (d.main) {
        const deep = 6, half = w / 2 + SIDELIGHT + 2.5;
        pave('stoop', rect(WALL_EXT / 2, deep, half), d.floorY - 0.06, 'walkway');
        // Two steps down to the walk, then the walk itself.
        const rise = (d.floorY - 0.06 - GRADE) / 3;
        pave('steps', rect(deep, deep + 1, Math.min(half, 3)), GRADE + rise * 2, 'walkway');
        pave('steps', rect(deep + 1, deep + 2, Math.min(half, 3)), GRADE + rise, 'walkway');
        pave('walk', rect(deep + 2, deep + 16, 2), GRADE + 0.08, 'walkway');
        // Posts at the outer corners and a canopy over the whole porch.
        const lv1 = meta.levels[0], head = Math.min(lv1.ceilingY - 0.1, d.floorY + 8.9);
        const posts = [-1, 1].map((s) => {
          const c = [px + ox * (deep - 0.6) + Math.abs(oz) * s * (half - 0.6), pz + oz * (deep - 0.6) + Math.abs(ox) * s * (half - 0.6)];
          mb.addBox('Site', [c[0] - 0.3, d.floorY - 0.06, c[1] - 0.3], [c[0] + 0.3, head, c[1] + 0.3], 'trim');
          return c;
        });
        const [cx0, cz0, cx1, cz1] = rect(WALL_EXT / 2, deep + 0.4, half + 0.4);
        mb.addBox('Site', [cx0, head, cz0], [cx1, head + 0.45, cz1], (k) => (k === 'py' ? 'roof' : k === 'ny' ? 'soffit' : 'trim'));
        meta.site.porch = { illustrative: true, floor: rect(WALL_EXT / 2, deep, half), floorY: d.floorY - 0.06,
          canopy: [cx0, cx1, cz0, cz1], canopyY: [head, head + 0.45], posts, outward: [ox, oz] };
        // Low shrubs along the front wall either side of the porch, off the paving.
        const paving = meta.site.paving.map((p) => p.rect);
        const clearOf = (x, z, r) => !paving.some(([ax, bx, az, bz]) => x + r > ax - 0.5 && x - r < bx + 0.5 && z + r > az - 0.5 && z - r < bz + 0.5);
        const facade = Math.abs(oz) > 0.5 ? [-W / 2 + 1.5, W / 2 - 1.5] : [-D / 2 + 1.5, D / 2 - 1.5];
        for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
          const along = s * (half + 1.4 + i * 2.6);
          const x = px + ox * 1.6 + Math.abs(oz) * along, z = pz + oz * 1.6 + Math.abs(ox) * along;
          const a = Math.abs(oz) > 0.5 ? x : z;
          if (a < facade[0] || a > facade[1] || !clearOf(x, z, 1)) continue;
          const oct = (r0, y0, y1, mat) => mb.addPrism('Furniture 1', [...Array(8).keys()].map((k) => [x + r0 * Math.cos((k + 0.5) * Math.PI / 4), z + r0 * Math.sin((k + 0.5) * Math.PI / 4)]), y0, y1, mat);
          oct(1.0, GRADE, GRADE + 0.15, 'soil');
          oct(0.85, GRADE + 0.15, GRADE + 1.6, i % 2 ? 'plant-dark' : 'plant');
          oct(0.6, GRADE + 1.6, GRADE + 2.2, i % 2 ? 'plant' : 'plant-dark');
          meta.dressing.push({ kind: 'shrub', level: d.level, room: 'exterior', rect: { x0: x - 1, x1: x + 1, z0: z - 1, z1: z + 1 }, y0: GRADE, y1: GRADE + 2.2 });
        }
      }
    }
    // Outdoor living from the survey (level.outdoor, outdoorLiving.js): plan
    // content, not dressing. A patio at grade; a deck or porch at the ground
    // floor's level; rails on a deck's open sides; posts and a roof over a
    // covered or screened porch, screens between the posts of the latter.
    // Published in meta.site.outdoor for the photoreal bake.
    meta.site.outdoor = [];
    const lv1 = meta.levels[0];
    const ground = levels.find((l) => num(l.level) === lv1.level);
    for (const o of ground?.outdoor || []) {
      const x0 = X(num(o.x)), x1 = X(num(o.x) + num(o.w)), z0 = Z(num(o.y)), z1 = Z(num(o.y) + num(o.h));
      const deck = o.type === 'open_deck';
      const floorY = o.type === 'patio' ? GRADE + 0.15 : lv1.floorY - 0.1;
      mb.addBox('Site', [x0, GRADE - 0.3, z0], [x1, floorY, z1], (k) => (k === 'py' ? (deck ? 'wood' : 'walkway') : deck ? 'wood-dark' : 'foundation'));
      // The three open edges (the fourth is against the house wall).
      const edges = [['z', z0, x0, x1], ['z', z1, x0, x1], ['x', x0, z0, z1], ['x', x1, z0, z1]].filter(([axis, at]) =>
        !((o.side === 'top' && axis === 'z' && at === z1) || (o.side === 'bottom' && axis === 'z' && at === z0) ||
          (o.side === 'left' && axis === 'x' && at === x1) || (o.side === 'right' && axis === 'x' && at === x0)));
      const bar = ([axis, at, a, b], y0, y1, t, mat) => (axis === 'z'
        ? mb.addBox('Site', [a, y0, at - t / 2], [b, y1, at + t / 2], mat)
        : mb.addBox('Site', [at - t / 2, y0, a], [at + t / 2, y1, b], mat));
      const head = Math.min(lv1.ceilingY - 0.1, lv1.floorY + 8.5);
      if (deck) for (const e of edges) { bar(e, floorY + 2.8, floorY + 3.1, 0.25, 'trim'); bar(e, floorY, floorY + 3.1, 0.08, 'trim'); }
      if (o.covered) {
        const posts = [];
        for (const [axis, at, a, b] of edges) {
          const n = Math.max(1, Math.ceil((b - a) / 10));
          for (let i = 0; i <= n; i++) {
            const t = a + 0.3 + (b - a - 0.6) * i / n;
            const [px, pz] = axis === 'z' ? [t, at] : [at, t];
            if (posts.some(([qx, qz]) => Math.hypot(qx - px, qz - pz) < 1)) continue;
            posts.push([px, pz]);
            mb.addBox('Site', [px - 0.3, floorY, pz - 0.3], [px + 0.3, head, pz + 0.3], 'trim');
          }
        }
        mb.addBox('Site', [x0 - 0.4, head, z0 - 0.4], [x1 + 0.4, head + 0.45, z1 + 0.4], (k) => (k === 'py' ? 'roof' : k === 'ny' ? 'soffit' : 'trim'));
        if (o.screened) for (const e of edges) bar(e, floorY + 0.3, head, 0.06, 'screen');
      }
      meta.site.outdoor.push({ type: o.type, rect: [x0, x1, z0, z1], floorY, covered: Boolean(o.covered), screened: Boolean(o.screened),
        side: o.side, ...(o.covered ? { roofY: [head, head + 0.45] } : {}) });
    }
  }

  return { builder: mb, meta, stats: mb.stats(), palette };
}

// Guard rail along a stairwell edge on the floor above ("rail"), or a
// stringer knee wall with a sloped rail beside a flight ("stringer").
function addGuard(mb, node, g) {
  const { run, cuts, P, k, dir, y0, stair } = g;
  const segs = [];
  let cur = run.a;
  for (const c of cuts) { if (c.a > cur + EPS) segs.push([cur, c.a]); cur = Math.max(cur, c.b); }
  if (run.b > cur + EPS) segs.push([cur, run.b]);
  const base = (s) => {
    if (!stair) return 0;
    const h = dir === 'h' ? stair.surface(s, k) : stair.surface(k, s);
    return h == null ? null : h;
  };
  const t = WALL_INT;
  for (const [p, q] of segs) {
    const n = Math.max(1, Math.ceil((q - p) / 0.5));
    const samples = [...Array(n + 1).keys()].map((i) => p + (q - p) * i / n);
    const hs = samples.map(base);
    // knee wall under a sloped rail, following the flight
    if (stair) {
      for (let i = 0; i < n; i++) {
        const h0 = hs[i], h1 = hs[i + 1];
        if (h0 == null || h1 == null || Math.max(h0, h1) < 0.25) continue;
        const s0 = samples[i], s1 = samples[i + 1];
        const hex = [P(s0, y0, -t / 2), P(s1, y0, -t / 2), P(s1, y0, t / 2), P(s0, y0, t / 2),
          P(s0, y0 + h0, -t / 2), P(s1, y0 + h1, -t / 2), P(s1, y0 + h1, t / 2), P(s0, y0 + h0, t / 2)];
        mb.addHex(node, hex, 'wall-paint');
        const cap = [P(s0, y0 + h0, -t / 2 - 0.05), P(s1, y0 + h1, -t / 2 - 0.05), P(s1, y0 + h1, t / 2 + 0.05), P(s0, y0 + h0, t / 2 + 0.05),
          P(s0, y0 + h0 + 0.12, -t / 2 - 0.05), P(s1, y0 + h1 + 0.12, -t / 2 - 0.05), P(s1, y0 + h1 + 0.12, t / 2 + 0.05), P(s0, y0 + h0 + 0.12, t / 2 + 0.05)];
        mb.addHex(node, cap, 'trim');
      }
    } else {
      mb.addBox(node, P(p, y0, -0.18), P(q, y0 + 0.14, 0.18), 'trim'); // shoe rail on the floor edge
    }
    const off = stair ? 0.12 : 0.14;
    // balusters
    const nb = Math.max(1, Math.round((q - p) / BALUSTER_GAP));
    for (let i = 0; i <= nb; i++) {
      const s = p + (q - p) * i / nb;
      const h = base(s);
      if (h == null || (stair && h < 0.25)) continue;
      mb.addBox(node, P(s - 0.05, y0 + h + off, -0.05), P(s + 0.05, y0 + h + RAIL_H - 0.1, 0.05), 'trim');
    }
    // handrail, piecewise along the slope
    for (let i = 0; i < n; i++) {
      const h0 = hs[i], h1 = hs[i + 1];
      if (h0 == null || h1 == null || (stair && Math.max(h0, h1) < 0.25)) continue;
      const s0 = samples[i], s1 = samples[i + 1];
      const r0 = y0 + h0 + RAIL_H - 0.1, r1 = y0 + h1 + RAIL_H - 0.1;
      mb.addHex(node, [P(s0, r0, -0.12), P(s1, r1, -0.12), P(s1, r1, 0.12), P(s0, r0, 0.12),
        P(s0, r0 + 0.2, -0.12), P(s1, r1 + 0.2, -0.12), P(s1, r1 + 0.2, 0.12), P(s0, r0 + 0.2, 0.12)], 'handrail');
    }
    // newel posts at both ends
    for (const s of [p, q]) {
      const h = base(s);
      if (h == null) continue;
      const c = Math.min(Math.max(s, p + 0.2), q - 0.2);
      mb.addBox(node, P(c - 0.2, y0 + h, -0.2), P(c + 0.2, y0 + h + RAIL_H + 0.35, 0.2), 'handrail');
    }
  }
}

function addOpeningDetail(mb, node, o) {
  const { k, a, b, t, kind, y0, top, sill, swing, outward, ext, P, dir, cls, doorW, doorHead } = o;
  const along = (p, q, zlo, zhi, dLo, dHi, mat) => mb.addBox(node, P(p, y0 + zlo, Math.min(dLo, dHi)), P(q, y0 + zhi, Math.max(dLo, dHi)), mat);
  const half = t / 2 + 0.06;
  const outS = ext ? cls : 0; // +1 / -1 toward the outside for exterior walls
  if (kind === 'window') {
    const mid = (sill + top) / 2;
    // two sashes (double-hung look): lower sash sits inboard of the upper one
    along(a + 0.12, b - 0.12, sill + 0.1, mid + 0.06, -0.03 - 0.06 * outS, 0.03 - 0.06 * outS, 'glass');
    along(a + 0.12, b - 0.12, mid - 0.06, top - 0.1, -0.03 + 0.06 * outS, 0.03 + 0.06 * outS, 'glass');
    along(a, a + 0.14, sill, top, -0.14, 0.14, 'window-frame');
    along(b - 0.14, b, sill, top, -0.14, 0.14, 'window-frame');
    along(a, b, sill, sill + 0.14, -0.14, 0.14, 'window-frame');
    along(a, b, top - 0.14, top, -0.14, 0.14, 'window-frame');
    along(a + 0.12, b - 0.12, mid - 0.07, mid + 0.07, -0.12, 0.12, 'window-frame'); // meeting rail
    if (b - a >= 4) along((a + b) / 2 - 0.06, (a + b) / 2 + 0.06, sill, top, -0.12, 0.12, 'window-frame');
    if (ext) {
      const f = outS * t / 2, g = outS * (t / 2 + 0.08);
      along(a - 0.35, a, sill, top + 0.1, f, g, 'trim');           // side casings
      along(b, b + 0.35, sill, top + 0.1, f, g, 'trim');
      along(a - 0.45, b + 0.45, top + 0.1, top + 0.55, f, g, 'trim'); // head
      along(a - 0.55, b + 0.55, top + 0.55, top + 0.65, f, outS * (t / 2 + 0.16), 'trim'); // drip cap
      along(a - 0.45, b + 0.45, sill - 0.16, sill, f - outS * 0.1, outS * (t / 2 + 0.25), 'trim'); // sill
      const fi = -outS * t / 2, gi = -outS * (t / 2 + 0.06);
      along(a - 0.28, a, sill - 0.1, top + 0.28, fi, gi, 'trim');   // interior casing
      along(b, b + 0.28, sill - 0.1, top + 0.28, fi, gi, 'trim');
      along(a - 0.28, b + 0.28, top, top + 0.28, fi, gi, 'trim');
      along(a - 0.38, b + 0.38, sill - 0.1, sill, fi + outS * 0.05, -outS * (t / 2 + 0.2), 'trim'); // stool
      along(a - 0.28, b + 0.28, sill - 0.45, sill - 0.1, fi, gi, 'trim');                        // apron
    }
    return;
  }
  // jambs and casing on both faces
  along(a, b, top, top + 0.02, -t / 2, t / 2, 'trim');
  along(a, a + 0.06, 0, top, -t / 2, t / 2, 'trim');
  along(b - 0.06, b, 0, top, -t / 2, t / 2, 'trim');
  for (const s of [-1, 1]) {
    const f = s * t / 2, g = s * (t / 2 + 0.06);
    along(a - 0.3, a, 0, top + 0.3, f, g, 'trim');
    along(b, b + 0.3, 0, top + 0.3, f, g, 'trim');
    along(a - 0.3, b + 0.3, top, top + 0.3, f, g, 'trim');
  }
  if (kind === 'garage') {
    along(a + 0.06, b - 0.06, 0, top, -0.08 * outS - 0.04, -0.08 * outS + 0.04, 'garage-door');
    for (let i = 1; i < 4; i++) along(a + 0.06, b - 0.06, top * i / 4 - 0.04, top * i / 4 + 0.04, outS * 0.02, outS * 0.1, 'garage-door');
    along(a + 0.5, b - 0.5, top * 0.78, top * 0.93, outS * 0.02, outS * 0.1, 'glass');
    return;
  }
  if (kind === 'cased') return;
  if (kind === 'entry') {
    // Sidelights, a transom and the front door (open, as every door is drawn).
    const dA = a + (b - a - doorW) / 2, dB = dA + doorW, dTop = doorHead;
    const glass = (p, q, z0, z1) => along(p, q, z0, z1, -0.03, 0.03, 'glass');
    for (const [p, q] of [[a + 0.06, dA - 0.08], [dB + 0.08, b - 0.06]].filter(([p0, q0]) => q0 - p0 > 0.4)) {
      along(p, q, 0, 1.0, -0.1, 0.1, 'door-exterior');                     // kick panel
      glass(p + 0.1, q - 0.1, 1.0, dTop - 0.1);
      along(p, p + 0.1, 1.0, dTop, -0.1, 0.1, 'window-frame');
      along(q - 0.1, q, 1.0, dTop, -0.1, 0.1, 'window-frame');
      along(p, q, dTop - 0.1, dTop, -0.1, 0.1, 'window-frame');
      for (const h of [(1 + dTop) / 3 + 0.35, 2 * (1 + dTop) / 3 + 0.1]) along(p, q, h - 0.03, h + 0.03, -0.06, 0.06, 'window-frame');
    }
    if (dA - a > 0.3) for (const m of [dA, dB]) along(m - 0.08, m + 0.08, 0, top, -t / 2, t / 2, 'trim');   // mullions
    if (top - dTop > 0.3) {
      along(a, b, dTop, dTop + 0.12, -t / 2, t / 2, 'trim');                  // transom bar
      glass(a + 0.12, b - 0.12, dTop + 0.12, top - 0.08);
      if (dA - a > 0.3) for (const m of [dA, dB]) along(m - 0.05, m + 0.05, dTop + 0.12, top, -0.08, 0.08, 'window-frame');
    }
    if (ext) {
      // Pilasters and a projecting cornice around the whole entrance, outside.
      const f = outS * t / 2, g = outS * (t / 2 + 0.22);
      along(a - 0.75, a - 0.3, 0, top + 0.3, f, g, 'trim');
      along(b + 0.3, b + 0.75, 0, top + 0.3, f, g, 'trim');
      along(a - 0.95, b + 0.95, top + 0.3, top + 0.75, f, outS * (t / 2 + 0.35), 'trim');
      along(a - 1.1, b + 1.1, top + 0.75, top + 0.9, f, outS * (t / 2 + 0.5), 'trim');
    }
    doorLeaf(mb, node, { ...o, a: dA, b: dB, top: dTop }, 'door-exterior', true);
    return;
  }
  if (kind === 'sliding') {
    // Two glazed leaves in parallel tracks, entirely within the planned span.
    // This is the closed schematic position, matching the plan symbol.
    const mid = (a + b) / 2;
    for (const [left, right, depth] of [[a + 0.06, mid + 0.08, -0.08], [mid - 0.08, b - 0.06, 0.08]]) {
      along(left, right, 0.08, 0.2, depth - 0.04, depth + 0.04, 'window-frame');
      along(left, right, top - 0.2, top - 0.08, depth - 0.04, depth + 0.04, 'window-frame');
      for (const edge of [left, right - 0.12]) along(edge, edge + 0.12, 0.08, top - 0.08, depth - 0.04, depth + 0.04, 'window-frame');
      along(left + 0.12, right - 0.12, 0.2, top - 0.2, depth - 0.02, depth + 0.02, 'glass');
    }
    return;
  }
  doorLeaf(mb, node, o, ext ? 'door-exterior' : 'door', false);
}

// A door leaf swung open 90 degrees, hinged at `a`, with raised panels (or glass
// lites in the upper part for the front door) and a handle.
function doorLeaf(mb, node, o, mat, glazed) {
  const { a, b, t, y0, top, swing, P } = o;
  const s = swing; // same private-room / closet / exterior convention as the plan
  const w = b - a - 0.12;
  const hinge = a + 0.06;
  const face = t / 2 + 0.02;
  // the leaf in its own frame: `u` along the swing (away from the wall), `v` across its thickness
  const leaf = (u0, u1, zlo, zhi, v0, v1, m) => {
    const lo = [hinge + v0, y0 + zlo, s > 0 ? face + u0 : -face - u1];
    const hi = [hinge + v1, y0 + zhi, s > 0 ? face + u1 : -face - u0];
    mb.addBox(node, P(lo[0], lo[1], lo[2]), P(hi[0], hi[1], hi[2]), m);
  };
  if (glazed) {
    // Front door: solid below, three glass lites above, a long bar pull.
    leaf(0, w, 0, top * 0.55, 0, 0.18, mat);
    leaf(0, w, top - 0.35, top - 0.05, 0, 0.18, mat);
    leaf(0, 0.3, top * 0.55, top - 0.35, 0, 0.18, mat);
    leaf(w - 0.3, w, top * 0.55, top - 0.35, 0, 0.18, mat);
    const lites = 3, span = (w - 0.6 - 0.1 * (lites - 1)) / lites;
    for (let i = 0; i < lites; i++) {
      const u0 = 0.3 + i * (span + 0.1);
      leaf(u0, u0 + span, top * 0.55, top - 0.35, 0.07, 0.11, 'glass');
      if (i) leaf(u0 - 0.1, u0, top * 0.55, top - 0.35, 0, 0.18, mat);
    }
    for (const [z0, z1] of [[0.6, top * 0.5]]) {
      leaf(0.35, w - 0.35, z0, z1, -0.03, 0, mat);
      leaf(0.35, w - 0.35, z0, z1, 0.18, 0.21, mat);
    }
    leaf(w - 0.5, w - 0.4, 2.6, 5.0, -0.2, -0.05, 'chrome');
    leaf(w - 0.5, w - 0.4, 2.6, 5.0, 0.23, 0.38, 'chrome');
    return;
  }
  leaf(0, w, 0, top - 0.05, 0, 0.15, mat);
  // raised panels on both faces, and a knob
  for (const [z0, z1] of [[0.6, top * 0.42], [top * 0.5, top - 0.6]]) {
    leaf(0.35, w - 0.35, z0, z1, -0.03, 0, mat);
    leaf(0.35, w - 0.35, z0, z1, 0.15, 0.18, mat);
  }
  leaf(w - 0.45, w - 0.3, 3.0, 3.15, -0.12, 0.27, 'metal');
}

function addRoof(mb, box, style, opts = {}) {
  const { x0, x1, z0, z1, eaveY } = box;
  const withDownspouts = opts.downspouts !== false;
  const o = style.overhang, p = style.pitch, T = 0.45;
  const slope = Math.sqrt(1 + p * p);
  const wx0 = x0 - WALL_EXT / 2, wx1 = x1 + WALL_EXT / 2, wz0 = z0 - WALL_EXT / 2, wz1 = z1 + WALL_EXT / 2; // outer wall faces
  const downspout = (x, z, yTop) => mb.addBox('Roof', [x - 0.13, GRADE, z - 0.13], [x + 0.13, yTop, z + 0.13], 'gutter');
  if (style.type === 'flat') {
    mb.addBox('Roof', [x0 - o, eaveY, z0 - o], [x1 + o, eaveY + 0.8, z1 + o], (k) => (k === 'py' ? 'roof' : 'trim'));
    // parapet coping ring
    for (const [a, b] of [[[x0 - o, z0 - o], [x1 + o, z0 - o + 0.5]], [[x0 - o, z1 + o - 0.5], [x1 + o, z1 + o]], [[x0 - o, z0 - o], [x0 - o + 0.5, z1 + o]], [[x1 + o - 0.5, z0 - o], [x1 + o, z1 + o]]]) {
      mb.addBox('Roof', [a[0], eaveY + 0.8, a[1]], [b[0], eaveY + 1.6, b[1]], 'trim');
    }
    for (const [x, z] of [[wx0 - 0.2, wz0 - 0.2], [wx1 + 0.2, wz1 + 0.2]]) downspout(x, z, eaveY + 0.4);
    return;
  }
  const alongX = (x1 - x0) >= (z1 - z0);
  // Work in (u = along ridge, v = across) and map back.
  const [u0, u1, v0, v1] = alongX ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
  const [wu0, wu1, wv0, wv1] = alongX ? [wx0, wx1, wz0, wz1] : [wz0, wz1, wx0, wx1];
  const PP = (u, y, v) => (alongX ? [u, y, v] : [v, y, u]);
  const half = (v1 - v0) / 2, vm = (v0 + v1) / 2;
  const ridgeY = eaveY + (half + WALL_EXT / 2) * p;
  const lowY = eaveY - (o - WALL_EXT / 2) * p;
  const U = (pt) => (alongX ? pt[0] : pt[2]), V = (pt) => (alongX ? pt[2] : pt[0]);
  // roofing UVs: u along the eave, v up the slope, both true length in meters
  const uvAlong = (eaveV) => (pt, n, key) => (key === 'py' ? [U(pt) * FT, Math.abs(V(pt) - eaveV) * slope * FT] : null);
  const uvAcross = (eaveU) => (pt, n, key) => (key === 'py' ? [V(pt) * FT, Math.abs(U(pt) - eaveU) * slope * FT] : null);
  const slab = (quad, uv) => mb.addHex('Roof', [...quad, ...quad.map(([x, y, z]) => [x, y + T, z])], (k) => (k === 'py' ? 'roof' : 'trim'), uv);
  const ea = o; // eave edge offset from the room line
  const eaves = []; // [u or v fixed, from, to, axis('u' edge runs along u)]
  if (style.type === 'hip') {
    const ru0 = u0 + half, ru1 = Math.max(u1 - half, ru0);
    slab([PP(u0 - ea, lowY, v0 - ea), PP(u1 + ea, lowY, v0 - ea), PP(ru1, ridgeY, vm), PP(ru0, ridgeY, vm)], uvAlong(v0 - ea));
    slab([PP(u0 - ea, lowY, v1 + ea), PP(u1 + ea, lowY, v1 + ea), PP(ru1, ridgeY, vm), PP(ru0, ridgeY, vm)], uvAlong(v1 + ea));
    slab([PP(u0 - ea, lowY, v0 - ea), PP(u0 - ea, lowY, v1 + ea), PP(ru0, ridgeY, vm), PP(ru0, ridgeY, vm)], uvAcross(u0 - ea));
    slab([PP(u1 + ea, lowY, v0 - ea), PP(u1 + ea, lowY, v1 + ea), PP(ru1, ridgeY, vm), PP(ru1, ridgeY, vm)], uvAcross(u1 + ea));
    eaves.push(['v', v0 - ea, -1], ['v', v1 + ea, 1], ['u', u0 - ea, -1], ['u', u1 + ea, 1]);
    if (ru1 - ru0 > EPS) addRidge(mb, PP, ru0, ru1, vm, ridgeY + T, p);
  } else {
    slab([PP(u0 - ea, lowY, v0 - ea), PP(u1 + ea, lowY, v0 - ea), PP(u1 + ea, ridgeY, vm), PP(u0 - ea, ridgeY, vm)], uvAlong(v0 - ea));
    slab([PP(u0 - ea, lowY, v1 + ea), PP(u1 + ea, lowY, v1 + ea), PP(u1 + ea, ridgeY, vm), PP(u0 - ea, ridgeY, vm)], uvAlong(v1 + ea));
    eaves.push(['v', v0 - ea, -1], ['v', v1 + ea, 1]);
    addRidge(mb, PP, u0 - ea, u1 + ea, vm, ridgeY + T, p);
    // gable end walls in the cladding, closing the triangle under the roof,
    // with a louvred vent near the peak
    for (const [u, dir] of [[wu0, 1], [wu1, -1]]) {
      const tri = [PP(u, eaveY, wv0), PP(u, eaveY, wv1), PP(u, ridgeY, vm)];
      const depth = alongX ? [dir * WALL_EXT, 0, 0] : [0, 0, dir * WALL_EXT];
      mb.addExtrusion('Roof', tri, depth, 'cladding');
      const vy = eaveY + (ridgeY - eaveY) * 0.45;
      const [a, b] = [PP(u - dir * 0.12, vy, vm - 0.9), PP(u, vy + 1.4, vm + 0.9)];
      mb.addBox('Roof', [Math.min(a[0], b[0]), a[1], Math.min(a[2], b[2])], [Math.max(a[0], b[0]), b[1], Math.max(a[2], b[2])], 'trim');
      // rake boards along both sloped edges
      for (const sv of [-1, 1]) {
        const ve = sv < 0 ? v0 - ea : v1 + ea;
        const q = [PP(u - dir * (ea - WALL_EXT / 2) - dir * 0.02, lowY - 0.55, ve), PP(u - dir * (ea - WALL_EXT / 2) - dir * 0.02, ridgeY - 0.55, vm), PP(u - dir * (ea - WALL_EXT / 2) - dir * 0.02, ridgeY + T + 0.05, vm), PP(u - dir * (ea - WALL_EXT / 2) - dir * 0.02, lowY + T + 0.05, ve)];
        mb.addExtrusion('Roof', q, alongX ? [-dir * 0.12, 0, 0] : [0, 0, -dir * 0.12], 'trim');
      }
    }
  }
  // fascia, boxed soffit, gutters and downspouts along every eave
  for (const [axis, at, s] of eaves) {
    const [a, b] = axis === 'v' ? [u0 - ea, u1 + ea] : [v0 - ea, v1 + ea];
    const wallAt = axis === 'v' ? (s < 0 ? wv0 : wv1) : (s < 0 ? wu0 : wu1);
    const R = (c0, c1, y0, y1, d0, d1, mat) => {
      const lo = axis === 'v' ? PP(c0, y0, Math.min(d0, d1)) : PP(Math.min(d0, d1), y0, c0);
      const hi = axis === 'v' ? PP(c1, y1, Math.max(d0, d1)) : PP(Math.max(d0, d1), y1, c1);
      mb.addBox('Roof', [Math.min(lo[0], hi[0]), lo[1], Math.min(lo[2], hi[2])], [Math.max(lo[0], hi[0]), hi[1], Math.max(lo[2], hi[2])], mat);
    };
    R(a, b, lowY - 0.6, lowY + T + 0.02, at, at - s * 0.12, 'trim');           // fascia
    R(a, b, lowY - 0.6, lowY - 0.52, wallAt, at - s * 0.12, 'soffit');          // soffit
    R(a, b, lowY - 0.45, lowY + 0.05, at, at + s * 0.42, 'gutter');             // K-style gutter
    // downspouts at the building corners, tight to the wall
    if (axis === 'v' && withDownspouts) {
      for (const c of [wu0 + 0.35, wu1 - 0.35]) {
        const pt = PP(c, 0, wallAt + s * 0.2);
        downspout(pt[0], pt[2], lowY - 0.3);
        const g = PP(c, 0, at + s * 0.21); // outlet from the gutter back to the wall
        mb.addBox('Roof', [Math.min(pt[0], g[0]) - 0.12, lowY - 0.55, Math.min(pt[2], g[2]) - 0.12], [Math.max(pt[0], g[0]) + 0.12, lowY - 0.3, Math.max(pt[2], g[2]) + 0.12], 'gutter');
      }
    }
  }
}

function addRidge(mb, PP, ua, ub, vm, y, p) {
  const w = 0.55;
  const tri = [PP(ua, y - w * p, vm - w), PP(ua, y - w * p, vm + w), PP(ua, y + 0.12, vm)];
  const d = PP(ub - ua, 0, 0);
  mb.addExtrusion('Roof', tri, [d[0], 0, d[2]], 'ridge');
}

module.exports = { buildModel, subtractRect, boundaryKind, coverRects, synthStairLayout };
