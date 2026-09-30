'use strict';

/* Bedroom layout: where the bed, nightstands and dresser go.

   The bed is chosen from every wall, rotation and position of every part of the
   room (bedrooms can be L-shaped), not from one rule. Rotation names the headboard
   wall (plan convention, shared with the SVG and both 3D viewers): 0 north (top),
   90 east (right), 180 south, 270 west.

   Hard rules (a candidate that breaks one is dropped while any other passes):
   - the headboard is flush with a real wall, never the open side where two parts
     of the room meet;
   - the bed stays out of every doorway's throat, swing and 3 ft landing (the
     room's entry, its closet and its bath);
   - no doorway on the headboard wall within 2 ft of the bed (the bed's head is
     not beside an entrance);
   - a 2.5 ft wide path still joins every doorway and closet front of the room
     and reaches one side of the bed.
   Preferences (scored): headboard on a wall with no doorway (and preferably no
   window), not on the entry's wall, the bed centred on its wall, side/foot clearances
   (room contract, default 2.5 ft sides; 3 ft foot preferred), the entry not
   lined up with the foot of the bed.

   Sources: common interior-design practice (30-36 in walkways, 24-30 in beside
   the bed, 36 in at the foot and in front of a dresser, headboard on a solid wall);
   see docs/superpowers/plans/2026-09-28-keystone-launch-variety-coverage-plan.md.
   These are layout preferences for concept plans, not code requirements. */

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const EPS = 1e-6;

const LANDING_FT = 3;       // clear floor in front of a doorway, inside the room
const HEAD_DOOR_FT = 2;     // no doorway on the headboard wall this close to the bed
const PATH_FT = 2.5;        // walking path width
const GRID = 0.5;           // position and path grid
const LINE_TOL = 1.3;       // an opening's centre line vs a wall line (wall thickness)

const HEAD_WALL = { 0: 'n', 90: 'e', 180: 's', 270: 'w' };
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };

function overlaps(a, b, gap = 0) {
  return a.x < b.x + b.w + gap - EPS && b.x < a.x + a.w + gap - EPS &&
    a.y < b.y + b.h + gap - EPS && b.y < a.y + a.h + gap - EPS;
}

// Which wall of rectangle r an opening lies on (null when it is not on r's edge).
function wallOf(opening, r, tol = LINE_TOL) {
  const x = num(opening.x), y = num(opening.y);
  if (String(opening.dir) === 'vertical') {
    if (y < r.y - tol || y > r.y + r.h + tol) return null;
    if (Math.abs(x - r.x) <= tol) return 'w';
    if (Math.abs(x - (r.x + r.w)) <= tol) return 'e';
    return null;
  }
  if (x < r.x - tol || x > r.x + r.w + tol) return null;
  if (Math.abs(y - r.y) <= tol) return 'n';
  if (Math.abs(y - (r.y + r.h)) <= tol) return 's';
  return null;
}

// The opening's span along its wall.
function spanOf(opening) {
  const w = num(opening.width, 3);
  const c = String(opening.dir) === 'vertical' ? num(opening.y) : num(opening.x);
  return [c - w / 2, c + w / 2];
}

// Clear floor in front of an opening, inside rectangle r.
function landingOf(opening, r, depth = LANDING_FT) {
  const wall = wallOf(opening, r);
  const [a, b] = spanOf(opening);
  if (wall === 'w') return { x: r.x, y: a, w: Math.min(depth, r.w), h: b - a };
  if (wall === 'e') return { x: r.x + r.w - Math.min(depth, r.w), y: a, w: Math.min(depth, r.w), h: b - a };
  if (wall === 'n') return { x: a, y: r.y, w: b - a, h: Math.min(depth, r.h) };
  if (wall === 's') return { x: a, y: r.y + r.h - Math.min(depth, r.h), w: b - a, h: Math.min(depth, r.h) };
  return null;
}

// The landing of an opening in whichever part of the room holds it.
function landingIn(opening, parts) {
  for (const p of parts) { const l = landingOf(opening, p); if (l) return l; }
  return null;
}

// The line a bed's headboard sits on, and its span along that line.
function headLine(bed) {
  const head = HEAD_WALL[bed.rotation];
  if (head === 'n') return { head, at: bed.y, span: [bed.x, bed.x + bed.w] };
  if (head === 's') return { head, at: bed.y + bed.h, span: [bed.x, bed.x + bed.w] };
  if (head === 'w') return { head, at: bed.x, span: [bed.y, bed.y + bed.h] };
  return { head, at: bed.x + bed.w, span: [bed.y, bed.y + bed.h] };
}

// Openings lying on the line (n/s: horizontal openings near y = at; e/w: vertical near x = at).
function onLine(opening, head, at, tol = LINE_TOL) {
  const vertical = String(opening.dir) === 'vertical';
  if ((head === 'n' || head === 's') === vertical) return false;
  return Math.abs((vertical ? num(opening.x) : num(opening.y)) - at) <= tol;
}

// Is the edge of part p on side `wall`, over `span`, open to another part of the room?
function isOpen(p, wall, span, parts) {
  return parts.some((q) => {
    if (q === p) return false;
    const touch = wall === 'n' ? Math.abs(q.y + q.h - p.y) < 0.6 : wall === 's' ? Math.abs(q.y - (p.y + p.h)) < 0.6
      : wall === 'w' ? Math.abs(q.x + q.w - p.x) < 0.6 : Math.abs(q.x - (p.x + p.w)) < 0.6;
    if (!touch) return false;
    const [qa, qb] = wall === 'n' || wall === 's' ? [q.x, q.x + q.w] : [q.y, q.y + q.h];
    return Math.min(qb, span[1]) - Math.max(qa, span[0]) > 0.5;
  });
}

// Bed rectangle for a rotation, with its headboard against that wall of part p.
function bedAt(rotation, along, dims, p, inset) {
  const sideways = rotation === 90 || rotation === 270;
  const w = sideways ? dims.length : dims.width, h = sideways ? dims.width : dims.length;
  const wall = HEAD_WALL[rotation];
  if (wall === 'n') return { x: along, y: p.y + inset, w, h, rotation };
  if (wall === 's') return { x: along, y: p.y + p.h - inset - h, w, h, rotation };
  if (wall === 'w') return { x: p.x + inset, y: along, w, h, rotation };
  return { x: p.x + p.w - inset - w, y: along, w, h, rotation };
}

// Free floor beyond one edge of q, up to `max` ft, inside the room (`fits`).
function freeBeyond(q, side, fits, max = 4, step = 0.25) {
  let d = 0;
  while (d + step <= max + EPS) {
    const t = d + step;
    const strip = side === 'n' ? { x: q.x, y: q.y - t, w: q.w, h: t } : side === 's' ? { x: q.x, y: q.y + q.h, w: q.w, h: t }
      : side === 'w' ? { x: q.x - t, y: q.y, w: t, h: q.h } : { x: q.x + q.w, y: q.y, w: t, h: q.h };
    if (!fits(strip)) break;
    d = t;
  }
  return d;
}

function bbox(parts) {
  const x = Math.min(...parts.map((p) => p.x)), y = Math.min(...parts.map((p) => p.y));
  return { x, y, w: Math.max(...parts.map((p) => p.x + p.w)) - x, h: Math.max(...parts.map((p) => p.y + p.h)) - y };
}

/* Is there a PATH_FT wide route through the room, around the obstacles, joining
   every target area? Grid search over the positions of a PATH_FT square agent
   that must fit inside the room. */
function connected(room, obstacles, targets, size = PATH_FT) {
  if (targets.length < 2) return true;
  const { box, fits } = room;
  const x0 = box.x + 0.26, y0 = box.y + 0.26;
  const n = Math.max(1, Math.floor((box.w - 0.52 - size) / GRID) + 1), m = Math.max(1, Math.floor((box.h - 0.52 - size) / GRID) + 1);
  const free = new Uint8Array(n * m);
  const agent = (i, j) => ({ x: x0 + i * GRID, y: y0 + j * GRID, w: size, h: size });
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const a = agent(i, j);
    free[i * m + j] = fits(a) && !obstacles.some((o) => overlaps(a, o)) ? 1 : 0;
  }
  const touching = (t) => {
    const out = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if (free[i * m + j] && overlaps(agent(i, j), t, 0.3)) out.push(i * m + j);
    return out;
  };
  const starts = touching(targets[0]);
  if (!starts.length) return false;
  const seen = new Uint8Array(n * m);
  const stack = [...starts];
  for (const s of starts) seen[s] = 1;
  while (stack.length) {
    const c = stack.pop(), i = Math.floor(c / m), j = c % m;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= m) continue;
      const k = a * m + b;
      if (!seen[k] && free[k]) { seen[k] = 1; stack.push(k); }
    }
  }
  return targets.slice(1).every((t) => touching(t).some((c) => seen[c]));
}

// Strips beside a bed, where a person stands to get in.
function bedSides(bed) {
  const s = 1;
  if (bed.rotation === 90 || bed.rotation === 270) return [{ x: bed.x, y: bed.y - s, w: bed.w, h: s }, { x: bed.x, y: bed.y + bed.h, w: bed.w, h: s }];
  return [{ x: bed.x - s, y: bed.y, w: s, h: bed.h }, { x: bed.x + bed.w, y: bed.y, w: s, h: bed.h }];
}

/**
 * Choose the bed. `context`:
 *   parts     the room's rectangles (finished clear parts when the level has them)
 *   inset     distance from a wall line to a flush headboard
 *   dims      { width, length } of the bed, ft
 *   doors     the room's doorways
 *   reach     reach-in closet fronts (the path must reach them)
 *   windows   the room's windows
 *   zones     door throats and swings (furnitureGeometry.doorClearances)
 *   entry     the doorway the room is entered by
 *   fits      (rect) => inside the room (furnitureGeometry.fitsRoom)
 *   envelopeFits (bed) => the contract clearance envelope fits
 *   clearance { side, foot }
 * Returns the best bed { x, y, w, h, rotation, score, broken, rules } or null.
 */
/* The same bedroom recurs across the candidate plans of one request (and the
   closet planner tries it many times), so results are remembered by geometry. */
const MEMO = new Map();
const MEMO_MAX = 4000;
function memoKey(context) {
  const r = (v) => Math.round(num(v) * 100) / 100;
  const box = (q) => [r(q.x), r(q.y), r(q.w), r(q.h)];
  const open = (o) => [r(o.x), r(o.y), String(o.dir), r(o.width)];
  return JSON.stringify([context.parts.map(box), r(context.inset), context.dims, context.clearance, context.doors.map(open),
    context.windows.map(open), context.zones.map(box), (context.reach || []).map(box), context.entry ? open(context.entry) : null, context.memoTag || '']);
}

function chooseBed(context) {
  const key = context.memo === false ? null : memoKey(context);
  if (key && MEMO.has(key)) { const hit = MEMO.get(key); return hit && { ...hit, broken: [...hit.broken] }; }
  const result = chooseBedUncached(context);
  if (key) { if (MEMO.size >= MEMO_MAX) MEMO.delete(MEMO.keys().next().value); MEMO.set(key, result && { ...result, broken: [...result.broken] }); }
  return result;
}

function chooseBedUncached(context) {
  const { parts, inset, dims, doors, windows, zones, entry, fits, envelopeFits, clearance, reach = [] } = context;
  const single = parts.length === 1 ? parts[0] : null;
  // Free floor beyond an edge: plain arithmetic in a one-rectangle room.
  const beyond = (bed, side) => {
    if (!single) return freeBeyond(bed, side, fits);
    const d = side === 'n' ? bed.y - single.y : side === 's' ? single.y + single.h - (bed.y + bed.h)
      : side === 'w' ? bed.x - single.x : single.x + single.w - (bed.x + bed.w);
    return Math.max(0, Math.min(4, d - inset));
  };
  const room = { box: bbox(parts), fits };
  const landings = doors.map((d) => landingIn(d, parts)).filter(Boolean);
  const candidates = [];
  const seen = new Set();
  for (const p of parts) {
    for (const rotation of [0, 90, 180, 270]) {
      const probe = bedAt(rotation, 0, dims, p, inset);
      const sideways = rotation === 90 || rotation === 270;
      const lo = sideways ? p.y + inset : p.x + inset;
      const hi = sideways ? p.y + p.h - inset - probe.h : p.x + p.w - inset - probe.w;
      if (hi < lo - EPS) continue;
      const stops = new Set([lo, hi, (lo + hi) / 2]);
      for (let a = lo; a <= hi + EPS; a += GRID) stops.add(Math.min(a, hi));
      for (const along of stops) {
        const bed = bedAt(rotation, along, dims, p, inset);
        const key = `${rotation}:${bed.x.toFixed(2)}:${bed.y.toFixed(2)}`;
        if (seen.has(key) || !fits(bed)) continue;
        seen.add(key);
        const { head, at, span } = headLine(bed);
        if (isOpen(p, head, span, parts)) continue;               // not a wall
        const broken = [];
        if (zones.some((z) => overlaps(bed, z, 0.25))) broken.push('door swing');
        if (landings.some((l) => overlaps(bed, l))) broken.push('doorway landing');
        if (doors.some((d) => onLine(d, head, at) && spanOf(d)[0] < span[1] + HEAD_DOOR_FT && spanOf(d)[1] > span[0] - HEAD_DOOR_FT)) broken.push('doorway beside headboard');
        if (!envelopeFits(bed)) broken.push('bed clearances');

        let score = 0;
        score += windows.filter((w) => onLine(w, head, at))
          .reduce((sum, w) => sum + Math.max(0, Math.min(spanOf(w)[1], span[1]) - Math.max(spanOf(w)[0], span[0])), 0) * 0.3; // across a window (a mild preference: a bed under a window is common)
        if (entry && onLine(entry, head, at)) score += 3;                  // on the wall you walk in through
        score += doors.filter((d) => onLine(d, head, at)).length * 1.5;    // any doorway on the headboard wall
        const wallMid = head === 'n' || head === 's' ? p.x + p.w / 2 : p.y + p.h / 2;
        score += Math.abs((span[0] + span[1]) / 2 - wallMid) * 0.35;       // off centre
        const sideWalls = head === 'n' || head === 's' ? ['w', 'e'] : ['n', 's'];
        const sides = sideWalls.map((s) => beyond(bed, s));
        const foot = beyond(bed, OPPOSITE[head]);
        for (const s of sides) score += Math.max(0, clearance.side - s) * 2;
        score += Math.max(0, 3 - foot) * 1.5;
        score += Math.max(0, 1.5 - Math.max(...sides)) * 4;               // one side truly usable
        if (entry && parts.some((q) => wallOf(entry, q) === OPPOSITE[head]) && spanOf(entry)[0] < span[1] && spanOf(entry)[1] > span[0]) {
          score += 1;                                                     // door lined up with the foot
        }
        candidates.push({ ...bed, score, broken });
      }
    }
  }
  if (!candidates.length) return null;
  // Fewest broken rules first, then score. The path check is the costly one, so it
  // runs down the ranking only until a candidate passes.
  candidates.sort((a, b) => a.broken.length - b.broken.length || a.score - b.score);
  const targets = [...landings, ...reach];
  for (const c of candidates.slice(0, 40)) {
    if (c.broken.length) break;
    const ok = connected(room, [c], targets) && bedSides(c).some((side) => connected(room, [c], [...targets.slice(0, 1), side]));
    if (ok) return { ...c, rules: 'all' };
    c.broken.push('walking path');
  }
  candidates.sort((a, b) => a.broken.length - b.broken.length || a.score - b.score);
  return { ...candidates[0], rules: candidates[0].broken.length ? 'best available' : 'all' };
}

/* Nightstands beside the headboard and a dresser on another wall, each kept out of
   doorways, landings, the bed, the bed's clearance and the paths. */
function companions(bed, context) {
  const key = context.memo === false ? null : `c${memoKey(context)}|${JSON.stringify([bed.x, bed.y, bed.w, bed.h, bed.rotation, Boolean(context.large), context.envelope ? [context.envelope.x, context.envelope.y, context.envelope.w, context.envelope.h] : null])}`;
  if (key && MEMO.has(key)) return MEMO.get(key).map((q) => ({ ...q }));
  const result = companionsUncached(bed, context);
  if (key) { if (MEMO.size >= MEMO_MAX) MEMO.delete(MEMO.keys().next().value); MEMO.set(key, result.map((q) => ({ ...q }))); }
  return result;
}

function companionsUncached(bed, context) {
  const { parts, inset, doors, zones, fits, large, reach = [] } = context;
  const GAP = 0.3; // a little over the collision pass's 0.25 ft, so it keeps these positions
  const room = { box: bbox(parts), fits };
  const landings = doors.map((d) => landingIn(d, parts)).filter(Boolean);
  const out = [];
  const blocked = (q, extra = []) => !fits(q) || zones.some((z) => overlaps(q, z, GAP)) ||
    landings.some((l) => overlaps(q, l)) || [bed, ...extra].some((o) => overlaps(q, o, GAP));
  const { head } = headLine(bed);
  const ns = 1.5, gap = 0.35;
  const stands = head === 'n' ? [{ x: bed.x - gap - ns, y: bed.y }, { x: bed.x + bed.w + gap, y: bed.y }]
    : head === 's' ? [{ x: bed.x - gap - ns, y: bed.y + bed.h - ns }, { x: bed.x + bed.w + gap, y: bed.y + bed.h - ns }]
    : head === 'w' ? [{ x: bed.x, y: bed.y - gap - ns }, { x: bed.x, y: bed.y + bed.h + gap }]
    : [{ x: bed.x + bed.w - ns, y: bed.y - gap - ns }, { x: bed.x + bed.w - ns, y: bed.y + bed.h + gap }];
  for (const s of stands) {
    const q = { ...s, w: ns, h: ns };
    if (!blocked(q, out)) out.push({ kind: 'nightstand', ...q });
  }
  // Dresser: 5 x 1.75 ft (4 ft in smaller bedrooms), its back on a real wall that
  // is not the headboard's, 3 ft clear in front, preferring the wall facing the bed.
  const len = large ? 5 : 4, dep = 1.75, front = 3;
  const order = [OPPOSITE[head], ...['n', 's', 'e', 'w'].filter((w) => w !== head && w !== OPPOSITE[head])];
  const targets = [...landings, ...reach];
  for (const wall of order) {
    for (const p of parts) {
      const horizontal = wall === 'n' || wall === 's';
      const lo = horizontal ? p.x + inset : p.y + inset, hi = horizontal ? p.x + p.w - inset - len : p.y + p.h - inset - len;
      const stops = [];
      for (let a = lo; a <= hi + EPS; a += GRID) stops.push(a);
      const mid = (lo + hi) / 2;
      stops.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      for (const a of stops) {
        const q = horizontal
          ? { x: a, y: wall === 'n' ? p.y + inset : p.y + p.h - inset - dep, w: len, h: dep }
          : { x: wall === 'w' ? p.x + inset : p.x + p.w - inset - dep, y: a, w: dep, h: len };
        if (isOpen(p, wall, horizontal ? [q.x, q.x + q.w] : [q.y, q.y + q.h], parts)) continue;
        const infront = wall === 'n' ? { x: q.x, y: q.y + dep, w: len, h: front } : wall === 's' ? { x: q.x, y: q.y - front, w: len, h: front }
          : wall === 'w' ? { x: q.x + dep, y: q.y, w: front, h: len } : { x: q.x - front, y: q.y, w: front, h: len };
        if (blocked(q, out) || !fits(infront) || overlaps(infront, bed) || out.some((o) => overlaps(infront, o))) continue;
        if (context.envelope && overlaps(q, context.envelope, GAP)) continue;
        if (!connected(room, [bed, q], targets)) continue;
        out.push({ kind: 'dresser', ...q });
        return out;
      }
    }
  }
  return out;
}

/* A check on delivered bedrooms (diagnostics, not a generation gate). `fitsIn(room)`
   returns the room's inside test, as used by the placer. */
function bedroomLayoutIssues(level, fitsIn) {
  const issues = [];
  for (const room of level?.rooms || []) {
    if (!/^(primary_)?bedroom$|^guest_bedroom$/.test(String(room.type))) continue;
    const bed = (level.furniture || []).find((f) => String(f.roomId) === String(room.id) && /^bed_/.test(String(f.kind)));
    if (!bed) continue;
    const parts = room.parts?.length ? room.parts.map((p) => ({ x: num(p.x), y: num(p.y), w: num(p.w), h: num(p.h) }))
      : [{ x: num(room.x), y: num(room.y), w: num(room.w), h: num(room.h) }];
    const fits = fitsIn(room);
    const b = { x: num(bed.x), y: num(bed.y), w: num(bed.w), h: num(bed.h), rotation: num(bed.rotation) };
    const { head, at, span } = headLine(b);
    const beyond = freeBeyond(b, head, fits, 2);
    if (beyond >= 1) issues.push({ roomId: room.id, rule: 'headboard not against a wall', gapFt: beyond });
    const doors = (level.doors || []).filter((d) => [d.a, d.b].map(String).includes(String(room.id)) && !d.garageDoor);
    for (const d of doors) {
      const l = landingIn(d, parts);
      if (l && overlaps(b, l)) issues.push({ roomId: room.id, rule: 'bed in a doorway landing', door: d.id ?? null });
      if (onLine(d, head, at) && spanOf(d)[0] < span[1] + HEAD_DOOR_FT && spanOf(d)[1] > span[0] - HEAD_DOOR_FT) {
        issues.push({ roomId: room.id, rule: 'doorway beside the headboard', door: d.id ?? null });
      }
    }
  }
  return issues;
}

module.exports = { chooseBed, companions, bedroomLayoutIssues, landingOf, landingIn, wallOf, spanOf, connected, headLine, overlaps, bbox, HEAD_WALL };
