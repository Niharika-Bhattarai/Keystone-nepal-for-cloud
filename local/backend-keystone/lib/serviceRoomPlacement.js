'use strict';

/* Bathrooms, laundry rooms and studies: fixtures and furniture chosen from every
   wall and position (the approach of lib/bedPlacement.js and
   lib/publicRoomPlacement.js), with the clear floor each piece needs to be used.

   Hard rules (a layout that breaks one is never chosen):
   - every piece stands flush against a wall, outside the door's throat and swing;
   - each piece's use space stays free of the other pieces: 2 ft in front of a
     toilet (2.5 ft wide) and a vanity, 2 ft at a shower's entry and along a tub,
     3.5 ft in front of a washer and dryer, 3 ft behind a desk for its chair;
   - a 2 ft path joins the doorway to every use space (in a room too tight for any
     layout to keep it, the best layout that keeps the rest is used).
   Preferences: the vanity near the door, the shower or tub farther away, the
   toilet not lined up with the door, no shower on a window wall, a desk away from
   the door wall, bookcases on walls without windows.

   Plan symbols: a toilet's tank is drawn on its north side (rotation 0) or west
   side (rotation 90) only (renderPlanSvg), so toilets back onto a north or west
   wall. Every piece records `back` for the 3D model. When no layout passes, the
   caller keeps its simple placement. */

const { connected, overlaps, bbox } = require('./bedPlacement');

const EPS = 1e-6;
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
const PATH_FT = 2;

// A rectangle w (along the wall) x d (into the room) with its back on `side` of r,
// `along` ft from the wall's start (x for n/s, y for e/w).
function onWall(r, side, along, w, d, inset) {
  if (side === 'n') return { x: r.x + along, y: r.y + inset, w, h: d };
  if (side === 's') return { x: r.x + along, y: r.y + r.h - inset - d, w, h: d };
  if (side === 'w') return { x: r.x + inset, y: r.y + along, w: d, h: w };
  return { x: r.x + r.w - inset - d, y: r.y + along, w: d, h: w };
}

// The strip of floor in front of a piece (its use space), `depth` deep and `width`
// wide (centred on the piece; its own width when omitted).
function frontOf(q, side, depth, width = null) {
  const horizontal = side === 'n' || side === 's';
  const len = horizontal ? q.w : q.h, wid = width ?? len;
  const a = (horizontal ? q.x : q.y) + (len - wid) / 2;
  if (side === 'n') return { x: a, y: q.y + q.h, w: wid, h: depth };
  if (side === 's') return { x: a, y: q.y - depth, w: wid, h: depth };
  if (side === 'w') return { x: q.x + q.w, y: a, w: depth, h: wid };
  return { x: q.x - depth, y: a, w: depth, h: wid };
}

const centre = (q) => [q.x + q.w / 2, q.y + q.h / 2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Every position of a piece along the given walls, flush, inside the room.
function positions(ctx, spec, inset) {
  const { r, fits } = ctx;
  const out = [];
  for (const side of spec.sides || ['n', 's', 'e', 'w']) {
    const wallLen = side === 'n' || side === 's' ? r.w : r.h;
    const max = wallLen - 2 * inset - spec.w;
    if (max < -EPS) continue;
    const stops = new Set([0, max]);
    for (let a = 0; a <= max + EPS; a += 0.5) stops.add(Math.min(a, max));
    for (const a of stops) {
      const q = onWall(r, side, inset + a, spec.w, spec.d, inset);
      if (!fits(q)) continue;
      const use = spec.use ? frontOf(q, side, spec.use.depth, spec.use.width) : null;
      if (use && !fits(use)) continue;
      const atCorner = Math.min(a, max - a) < 0.3;
      out.push({ ...q, back: side, use, atCorner, spec });
    }
  }
  return out;
}

/* Place `specs` (in order) by depth-first search over their positions; keep the
   best-scoring layout whose pieces and use spaces do not collide and whose use
   spaces the doorway can reach. `score(piece)` is lower-better. */
function arrange(ctx, specs, inset, score) {
  const { zones, doors, parts, fits } = ctx;
  const doorPoints = doors.map((d) => [Number(d.x), Number(d.y)]);
  const pools = specs.map((spec) => positions(ctx, spec, inset)
    .filter((q) => !zones.some((z) => overlaps(q, z, 0.2)))
    .map((q) => ({ ...q, s: score(q, doorPoints) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, 40));
  if (pools.some((p) => !p.length)) return null;
  let best = null, clearOnly = null, leaves = 0;
  const room = { box: bbox(parts), fits };
  // The doorway's throat inside the room is where the path starts.
  const starts = zones.filter((z) => !z.sector);
  const walk = (i, placed, total) => {
    if (leaves > 1500 || (best && total >= best.total)) return;
    if (i === pools.length) {
      leaves++;
      const obstacles = placed.map(({ x, y, w, h }) => ({ x, y, w, h }));
      const targets = [...starts.slice(0, 1), ...placed.filter((q) => q.use).map((q) => q.use)];
      if (targets.length > 1 && !connected(room, obstacles, targets, PATH_FT)) {
        // Too tight for the path: remember the best layout that still keeps the door
        // swing and every use space clear (the simple placement keeps neither).
        if (!clearOnly || total < clearOnly.total) clearOnly = { total, placed: [...placed] };
        return;
      }
      best = { total, placed: [...placed] };
      return;
    }
    for (const q of pools[i]) {
      // 0.3 ft apart: the collision pass keeps pieces 0.25 ft apart and would move them otherwise.
      if (placed.some((p) => overlaps(q, p, 0.3) || (p.use && overlaps(q, p.use)) || (q.use && overlaps(q.use, p)))) continue;
      walk(i + 1, [...placed, q], total + q.s);
    }
  };
  walk(0, [], 0);
  return best ? { placed: best.placed, path: true } : clearOnly ? { placed: clearOnly.placed, path: false } : null;
}

const windowAlong = (ctx, q) => ctx.windowOn(q.back, ...(q.back === 'n' || q.back === 's' ? [q.x, q.x + q.w] : [q.y, q.y + q.h]));

// ---- bathroom -------------------------------------------------------------------
function planBathroom(ctx, { primary = false, powder = false } = {}) {
  const { r } = ctx;
  if (r.w < 4 || r.h < 4) return null;
  const inset = 0.27;
  const wide = Math.max(r.w, r.h) - 1;
  // Fuller setups first: a primary bath with a tub and a double vanity when they fit.
  const setups = [];
  const tubOk = primary && r.w >= 7 && r.h >= 8;
  for (const tub of tubOk ? [true, false] : [false]) for (const vw of primary && wide >= 9 ? [4.5, 2] : [2]) {
    const specs = [];
    if (tub) specs.push({ kind: 'tub', w: Math.min(6, Math.max(r.w, r.h) - 1.5), d: 2.5, use: { depth: 2 } });
    if (!powder) specs.push({ kind: 'shower', w: 3, d: 3, use: { depth: 2, width: 2.5 } });
    specs.push({ kind: 'vanity', w: vw, d: 1.75, use: { depth: 2 } });
    specs.push({ kind: 'toilet', w: 2, d: 2.5, use: { depth: 2, width: 2.5 }, sides: ['n', 'w'] });
    setups.push(specs);
  }
  const score = (q, doorPoints) => {
    const d = doorPoints.length ? Math.min(...doorPoints.map((p) => dist(centre(q), p))) : 0;
    const k = q.spec.kind;
    let s = 0;
    if (k === 'vanity') s += d * 0.3;
    if (k === 'shower' || k === 'tub') s -= d * 0.25 - (q.atCorner ? 0 : 0.8) - windowAlong(ctx, q) * 0.3;
    if (k === 'toilet') {
      // Lined up with the door: the doorway sits on the wall the toilet faces, across its width.
      const faces = OPP[q.back], [tx, ty] = centre(q);
      if (ctx.doors.some((dr) => (faces === 'n' || faces === 's' ? Math.abs(Number(dr.x) - tx) < 1.5 : Math.abs(Number(dr.y) - ty) < 1.5) && ctx.onSide(dr, faces))) s += 2;
    }
    return s;
  };
  let found = null;
  for (const specs of setups) {
    const got = arrange(ctx, specs, inset, score);
    if (got?.path) { found = got; break; }
    if (got && !found) found = got;
  }
  if (!found) return null;
  return found.placed.map((q) => {
    const item = { kind: q.spec.kind, x: q.x, y: q.y, w: q.w, h: q.h, back: q.back };
    if (q.spec.kind === 'toilet') item.rotation = q.back === 'w' ? 90 : 0;
    return item;
  });
}

// ---- laundry ------------------------------------------------------------------
function planLaundry(ctx) {
  const { r } = ctx;
  if (r.w < 4 || r.h < 4) return null;
  const inset = 0.27;
  const pair = { kind: 'pair', w: 6.3, d: 3, use: { depth: 3.5 } };
  const counter = { kind: 'laundry_counter', w: Math.min(6, Math.max(r.w, r.h) - 1.5), d: 1.5, use: { depth: 2 } };
  const score = (q, doorPoints) => (doorPoints.length ? -Math.min(...doorPoints.map((p) => dist(centre(q), p))) * 0.1 : 0);
  const split = (q) => {
    const horizontal = q.back === 'n' || q.back === 's';
    const a = { ...q, w: horizontal ? 3 : q.w, h: horizontal ? q.h : 3 };
    const b = horizontal ? { ...q, x: q.x + 3.3, w: 3 } : { ...q, y: q.y + 3.3, h: 3 };
    return [{ kind: 'washer', ...pick(a) }, { kind: 'dryer', ...pick(b) }];
  };
  const pick = (q) => ({ x: q.x, y: q.y, w: q.w, h: q.h, back: q.back });
  const withCounter = Math.max(r.w, r.h) >= 8 ? arrange(ctx, [pair, counter], inset, score) : null;
  const alone = withCounter?.path ? null : arrange(ctx, [pair], inset, score);
  const placed = (withCounter?.path ? withCounter : alone?.path ? alone : withCounter || alone)?.placed;
  if (placed) return placed.flatMap((q) => (q.spec.kind === 'pair' ? split(q) : [{ kind: q.spec.kind, ...pick(q) }]));
  const stacked = arrange(ctx, [{ kind: 'stacked_washer_dryer', w: 3, d: 3, use: { depth: 3.5 } }], inset, score)?.placed;
  return stacked ? stacked.map((q) => ({ kind: 'stacked_washer_dryer', ...pick(q), stacked: true })) : null;
}

// ---- study, library, gaming room ------------------------------------------------
function planStudy(ctx) {
  const { r, doors } = ctx;
  if (r.w < 7 || r.h < 7) return null;
  const inset = 0.27;
  const deskW = Math.min(6, Math.max(r.w, r.h) - 2);
  const desk = { kind: 'desk', w: deskW, d: 2.5, use: { depth: 3, width: 3 } };
  const shelf = { kind: 'bookcase', w: Math.min(6, Math.min(r.w, r.h) - 2), d: 1, use: { depth: 2 } };
  const doorSides = new Set(doors.map((dr) => ['n', 's', 'e', 'w'].find((sd) => ctx.onSide(dr, sd))).filter(Boolean));
  const score = (q) => (doorSides.has(q.back) ? 2 : 0) + (q.spec.kind === 'bookcase' ? windowAlong(ctx, q) * 0.8 : 0) + (q.atCorner ? 0 : 0.2);
  const both = arrange(ctx, [desk, shelf], inset, score);
  const placed = (both?.path ? both : arrange(ctx, [desk], inset, score) || both)?.placed;
  if (!placed) return null;
  const out = [];
  for (const q of placed) {
    out.push({ kind: q.spec.kind, x: q.x, y: q.y, w: q.w, h: q.h, back: q.back });
    if (q.spec.kind === 'desk') {
      // The chair in the desk's use space, 0.35 ft off the desk, facing it.
      const f = frontOf(q, q.back, 2.35, 2);
      const chair = q.back === 'n' ? { x: f.x, y: f.y + 0.35, w: 2, h: 2 } : q.back === 's' ? { x: f.x, y: f.y, w: 2, h: 2 }
        : q.back === 'w' ? { x: f.x + 0.35, y: f.y, w: 2, h: 2 } : { x: f.x, y: f.y, w: 2, h: 2 };
      out.push({ kind: 'desk_chair', ...chair, back: OPP[q.back] });
    }
  }
  return out;
}

module.exports = { planBathroom, planLaundry, planStudy };
