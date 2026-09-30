'use strict';

/* Living rooms, dining rooms and kitchens: where the pieces go, chosen from every
   wall and position rather than one fixed rule (the bedroom approach, see
   lib/bedPlacement.js).

   Shared hard rules (a candidate that breaks one is dropped while any other passes):
   - nothing stands in a doorway's throat, swing or 3 ft landing;
   - a 2.5 ft wide path still joins every doorway and every open side of the room
     (open-plan rooms often have no doors between them, only open sides);
   - pieces that need a wall behind them (the TV console, the kitchen run) stand
     on a real wall, never on an open side or across a doorway.
   Per room:
   - living: TV console on a solid wall and never in front of a window, the sofa
     facing it about 9 ft away (4.5 ft in a small room, floating in a deep one), the
     coffee table between;
   - dining: the table and its chairs as one group, with room to pull the chairs
     out; the same table and chair count as before, placed and turned to keep
     doorways and paths clear;
   - kitchen: the counter run (with the range and fridge, 7 to 12 ft long) flush on
     a wall, preferring the longer walls and walls without windows (sills here are
     below counter height); the island
     3.5 ft from the run and 3 ft from anything else, or left out when it would
     block a doorway or a path or the room is too narrow for it.
   Every piece records the side its back is on (`back`: n, s, e, w) so the 3D
   models face the right way. When no candidate passes, the caller keeps its
   simple placement. The social feature pair's dining assembly is not handled here. */

const { landingIn, spanOf, connected, overlaps, bbox } = require('./bedPlacement');

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const EPS = 1e-6;
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
const PUBLIC = /^(kitchen|dining_room|dining|living_room|family_room|great_room|breakfast_nook|nook)$/;
const CIRC = /^(hallway|hall|landing|foyer|entry|gallery)$/;

function rectsOf(room) {
  const parts = Array.isArray(room?.parts) && room.parts.length ? room.parts : [room];
  return parts.map((p) => ({ x: num(p.x), y: num(p.y), w: num(p.w), h: num(p.h) }));
}

// Is the boundary between two rooms open (no wall)? Mirrors the 3D model's rule.
function openBetween(a, b, openConcept) {
  const ta = String(a?.type || ''), tb = String(b?.type || '');
  if (openConcept && PUBLIC.test(ta) && PUBLIC.test(tb)) return true;
  if (CIRC.test(ta) && CIRC.test(tb)) return true;
  return (/^loft$/.test(ta) && CIRC.test(tb)) || (/^loft$/.test(tb) && CIRC.test(ta));
}

/* The open stretches of rectangle r's edges: shared with another part of the same
   room, or with a room across an open boundary. [{ side, a, b }] in plan feet. */
function openSides(r, room, level, openConcept) {
  const own = rectsOf(room).filter((p) => !(Math.abs(p.x - r.x) < EPS && Math.abs(p.y - r.y) < EPS && Math.abs(p.w - r.w) < EPS && Math.abs(p.h - r.h) < EPS));
  const others = (level?.rooms || []).filter((o) => o !== room);
  const inside = (x, y, q) => x > q.x + EPS && x < q.x + q.w - EPS && y > q.y + EPS && y < q.y + q.h - EPS;
  const out = [];
  for (const side of ['n', 's', 'w', 'e']) {
    const horizontal = side === 'n' || side === 's';
    const len = horizontal ? r.w : r.h, start = horizontal ? r.x : r.y;
    let seg = null;
    for (let t = 0.25; t < len; t += 0.5) {
      const s = start + t;
      const [x, y] = side === 'n' ? [s, r.y - 0.25] : side === 's' ? [s, r.y + r.h + 0.25] : side === 'w' ? [r.x - 0.25, s] : [r.x + r.w + 0.25, s];
      const open = own.some((p) => inside(x, y, p)) || others.some((o) => rectsOf(o).some((p) => inside(x, y, p)) && openBetween(room, o, openConcept));
      if (open) { if (seg) seg.b = s + 0.25; else seg = { side, a: s - 0.25, b: s + 0.25 }; }
      else if (seg) { out.push(seg); seg = null; }
    }
    if (seg) out.push(seg);
  }
  return out;
}

// A strip 1 ft deep inside r along an open stretch: what a path must reach.
function openStrip(r, o) {
  if (o.side === 'n') return { x: o.a, y: r.y, w: o.b - o.a, h: 1 };
  if (o.side === 's') return { x: o.a, y: r.y + r.h - 1, w: o.b - o.a, h: 1 };
  if (o.side === 'w') return { x: r.x, y: o.a, w: 1, h: o.b - o.a };
  return { x: r.x + r.w - 1, y: o.a, w: 1, h: o.b - o.a };
}

// Does stretch [a, b] of side `side` overlap an open stretch?
const onOpen = (opens, side, a, b) => opens.some((o) => o.side === side && Math.min(o.b, b) - Math.max(o.a, a) > 0.2);

/* A local frame on rectangle r, back on `side`: u along the wall, v into the room.
   rect(u0, u1, v0, v1) returns the plan rectangle. */
function frameOn(r, side, inset) {
  const L = side === 'n' || side === 's' ? r.w : r.h, D = side === 'n' || side === 's' ? r.h : r.w;
  const rect = (u0, u1, v0, v1) => {
    v0 += inset; v1 += inset;
    if (side === 'n') return { x: r.x + u0, y: r.y + v0, w: u1 - u0, h: v1 - v0 };
    if (side === 's') return { x: r.x + u0, y: r.y + r.h - v1, w: u1 - u0, h: v1 - v0 };
    if (side === 'w') return { x: r.x + v0, y: r.y + u0, w: v1 - v0, h: u1 - u0 };
    return { x: r.x + r.w - v1, y: r.y + u0, w: v1 - v0, h: u1 - u0 };
  };
  return { L: L - 2 * inset, D: D - 2 * inset, rect, span: (q) => (side === 'n' || side === 's' ? [q.x, q.x + q.w] : [q.y, q.y + q.h]) };
}

/* Room context from the plan: the rectangle to plan in, doorways, landings, open
   sides, windows and the room's own inside test. `fits`/`zones` come from
   furnitureGeometry (passed in to avoid a require cycle). */
function roomContext(room, level, { openConcept = false, fits, zones }) {
  const parts = rectsOf(room);
  const r = parts.reduce((best, p) => (p.w * p.h > best.w * best.h ? p : best), parts[0]);
  const id = String(room.id);
  const doors = (level.doors || []).filter((d) => !d.garageDoor && [d.a, d.b].map(String).includes(id));
  const landings = doors.map((d) => landingIn(d, parts)).filter(Boolean);
  const opens = openSides(r, room, level, openConcept);
  const targets = [...landings, ...opens.map((o) => openStrip(r, o))];
  const windows = (level.windows || []).filter((w) => String(w.roomId) === id);
  const clear = (q, gap = 0.3) => fits(q) && !zones.some((z) => overlaps(q, z, gap)) && !landings.some((l) => overlaps(q, l));
  const pathOk = (obstacles) => connected({ box: bbox(parts), fits }, obstacles, targets);
  // Is the wall behind a piece solid over its span (no doorway, no open side)?
  const solidWall = (side, a, b) => !onOpen(opens, side, a, b) && !doors.some((d) => {
    const vertical = String(d.dir) === 'vertical';
    const line = side === 'n' ? r.y : side === 's' ? r.y + r.h : side === 'w' ? r.x : r.x + r.w;
    if ((side === 'n' || side === 's') === vertical) return false;
    if (Math.abs((vertical ? num(d.x) : num(d.y)) - line) > 1.3) return false;
    const [da, db] = spanOf(d);
    return Math.min(db, b + 0.3) - Math.max(da, a - 0.3) > 0;
  });
  const windowOn = (side, a, b) => windows.filter((w) => {
    const vertical = String(w.dir) === 'vertical';
    const line = side === 'n' ? r.y : side === 's' ? r.y + r.h : side === 'w' ? r.x : r.x + r.w;
    return (side === 'n' || side === 's') !== vertical && Math.abs((vertical ? num(w.x) : num(w.y)) - line) <= 1.3;
  }).reduce((sum, w) => { const [wa, wb] = spanOf(w); return sum + Math.max(0, Math.min(wb, b) - Math.max(wa, a)); }, 0);
  // Which wall of r a doorway is on (for rooms that prefer a piece off the door wall).
  const onSide = (d, side) => {
    const vertical = String(d.dir) === 'vertical';
    const line = side === 'n' ? r.y : side === 's' ? r.y + r.h : side === 'w' ? r.x : r.x + r.w;
    return (side === 'n' || side === 's') !== vertical && Math.abs((vertical ? num(d.x) : num(d.y)) - line) <= 1.3;
  };
  return { room, r, parts, doors, landings, opens, targets, clear, pathOk, solidWall, windowOn, onSide, zones, fits };
}

// Pick the best candidate: fewest broken rules, then the lowest score; the path
// check (the costly one) runs down the ranking only until one passes. In a room too
// small for any layout to keep a full 2.5 ft path, the best one that still keeps
// every doorway clear is used (the simple placement keeps neither). Otherwise null,
// and the caller keeps its simple placement.
function best(cands, pathOf) {
  if (!cands.length) return null;
  cands.sort((a, b) => a.broken.length - b.broken.length || a.score - b.score);
  let doorsClear = null;
  for (const c of cands.slice(0, 40)) {
    if (c.broken.length) break;
    if (pathOf(c)) return c;
    c.broken.push('walking path');
    doorsClear = doorsClear || c;
  }
  return doorsClear;
}

const offsets = (max, step = 0.5) => { const out = [0]; for (let d = step; d <= max + EPS; d += step) out.push(d, -d); return out; };

// ---- living room ------------------------------------------------------------
function planLiving(ctx) {
  const { r, clear, solidWall, windowOn, pathOk } = ctx;
  if (r.w < 10 || r.h < 10) return null;
  const inset = 0.27, cands = [];
  for (const tv of ['n', 's', 'e', 'w']) {
    const f = frameOn(r, tv, inset);
    const sofaLen = Math.min(8, f.L - 1.5), conLen = Math.min(6, f.L - 1.5);
    if (sofaLen < 5) continue;
    for (const off of offsets(Math.max(0, (f.L - sofaLen) / 2), 0.5)) {
      const mid = f.L / 2 + off;
      const con = f.rect(mid - conLen / 2, mid + conLen / 2, 0, 1.5);
      const cSpan = f.span(con);
      if (cSpan[0] < (tv === 'n' || tv === 's' ? r.x : r.y) - EPS) continue;
      // The sofa against the far wall, or pulled forward to about 11 ft of viewing distance.
      const far = f.D - 3, view = Math.min(far - 1.5, 12.5);
      if (view < 4.5) continue;                                            // a small room: a short but real viewing distance
      const sofa = f.rect(mid - sofaLen / 2, mid + sofaLen / 2, 1.5 + view, 1.5 + view + 3);
      const tw = Math.min(4, sofaLen - 2), gapTable = 1.5, td = view >= 7 ? 2 : 1.6;
      const table = f.rect(mid - tw / 2, mid + tw / 2, 1.5 + view - gapTable - td, 1.5 + view - gapTable);
      const broken = [];
      if (!solidWall(tv, ...cSpan)) broken.push('TV wall');
      if (windowOn(tv, cSpan[0] - 0.5, cSpan[1] + 0.5) > 0.3) broken.push('TV over a window');
      for (const [q, name] of [[con, 'console'], [sofa, 'sofa'], [table, 'coffee table']]) if (!clear(q)) broken.push(name);
      let score = Math.abs(view - 9) * 0.4 + Math.abs(off) * 0.3;
      if (view + 3 + 1.5 < f.D - 0.5) score += 0.5;                                          // a floating sofa
      cands.push({ tv, items: [
        { kind: 'console', ...con, back: tv },
        { kind: 'sofa', ...sofa, back: OPP[tv] },
        { kind: 'coffee_table', ...table },
      ], score, broken });
    }
  }
  const pick = best(cands, (c) => pathOk(c.items));
  return pick ? pick.items : null;
}

// ---- dining room --------------------------------------------------------------
function planDining(ctx) {
  const { r, clear, pathOk } = ctx;
  if (r.w < 8 || r.h < 8) return null;
  // The same table the simple placement uses: long in a long room, square otherwise.
  const long = r.w >= r.h;
  const tl = long ? Math.min(7, r.w - 2) : 4.5, td = long ? 3.5 : 4.5;
  const cands = [];
  for (const turned of long ? [false, true] : [false]) {
    const w = turned ? td : tl, h = turned ? tl : td;
    if (w > r.w - 1 || h > r.h - 1) continue;
    const cx0 = r.x + r.w / 2, cy0 = r.y + r.h / 2;
    for (const dx of offsets(Math.max(0, (r.w - w) / 2 - 2), 0.5)) for (const dy of offsets(Math.max(0, (r.h - h) / 2 - 2), 0.5)) {
      const cx = cx0 + dx, cy = cy0 + dy;
      const table = { kind: 'dining_table', x: cx - w / 2, y: cy - h / 2, w, h };
      const chairs = [];
      const c = 1.5, g = 0.35;
      if (!turned) {
        for (const [x, side] of [[table.x + 0.35, 'n'], [table.x + table.w - c - 0.35, 'n']]) chairs.push({ x, y: table.y - c - g, back: side });
        for (const [x, side] of [[table.x + 0.35, 's'], [table.x + table.w - c - 0.35, 's']]) chairs.push({ x, y: table.y + table.h + g, back: side });
      } else {
        for (const [y, side] of [[table.y + 0.35, 'w'], [table.y + table.h - c - 0.35, 'w']]) chairs.push({ x: table.x - c - g, y, back: side });
        for (const [y, side] of [[table.y + 0.35, 'e'], [table.y + table.h - c - 0.35, 'e']]) chairs.push({ x: table.x + table.w + g, y, back: side });
      }
      const seats = chairs.map((q, i) => ({ kind: `chair_${i + 1}`, x: q.x, y: q.y, w: c, h: c, back: q.back }));
      // Room to pull each chair out: 1 ft behind it.
      const pull = seats.map((q) => (q.back === 'n' ? { ...q, y: q.y - 1, h: q.h + 1 } : q.back === 's' ? { ...q, h: q.h + 1 } : q.back === 'w' ? { ...q, x: q.x - 1, w: q.w + 1 } : { ...q, w: q.w + 1 }));
      const broken = [];
      if (!clear(table)) broken.push('table');
      if (pull.some((q) => !clear(q, 0.1))) broken.push('chairs');
      const score = Math.hypot(dx, dy) * 0.5 + (turned ? 0.3 : 0);
      cands.push({ items: [table, ...seats], obstacles: [table, ...seats], score, broken });
    }
  }
  const pick = best(cands, (c) => pathOk(c.obstacles));
  return pick ? pick.items : null;
}

// ---- kitchen ------------------------------------------------------------------
function planKitchen(ctx) {
  const { r, clear, solidWall, windowOn, pathOk } = ctx;
  if (r.w < 8 || r.h < 8) return null;
  const inset = 0.27, cands = [];
  const longest = Math.max(r.w, r.h) - 2 * inset;
  for (const side of ['n', 's', 'e', 'w']) {
    const f = frameOn(r, side, inset);
    const L = Math.min(12, f.L - 1.5);
    if (L < 7) continue; // every kitchen needs its counter, range and fridge (validatePlan); under 7 ft they do not fit
    const stops = [];
    for (let u = 0; u <= f.L - L + EPS; u += 0.5) stops.push(Math.min(u, f.L - L));
    if (stops[stops.length - 1] < f.L - L - EPS) stops.push(f.L - L);
    for (const u0 of stops) {
      const run = f.rect(u0, u0 + L, 0, 2);
      const items = [{ kind: 'counter', ...run, back: side }];
      items.push({ kind: 'stove', ...f.rect(u0 + 1.5, u0 + 4, 0, 2.5), back: side });
      items.push({ kind: 'refrigerator', ...f.rect(u0 + L - 2.5, u0 + L, 0, 2.5), back: side });
      const span = f.span(run);
      const broken = [];
      if (!solidWall(side, ...span)) broken.push('counter wall');
      if (items.some((q) => !clear(q))) broken.push('counter');
      // The island, parallel to the run: 3.5 ft aisle, 3 ft beyond it.
      let island = null;
      if (r.w >= 10 && r.h >= 10) {
        const iw = Math.min(6, f.L - 4), v0 = 2.5 + 3.5;
        if (iw >= 3.5 && v0 + 3 + 3 <= f.D + EPS) {
          const mid = u0 + L / 2, lo = Math.max(1.5, Math.min(f.L - 1.5 - iw, mid - iw / 2));
          const q = f.rect(lo, lo + iw, v0, v0 + 3);
          if (clear(q)) island = { kind: 'kitchen_island', ...q };
        }
      }
      // Windows here start 2.25 ft up, so a counter (3 ft) in front of one would cut across the glass.
      const score = windowOn(side, ...span) * 0.5 + Math.min(u0, f.L - L - u0) * 0.15 + (longest - f.L) * 0.12 + (island ? 0 : 0.8);
      cands.push({ items: island ? [...items, island] : items, obstacles: island ? [run, island] : [run], score, broken });
      if (island) cands.push({ items, obstacles: [run], score: score + 0.8, broken: [...broken] });
    }
  }
  const pick = best(cands, (c) => pathOk(c.obstacles));
  return pick ? pick.items : null;
}

/* Issues in a delivered level's living rooms, dining rooms and kitchens
   (diagnostics, not a generation gate): a piece in a doorway landing or throat,
   a TV console or counter run backed on an open side or across a doorway, and a
   room whose doorways and open sides are no longer joined by a 2.5 ft path. */
function publicRoomIssues(level, { openConcept = false, fitsIn, zonesIn }) {
  const issues = [];
  for (const room of level?.rooms || []) {
    const type = String(room.type || '');
    if (!/^(living_room|dining_room|kitchen)$/.test(type)) continue;
    const items = (level.furniture || []).filter((f) => String(f.roomId) === String(room.id));
    if (!items.length) continue;
    const ctx = roomContext(room, level, { openConcept, fits: fitsIn(room), zones: zonesIn(room) });
    for (const it of items) {
      const q = { x: num(it.x), y: num(it.y), w: num(it.w), h: num(it.h) };
      if (ctx.landings.some((l) => overlaps(q, l))) issues.push({ roomId: room.id, rule: `${it.kind} in a doorway landing` });
    }
    const pieces = items.filter((it) => /^(sofa|coffee_table|console|dining_table|chair_\d+|counter|kitchen_island|stove|refrigerator)$/.test(it.kind));
    const bigPieces = pieces.filter((it) => /^(sofa|coffee_table|console|dining_table|chair_\d+|counter|kitchen_island)$/.test(it.kind));
    if (!ctx.pathOk(bigPieces.map((it) => ({ x: num(it.x), y: num(it.y), w: num(it.w), h: num(it.h) })))) issues.push({ roomId: room.id, rule: 'no clear path between doorways and open sides' });
  }
  return issues;
}

module.exports = { roomContext, planLiving, planDining, planKitchen, publicRoomIssues, openSides };
