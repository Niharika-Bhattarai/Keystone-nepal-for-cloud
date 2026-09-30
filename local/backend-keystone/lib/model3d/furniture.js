'use strict';

// Parametric furniture for every kind the plan engine places, plus the dressing
// the plan does not carry (rugs, lamps, art, a TV, plants, pillows). Everything
// here goes on the level's "Furniture" node: the photoreal bake removes that node
// and places its own models (bake_house.py), so this is the instant model only.
//
// Items arrive as world-space rectangles (feet) plus saved orientation/closet
// metadata. Honor those conventions first; use room walls for inferred backing.
//
// Pieces are built in a local frame: u runs along the item's back (the wall it
// stands against), v runs from the back into the room, y is height above the
// floor. `ctx` (optional) tells a piece about its room: its type, the ceiling
// height and whether a stretch of wall is free of doors and windows (for art,
// mirrors, upper cabinets and a range hood).

function againstSide(r, room) {
  // Which side of the item is closest to a room wall: 'n' (min z), 's', 'w' (min x), 'e'.
  const d = { n: r.z0 - room.z0, s: room.z1 - r.z1, w: r.x0 - room.x0, e: room.x1 - r.x1 };
  return Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
}

function furnitureSide(item, room) {
  const kind = String(item.kind || '').replace(/_\d+$/, '');
  // The plan's placers record which side a piece's back is on (sofas, consoles,
  // chairs, kitchen runs); the nearest wall is only a guess for floating pieces.
  if (['n', 's', 'e', 'w'].includes(item.back)) return item.back;
  // Plan bed rotation is clockwise in x/right, y/down. The footprint is already
  // rotated, so select the headboard edge without swapping dimensions again.
  if (/^bed(?:_queen|_king|_full|_twin)?$/.test(kind) && [0, 90, 180, 270].includes(item.rotation)) {
    return { 0: 'n', 90: 'e', 180: 's', 270: 'w' }[item.rotation];
  }
  // Saved toilet symbols use a left-hand tank at 90, and a top tank otherwise
  // (including omitted rotation). This is intentionally not the bed convention.
  if (kind === 'toilet') return item.rotation === 90 ? 'w' : 'n';
  if (kind === 'closet_storage') {
    const rear = { top: 's', bottom: 'n', left: 'e', right: 'w' }[item.closetFront];
    if (rear) return rear;
    // Older storage slots lack closetFront: their long dimension is the run,
    // not its depth. Only infer a backing wall parallel to that run.
    const r = item.rect;
    return r.x1 - r.x0 >= r.z1 - r.z0
      ? (r.z0 - room.z0 <= room.z1 - r.z1 ? 'n' : 's')
      : (r.x0 - room.x0 <= room.x1 - r.x1 ? 'w' : 'e');
  }
  return againstSide(item.rect, room);
}

// Sub-rectangle along one side: depth `t` measured into the item from side `side`.
function strip(r, side, t) {
  if (side === 'n') return { x0: r.x0, x1: r.x1, z0: r.z0, z1: Math.min(r.z1, r.z0 + t) };
  if (side === 's') return { x0: r.x0, x1: r.x1, z0: Math.max(r.z0, r.z1 - t), z1: r.z1 };
  if (side === 'w') return { x0: r.x0, x1: Math.min(r.x1, r.x0 + t), z0: r.z0, z1: r.z1 };
  return { x0: Math.max(r.x0, r.x1 - t), x1: r.x1, z0: r.z0, z1: r.z1 };
}
function inset(r, a) { return { x0: r.x0 + a, x1: r.x1 - a, z0: r.z0 + a, z1: r.z1 - a }; }
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };

/* A local frame on rectangle r with its back on `side`: u along the back (0..L),
   v into the room (0..D). Returns helpers that build in that frame. */
function frame(mb, node, r, side, y) {
  const L = side === 'n' || side === 's' ? r.x1 - r.x0 : r.z1 - r.z0;
  const D = side === 'n' || side === 's' ? r.z1 - r.z0 : r.x1 - r.x0;
  const at = (u, v) => side === 'n' ? [r.x0 + u, r.z0 + v] : side === 's' ? [r.x1 - u, r.z1 - v]
    : side === 'w' ? [r.x0 + v, r.z1 - u] : [r.x1 - v, r.z0 + u];
  const uDir = side === 'n' ? [1, 0] : side === 's' ? [-1, 0] : side === 'w' ? [0, -1] : [0, 1];
  const vDir = side === 'n' ? [0, 1] : side === 's' ? [0, -1] : side === 'w' ? [1, 0] : [-1, 0];
  const box = (u0, u1, v0, v1, y0, y1, mat) => {
    if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4 || y1 - y0 < 1e-4) return;
    const [ax, az] = at(u0, v0), [bx, bz] = at(u1, v1);
    mb.addBox(node, [Math.min(ax, bx), y + y0, Math.min(az, bz)], [Math.max(ax, bx), y + y1, Math.max(az, bz)], mat);
  };
  // A soft solid: chamfered cross-section in the (v, y) plane, run along u.
  const soft = (u0, u1, v0, v1, y0, y1, mat, c = null) => {
    const ch = Math.min(c ?? 0.22, (v1 - v0) / 2.2, (y1 - y0) / 2.2);
    if (u1 - u0 < 1e-4 || ch <= 0) return box(u0, u1, v0, v1, y0, y1, mat);
    const sec = [[v0 + ch, y0], [v1 - ch, y0], [v1, y0 + ch], [v1, y1 - ch], [v1 - ch, y1], [v0 + ch, y1], [v0, y1 - ch], [v0, y0 + ch]];
    const poly = sec.map(([v, h]) => { const [x, z] = at(u0, v); return [x, y + h, z]; });
    mb.addExtrusion(node, poly, [uDir[0] * (u1 - u0), 0, uDir[1] * (u1 - u0)], mat);
  };
  // A soft solid run along v instead (pillows lying across a bed).
  const softV = (u0, u1, v0, v1, y0, y1, mat, c = null) => {
    const ch = Math.min(c ?? 0.22, (u1 - u0) / 2.2, (y1 - y0) / 2.2);
    if (v1 - v0 < 1e-4 || ch <= 0) return box(u0, u1, v0, v1, y0, y1, mat);
    const sec = [[u0 + ch, y0], [u1 - ch, y0], [u1, y0 + ch], [u1, y1 - ch], [u1 - ch, y1], [u0 + ch, y1], [u0, y1 - ch], [u0, y0 + ch]];
    const poly = sec.map(([u, h]) => { const [x, z] = at(u, v0); return [x, y + h, z]; });
    mb.addExtrusion(node, poly, [vDir[0] * (v1 - v0), 0, vDir[1] * (v1 - v0)], mat);
  };
  // Vertical cylinder (n-gon prism) centred at (u, v).
  const post = (u, v, rad, y0, y1, mat, n = 10) => {
    const [cx, cz] = at(u, v);
    const ring = [...Array(n).keys()].map((i) => [cx + rad * Math.cos((i + 0.5) * 2 * Math.PI / n), cz + rad * Math.sin((i + 0.5) * 2 * Math.PI / n)]);
    mb.addPrism(node, ring, y + y0, y + y1, mat);
  };
  // Tapered vertical n-gon (lamp shades, pots): radius r0 at y0, r1 at y1.
  const cone = (u, v, r0, r1, y0, y1, mat, n = 10) => {
    const [cx, cz] = at(u, v);
    const ring = (rad, h) => [...Array(n).keys()].map((i) => [cx + rad * Math.cos((i + 0.5) * 2 * Math.PI / n), y + h, cz + rad * Math.sin((i + 0.5) * 2 * Math.PI / n)]);
    const pts = [...ring(r0, y0), ...ring(r1, y1)];
    const faces = { ny: [...Array(n).keys()], py: [...Array(n).keys()].map((i) => i + n) };
    for (let i = 0; i < n; i++) faces['s' + i] = [i, (i + 1) % n, ((i + 1) % n) + n, i + n];
    mb.addSolid(node, pts, faces, mat);
  };
  // Horizontal cylinder along u (wheels, rolls), centred at (v, h) in the section.
  const wheel = (u0, u1, v, h, rad, mat, n = 12) => {
    const poly = [...Array(n).keys()].map((i) => { const a = (i + 0.5) * 2 * Math.PI / n; const [x, z] = at(u0, v + rad * Math.cos(a)); return [x, y + h + rad * Math.sin(a), z]; });
    mb.addExtrusion(node, poly, [uDir[0] * (u1 - u0), 0, uDir[1] * (u1 - u0)], mat);
  };
  // Horizontal cylinder across v (a car's wheels): centred at u, height h, from v0 to v1.
  const wheelAcross = (u, v0, v1, h, rad, mat, n = 12) => {
    const poly = [...Array(n).keys()].map((i) => { const a = (i + 0.5) * 2 * Math.PI / n; const [x, z] = at(u + rad * Math.cos(a), v0); return [x, y + h + rad * Math.sin(a), z]; });
    mb.addExtrusion(node, poly, [vDir[0] * (v1 - v0), 0, vDir[1] * (v1 - v0)], mat);
  };
  return { L, D, box, soft, softV, post, cone, wheel, wheelAcross, at };
}

// Deterministic small choices (art colours) from a position, so a model is stable.
function pick(r, list) {
  const h = Math.abs(Math.round(r.x0 * 7 + r.z0 * 13 + r.x1 * 3 + r.z1 * 5));
  return list[h % list.length];
}

/* Art on a wall: a framed canvas centred at `mid` (world coordinate along the wall),
   `width` ft wide, its centre at height `cy`. `wall` is the room side, `room` the
   room rectangle; the frame hangs 0.1 ft off the wall face. */
function wallArt(mb, node, room, wall, mid, width, height, cy, y, tones, record = null) {
  const T = 0.12, off = 0.18;
  record?.(tones.length === 1 && tones[0] === 'mirror' ? 'mirror' : 'art', { wall, along: [mid - width / 2, mid + width / 2] }, cy - height / 2, cy + height / 2);
  const a = mid - width / 2, b = mid + width / 2, y0 = y + cy - height / 2, y1 = y + cy + height / 2;
  const slab = (d0, d1, lo, hi, u0, u1, mat) => {
    if (wall === 'n') mb.addBox(node, [u0, lo, room.z0 + d0], [u1, hi, room.z0 + d1], mat);
    else if (wall === 's') mb.addBox(node, [u0, lo, room.z1 - d1], [u1, hi, room.z1 - d0], mat);
    else if (wall === 'w') mb.addBox(node, [room.x0 + d0, lo, u0], [room.x0 + d1, hi, u1], mat);
    else mb.addBox(node, [room.x1 - d1, lo, u0], [room.x1 - d0, hi, u1], mat);
  };
  slab(off, off + T, y0, y1, a, b, 'art-frame');
  const iy0 = y0 + 0.12, iy1 = y1 - 0.12, ia = a + 0.12, ib = b - 0.12;
  if (tones.length === 1) { slab(off + T, off + T + 0.02, iy0, iy1, ia, ib, tones[0]); return; }
  // An abstract composition, never stripes (three equal bands read as a flag): a
  // ground, one large block off-centre and one small accent, each a little proud.
  const W = ib - ia, H = iy1 - iy0;
  slab(off + T, off + T + 0.02, iy0, iy1, ia, ib, tones[0]);
  slab(off + T + 0.02, off + T + 0.04, iy0 + H * 0.12, iy0 + H * 0.68, ia + W * 0.1, ia + W * 0.58, tones[1]);
  slab(off + T + 0.04, off + T + 0.06, iy0 + H * 0.55, iy0 + H * 0.86, ia + W * 0.66, ia + W * 0.86, tones[2]);
}

const centerRect = ([x, z], rad) => ({ x0: x - rad, x1: x + rad, z0: z - rad, z1: z + rad });
// A frame-local rectangle (u along the back, v into the room) in world feet.
const worldOf = (f, u0, u1, v0, v1) => { const [ax, az] = f.at(u0, v0), [bx, bz] = f.at(u1, v1); return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) }; };

const ART = [
  ['art-sand', 'art-terracotta', 'art-cream'],
  ['art-sky', 'art-sea', 'art-sand'],
  ['art-olive', 'art-cream', 'art-terracotta'],
  ['art-ink', 'art-sky', 'art-cream'],
];

function addPlant(f, u, v, scale = 1) {
  f.cone(u, v, 0.45 * scale, 0.55 * scale, 0, 1.3 * scale, 'pot', 10);
  f.post(u, v, 0.5 * scale, 1.3 * scale, 1.35 * scale, 'soil', 10);
  // Foliage: three stacked, staggered tufts.
  f.cone(u, v, 0.35 * scale, 0.95 * scale, 1.35 * scale, 2.4 * scale, 'plant', 8);
  f.cone(u + 0.1 * scale, v - 0.1 * scale, 0.9 * scale, 0.6 * scale, 2.4 * scale, 3.3 * scale, 'plant-dark', 8);
  f.cone(u - 0.05 * scale, v + 0.05 * scale, 0.55 * scale, 0.05 * scale, 3.3 * scale, 4.0 * scale, 'plant', 8);
}

function addTableLamp(f, u, v, y0) {
  f.post(u, v, 0.28, y0, y0 + 0.08, 'metal', 10);
  f.cone(u, v, 0.2, 0.12, y0 + 0.08, y0 + 0.95, 'lamp-base', 10);
  f.cone(u, v, 0.55, 0.38, y0 + 0.95, y0 + 1.75, 'lamp-shade', 12);
}

function addFurniture(mb, node, item, room, y, ctx = {}) {
  const r = item.rect;
  // Dressing the plan does not carry is recorded for the photoreal bake, so it
  // can place matching pieces: { kind, rect (world feet), y0, y1, wall }.
  const record = (kind, q, y0, y1, extra = {}) => ctx.record?.({ kind, rect: q, y0, y1, ...extra });
  const box = (q, y0, y1, mat) => mb.addBox(node, [q.x0, y + y0, q.z0], [q.x1, y + y1, q.z1], mat);
  const side = furnitureSide(item, room);
  const k = String(item.kind || '').replace(/_\d+$/, '');
  const roomType = String(ctx.roomType || '');
  const wallClear = ctx.wallClear || (() => false);
  const ceiling = Number(ctx.ceiling) || 9;
  const legs = (q, top, mat, t = 0.15) => {
    const s = inset(q, 0.1);
    for (const [x, z] of [[s.x0, s.z0], [s.x1 - t, s.z0], [s.x0, s.z1 - t], [s.x1 - t, s.z1 - t]]) mb.addBox(node, [x, y, z], [x + t, y + top, z + t], mat);
  };
  const f = frame(mb, node, r, side, y);
  // First free spot of radius `rad` among local (u, v) candidates, or null.
  const spot = (cands, rad) => cands.find(([u, v]) => {
    if (!ctx.free) return false;
    const [x, z] = f.at(u, v);
    return ctx.free({ x0: x - rad, x1: x + rad, z0: z - rad, z1: z + rad });
  }) || null;
  // Where the item's back wall is in world coordinates, and its span along it.
  const along = side === 'n' || side === 's' ? [r.x0, r.x1] : [r.z0, r.z1];
  const mid = (along[0] + along[1]) / 2;

  switch (k) {
    case 'bed_queen': case 'bed_king': case 'bed_full': case 'bed_twin': case 'bed': {
      const { L, D } = f;
      // Frame and plinth in wood; the headboard frame is the full-width back strip.
      box(inset(r, 0.1), 0, 1.1, 'wood');
      box(strip(r, side, 0.3), 0, 3.6, 'wood');
      // Padded headboard panel in front of the frame, with a slim top roll.
      f.soft(0.2, L - 0.2, 0.3, 0.55, 1.2, 3.35, 'headboard', 0.1);
      f.soft(0.15, L - 0.15, 0.25, 0.6, 3.25, 3.55, 'headboard', 0.12);
      // Mattress, duvet over the lower two thirds, a folded throw at the foot.
      f.soft(0.2, L - 0.2, 0.35, D - 0.15, 1.1, 1.85, 'mattress', 0.12);
      f.soft(0.12, L - 0.12, D * 0.34, D - 0.08, 1.35, 2.0, 'duvet', 0.14);
      f.soft(0.1, L - 0.1, D - 1.2, D - 0.06, 1.45, 2.08, 'throw', 0.1);
      // Pillows: two sleeping pillows against the headboard, two smaller in front.
      const pw = Math.min(2.2, (L - 0.9) / 2);
      for (const u0 of [0.35, L - 0.35 - pw]) f.soft(u0, u0 + pw, 0.62, 1.55, 1.85, 2.45, 'pillow', 0.18);
      const cw = Math.min(1.4, (L - 1.6) / 2);
      if (cw > 0.6) for (const u0 of [L / 2 - cw - 0.1, L / 2 + 0.1]) f.soft(u0, u0 + cw, 1.4, 1.95, 1.9, 2.55, 'cushion-accent', 0.14);
      // A rug under the lower bed, reaching past its sides and foot.
      f.box(-1.4, L + 1.4, D * 0.35, D + 1.8, 0.005, 0.03, 'rug');
      record('rug', worldOf(f, -1.4, L + 1.4, D * 0.35, D + 1.8), 0, 0.03, { under: 'bed' });
      // Art above the headboard when that wall is free of doors and windows.
      if (room && wallClear(side, mid - 2.4, mid + 2.4)) wallArt(mb, node, room, side, mid, Math.min(4.2, L * 0.8), 2.1, 5.35, y, pick(r, ART), record);
      return;
    }
    case 'nightstand': {
      box(inset(r, 0.05), 0.35, 2.0, 'wood');
      legs(r, 0.35, 'wood', 0.12);
      f.box(0.1, f.L - 0.1, f.D - 0.08, f.D - 0.02, 1.1, 1.15, 'metal'); // drawer pull line
      addTableLamp(f, f.L / 2, f.D / 2, 2.0);
      record('table_lamp', r, 2.0, 3.75);
      return;
    }
    case 'closet_storage': {
      // Open shelving, backing and hanging rail. Every part stays inside the
      // plan's storage rectangle; the access aisle remains empty.
      const t = Math.min(0.08, (r.x1 - r.x0) / 4, (r.z1 - r.z0) / 4);
      box(strip(r, side, t), 0, 6, 'wood');
      for (const edge of (side === 'n' || side === 's') ? ['w', 'e'] : ['n', 's']) box(strip(r, edge, t), 0, 6, 'wood');
      for (const z of [1, 3.5, 5.75]) box(r, z, z + t, 'wood');
      const inner = inset(r, t);
      const rail = side === 'n' || side === 's'
        ? { ...inner, z0: (r.z0 + r.z1 - t) / 2, z1: (r.z0 + r.z1 + t) / 2 }
        : { ...inner, x0: (r.x0 + r.x1 - t) / 2, x1: (r.x0 + r.x1 + t) / 2 };
      box(rail, 5.4, 5.4 + t, 'metal');
      return;
    }
    case 'dresser': {
      box(inset(r, 0.03), 0.3, 2.8, 'wood');
      legs(r, 0.3, 'wood', 0.12);
      // Three drawer rows with pulls.
      for (const h of [1.05, 1.85]) f.box(0.08, f.L - 0.08, f.D - 0.04, f.D, h - 0.02, h + 0.02, 'wood-dark');
      for (const h of [0.7, 1.45, 2.25]) for (const u of [f.L * 0.3, f.L * 0.7]) f.box(u - 0.2, u + 0.2, f.D - 0.02, f.D + 0.05, h - 0.03, h + 0.03, 'metal');
      if (room && wallClear(side, mid - 1.6, mid + 1.6)) {
        // A round-cornered mirror above.
        wallArt(mb, node, room, side, mid, Math.min(2.8, f.L * 0.7), 2.3, 4.5, y, ['mirror'], record);
      }
      return;
    }
    case 'console': {
      if (/living|family|great/.test(roomType)) {
        // Media console with a TV on it; art does not compete with the screen.
        f.box(0.05, f.L - 0.05, 0, f.D, 0.35, 1.9, 'media');
        legs(r, 0.35, 'metal', 0.1);
        for (const u of [f.L / 3, 2 * f.L / 3]) f.box(u - 0.02, u + 0.02, f.D, f.D + 0.02, 0.45, 1.8, 'wood-dark');
        const tw = Math.min(4.6, f.L * 0.85), th = tw * 0.575, u0 = (f.L - tw) / 2;
        f.box(f.L / 2 - 0.5, f.L / 2 + 0.5, 0.25, 0.75, 1.9, 1.98, 'tv-frame');                // stand
        f.box(f.L / 2 - 0.08, f.L / 2 + 0.08, 0.45, 0.55, 1.98, 2.35, 'tv-frame');
        f.box(u0, u0 + tw, 0.42, 0.58, 2.3, 2.3 + th, 'tv-frame');                                // bezel
        f.box(u0 + 0.05, u0 + tw - 0.05, 0.58, 0.6, 2.35, 2.25 + th, 'tv-screen');               // glass
        record('tv', r, 2.3, 2.3 + th, { width: tw, back: side });
        const plantAt = spot([[-0.9, f.D / 2], [f.L + 0.9, f.D / 2]], 0.75);
        if (plantAt) { addPlant(f, plantAt[0], plantAt[1], 0.8); record('plant', centerRect(f.at(...plantAt), 0.6), 0, 3.2); }
        return;
      }
      // Hall console: slim table, a lamp and art or a mirror above.
      f.box(0, f.L, 0, f.D, 2.55, 2.7, 'wood');
      for (const [u, v] of [[0.1, 0.1], [f.L - 0.22, 0.1], [0.1, f.D - 0.22], [f.L - 0.22, f.D - 0.22]]) f.box(u, u + 0.12, v, v + 0.12, 0, 2.55, 'wood');
      f.box(0.1, f.L - 0.1, 0.1, f.D - 0.1, 0.5, 0.58, 'wood');
      addTableLamp(f, Math.min(1, f.L * 0.2), f.D / 2, 2.7);
      if (room && wallClear(side, mid - 1.8, mid + 1.8)) wallArt(mb, node, room, side, mid, Math.min(3.2, f.L * 0.7), 2.2, 5.1, y, /entry|foyer/.test(roomType) ? ['mirror'] : pick(r, ART), record);
      return;
    }
    case 'bench':
      f.soft(0, f.L, 0, f.D, 1.15, 1.55, 'cushion', 0.12);
      f.box(0, f.L, 0, f.D, 0.35, 1.15, 'wood');
      legs(r, 0.35, 'wood', 0.12);
      if (room && wallClear(side, mid - 1.5, mid + 1.5)) {
        // Coat hooks on a rail above.
        const wallR = strip(r, side, 0.01);
        const railR = side === 'n' ? { ...wallR, z0: room.z0 + 0.05, z1: room.z0 + 0.15 } : side === 's' ? { ...wallR, z0: room.z1 - 0.15, z1: room.z1 - 0.05 }
          : side === 'w' ? { ...wallR, x0: room.x0 + 0.05, x1: room.x0 + 0.15 } : { ...wallR, x0: room.x1 - 0.15, x1: room.x1 - 0.05 };
        box(railR, 5.1, 5.45, 'wood');
      }
      return;
    case 'desk': {
      f.box(0, f.L, 0, f.D, 2.35, 2.5, 'wood');
      for (const [u, v] of [[0.08, 0.08], [f.L - 0.2, 0.08], [0.08, f.D - 0.2], [f.L - 0.2, f.D - 0.2]]) f.box(u, u + 0.12, v, v + 0.12, 0, 2.35, 'metal');
      // Monitor, keyboard and a lamp.
      const mw = Math.min(2.1, f.L * 0.4);
      f.box(f.L / 2 - 0.25, f.L / 2 + 0.25, 0.3, 0.6, 2.5, 2.55, 'tv-frame');
      f.box(f.L / 2 - 0.05, f.L / 2 + 0.05, 0.4, 0.5, 2.55, 2.95, 'tv-frame');
      f.box(f.L / 2 - mw / 2, f.L / 2 + mw / 2, 0.45, 0.55, 2.85, 2.85 + mw * 0.58, 'tv-frame');
      f.box(f.L / 2 - mw / 2 + 0.04, f.L / 2 + mw / 2 - 0.04, 0.55, 0.57, 2.89, 2.81 + mw * 0.58, 'tv-screen');
      f.box(f.L / 2 - 0.7, f.L / 2 + 0.7, f.D - 1.0, f.D - 0.55, 2.5, 2.54, 'appliance');
      if (f.L >= 4) addTableLamp(f, f.L - 0.5, 0.5, 2.5);
      if (room && wallClear(side, mid - 1.8, mid + 1.8)) wallArt(mb, node, room, side, mid, Math.min(3, f.L * 0.6), 1.8, 5.6, y, pick(r, ART), record);
      return;
    }
    case 'desk_chair': {
      const c = { x0: (r.x0 + r.x1) / 2 - 0.8, x1: (r.x0 + r.x1) / 2 + 0.8, z0: (r.z0 + r.z1) / 2 - 0.8, z1: (r.z0 + r.z1) / 2 + 0.8 };
      const g = frame(mb, node, c, side, y);
      g.post(0.8, 0.8, 0.9, 0.2, 0.3, 'metal', 5);
      g.post(0.8, 0.8, 0.08, 0.3, 1.4, 'metal', 8);
      g.soft(0.1, 1.5, 0.1, 1.5, 1.4, 1.75, 'fabric-dark', 0.12);
      g.soft(0.15, 1.45, 0, 0.3, 1.75, 3.4, 'fabric-dark', 0.12);
      return;
    }
    case 'bookcase': case 'bookshelf': case 'shelving': {
      f.box(0, f.L, 0, 0.08, 0, 6.5, 'wood');
      for (const u of [0, f.L - 0.1]) f.box(u, u + 0.1, 0, f.D, 0, 6.5, 'wood');
      const shelves = [0.3, 1.6, 2.9, 4.2, 5.5, 6.4];
      for (const h of shelves) f.box(0, f.L, 0, f.D, h, h + 0.1, 'wood');
      // Books: runs of spines in a few colours, varying heights.
      const tones = ['book-1', 'book-2', 'book-3', 'book-4'];
      for (let s = 0; s < shelves.length - 1; s++) {
        let u = 0.15, i = s;
        while (u < f.L - 0.4) {
          const w = 0.12 + ((i * 7) % 5) * 0.03, h = 0.75 + ((i * 3) % 4) * 0.08;
          if ((i % 9) !== 4) f.box(u, u + w, 0.1, f.D - 0.1, shelves[s] + 0.1, shelves[s] + 0.1 + h, tones[i % tones.length]);
          u += w + 0.01; i++;
        }
      }
      return;
    }
    case 'sofa': case 'sectional': case 'loveseat': {
      const { L, D } = f;
      const arm = Math.min(0.7, L * 0.1);
      f.box(0.1, L - 0.1, 0.1, D - 0.1, 0, 0.4, 'metal');                    // plinth / feet
      f.soft(0, L, 0, D, 0.4, 1.3, 'fabric-dark', 0.12);                      // base
      f.soft(0, L, 0, 0.75, 1.3, 2.75, 'fabric-dark', 0.2);                   // back
      for (const u0 of [0, L - arm]) f.soft(u0, u0 + arm, 0, D, 1.3, 2.15, 'fabric-dark', 0.2); // arms
      // Seat and back cushions, two or three across.
      const n = L - 2 * arm >= 6 ? 3 : 2, cw = (L - 2 * arm - 0.1 * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const u0 = arm + i * (cw + 0.1);
        f.soft(u0, u0 + cw, 0.75, D - 0.05, 1.3, 1.75, 'cushion', 0.16);
        f.soft(u0, u0 + cw, 0.5, 1.2, 1.75, 2.9, 'cushion', 0.22);
      }
      // Two accent pillows in the corners.
      for (const u0 of [arm + 0.15, L - arm - 1.35]) f.soft(u0, u0 + 1.2, 1.1, 1.5, 1.75, 2.75, 'cushion-accent', 0.18);
      // Art over the sofa, a floor lamp at one end.
      if (room && wallClear(side, mid - 2.6, mid + 2.6)) wallArt(mb, node, room, side, mid, Math.min(5, L * 0.7), 2.6, 5.4, y, pick(r, ART), record);
      const lampAt = spot([[-0.9, 0.7], [L + 0.9, 0.7]], 0.7);
      if (lampAt) {
        record('floor_lamp', centerRect(f.at(...lampAt), 0.65), 0, 6);
        f.post(lampAt[0], lampAt[1], 0.35, 0, 0.08, 'metal', 10);
        f.post(lampAt[0], lampAt[1], 0.05, 0.08, 5.2, 'metal', 6);
        f.cone(lampAt[0], lampAt[1], 0.65, 0.45, 5.0, 6.0, 'lamp-shade', 12);
      }
      const plantAt = spot([[L + 0.9, 0.7], [-0.9, 0.7]].filter(([u]) => !lampAt || u !== lampAt[0]), 0.75);
      if (plantAt) { addPlant(f, plantAt[0], plantAt[1], 1); record('plant', centerRect(f.at(...plantAt), 0.75), 0, 4); }
      return;
    }
    case 'armchair': case 'chair_arm':
      f.soft(0, f.L, 0, f.D, 0.4, 1.4, 'fabric', 0.15);
      f.soft(0, f.L, 0, 0.5, 1.4, 2.8, 'fabric', 0.18);
      return;
    case 'chair': {
      // Upholstered dining chair facing the table (its back is the side away from it).
      const q = inset(r, 0.2);
      box(q, 1.45, 1.55, 'wood');
      legs(q, 1.45, 'wood', 0.1);
      const g = frame(mb, node, q, side, y);
      g.soft(0, g.L, 0, g.D, 1.55, 1.75, 'cushion', 0.08);
      g.soft(0.05, g.L - 0.05, 0, 0.2, 1.75, 3.1, 'cushion', 0.08);
      return;
    }
    case 'coffee_table': {
      const g = f;
      g.box(0, g.L, 0, g.D, 1.25, 1.42, 'wood');
      g.box(0.15, g.L - 0.15, 0.15, g.D - 0.15, 0.3, 0.36, 'wood');
      legs(r, 1.25, 'wood-dark', 0.12);
      // Books and a bowl on top.
      g.box(g.L * 0.2, g.L * 0.2 + 1.0, g.D * 0.3, g.D * 0.3 + 0.75, 1.42, 1.58, 'book-2');
      g.box(g.L * 0.2 + 0.05, g.L * 0.2 + 0.9, g.D * 0.3 + 0.05, g.D * 0.3 + 0.7, 1.58, 1.68, 'book-3');
      g.cone(g.L * 0.7, g.D * 0.5, 0.25, 0.5, 1.42, 1.72, 'pot', 12);
      // A large rug centred on the table, reaching under the sofa's front feet.
      const rug = { x0: r.x0 - 2.2, x1: r.x1 + 2.2, z0: r.z0 - 2.2, z1: r.z1 + 2.2 };
      const clip = room ? { x0: Math.max(rug.x0, room.x0 + 1), x1: Math.min(rug.x1, room.x1 - 1), z0: Math.max(rug.z0, room.z0 + 1), z1: Math.min(rug.z1, room.z1 - 1) } : rug;
      if (clip.x1 > clip.x0 && clip.z1 > clip.z0) { box(clip, 0.005, 0.03, 'rug-living'); record('rug', clip, 0, 0.03); }
      return;
    }
    case 'dining_table': case 'table': {
      box(r, 2.35, 2.52, 'wood');
      legs(r, 2.35, 'wood', 0.22);
      // Runner and a vase down the middle, a pendant over the table.
      const long = r.x1 - r.x0 >= r.z1 - r.z0;
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      const run = long ? { x0: r.x0 + 0.6, x1: r.x1 - 0.6, z0: cz - 0.45, z1: cz + 0.45 } : { x0: cx - 0.45, x1: cx + 0.45, z0: r.z0 + 0.6, z1: r.z1 - 0.6 };
      box(run, 2.52, 2.54, 'throw');
      const g = frame(mb, node, { x0: cx - 0.5, x1: cx + 0.5, z0: cz - 0.5, z1: cz + 0.5 }, 'n', y);
      g.cone(0.5, 0.5, 0.18, 0.28, 2.54, 3.3, 'vase', 10);
      g.cone(0.5, 0.5, 0.2, 0.55, 3.35, 3.9, 'plant', 8);
      const drop = ceiling - 3.1;
      g.post(0.5, 0.5, 0.03, drop + 0.9, ceiling - 0.02, 'metal', 6);
      g.cone(0.5, 0.5, 1.15, 0.35, drop, drop + 0.9, 'pendant', 16);
      record('pendant', { x0: cx - 1.15, x1: cx + 1.15, z0: cz - 1.15, z1: cz + 1.15 }, drop, ceiling);
      g.post(0.5, 0.5, 0.35, drop - 0.02, drop, 'fixture', 12);
      return;
    }
    case 'counter': case 'laundry_counter': case 'kitchen_island': case 'island': {
      box(inset(r, 0.05), 0.35, 2.85, 'cabinet');
      box(inset(r, 0.1), 0, 0.35, 'wood-dark');                               // toe kick
      box(r, 2.85, 3.0, 'countertop');
      if (k === 'kitchen_island' || k === 'island') {
        // Stools along the side facing the living space.
        const g = f, n = Math.max(1, Math.floor(g.L / 2.2));
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) * g.L / n;
          g.post(u, g.D + 0.9, 0.05, 0, 2.45, 'metal', 6);
          g.post(u, g.D + 0.9, 0.55, 0.1, 0.14, 'metal', 10);
          g.post(u, g.D + 0.9, 0.62, 2.45, 2.6, 'wood', 12);
        }
        g.box(0.2, g.L - 0.2, g.D - 0.02, g.D + 0.02, 0.5, 2.7, 'cabinet');
        return;
      }
      // Door and drawer lines on the run.
      for (let u = 1.5; u < f.L - 0.5; u += 1.5) f.box(u - 0.01, u + 0.01, f.D - 0.02, f.D + 0.01, 0.45, 2.75, 'wood-dark');
      f.box(0.1, f.L - 0.1, f.D - 0.02, f.D + 0.01, 2.2, 2.23, 'wood-dark');
      if (k === 'counter' && /kitchen/.test(roomType)) {
        // Appliances standing in this run, as intervals along it.
        const toU = (x, z) => (side === 'n' ? x - r.x0 : side === 's' ? r.x1 - x : side === 'w' ? r.z1 - z : z - r.z0);
        const inRun = (q) => q.x0 < r.x1 && r.x0 < q.x1 && q.z0 < r.z1 && r.z0 < q.z1;
        const apps = (ctx.siblings || []).filter((o) => /^(stove|range|refrigerator|dishwasher)$/.test(o.kind) && inRun(o.rect))
          .map((o) => { const us = [toU(o.rect.x0, o.rect.z0), toU(o.rect.x1, o.rect.z1)]; return { kind: o.kind, u0: Math.min(...us), u1: Math.max(...us) }; });
        const free = [];
        let u = 0;
        for (const q of [...apps].sort((m, n) => m.u0 - n.u0)) { if (q.u0 - 0.15 > u) free.push([u, q.u0 - 0.15]); u = Math.max(u, q.u1 + 0.15); }
        if (f.L > u) free.push([u, f.L]);
        // The sink in the widest clear stretch, with a tap behind it.
        const best = free.filter(([p0, p1]) => p1 - p0 >= 2.2).sort((m, n) => (n[1] - n[0]) - (m[1] - m[0]))[0];
        const sw = best ? Math.min(2.6, best[1] - best[0] - 0.4) : 0;
        if (best) {
          const su = (best[0] + best[1]) / 2;
          f.box(su - sw / 2, su + sw / 2, 0.5, f.D - 0.35, 2.3, 2.99, 'sink');
          f.post(su, 0.3, 0.07, 3.0, 4.0, 'chrome', 8);
          record('sink', worldOf(f, su - sw / 2, su + sw / 2, 0.5, f.D - 0.35), 2.3, 3.0);
          f.box(su - 0.05, su + 0.05, 0.3, 0.95, 3.85, 3.97, 'chrome');
        }
        // Backsplash and upper cabinets on every stretch of the wall behind the run that
        // is solid (no window or doorway): a short cabinet over the fridge, none over
        // the range (its hood).
        const toAlong = (u) => (side === 'n' || side === 'e' ? along[0] + u : along[1] - u);
        const solid = (u0, u1) => room && wallClear(side, Math.min(toAlong(u0), toAlong(u1)), Math.max(toAlong(u0), toAlong(u1)));
        for (let u = 0; u < f.L - 0.5; u += 1) if (solid(u, Math.min(f.L, u + 1))) f.box(u, Math.min(f.L, u + 1), 0, 0.04, 3.0, 4.6, 'backsplash');
        {
          for (const [p0, p1] of free) {
            if (p1 - p0 < 1 || !solid(p0, p1)) continue;
            f.box(p0, p1, 0, 1.1, 4.6, 7.3, 'cabinet');
            for (let c = p0 + 1.5; c < p1 - 0.5; c += 1.5) f.box(c - 0.01, c + 0.01, 1.1, 1.12, 4.7, 7.2, 'wood-dark');
            f.box(p0, p1, 0.9, 1.12, 4.58, 4.62, 'fixture');                  // under-cabinet light
          }
          for (const q of apps.filter((o) => o.kind === 'refrigerator')) if (solid(q.u0, q.u1)) f.box(q.u0, q.u1, 0, 2.2, 6.4, 7.3, 'cabinet');
          for (const [p0, p1] of free.filter(([a0, a1]) => a1 - a0 >= 1 && solid(a0, a1))) record('upper_cabinets', worldOf(f, p0, p1, 0, 1.1), 4.6, 7.3, { back: side });
        }
      }
      return;
    }
    case 'refrigerator': {
      box(inset(r, 0.03), 0, 6.1, 'appliance');
      // French doors, freezer drawer and long handles.
      f.box(f.L / 2 - 0.01, f.L / 2 + 0.01, f.D - 0.02, f.D + 0.01, 2.2, 6.0, 'tv-frame');
      f.box(0.08, f.L - 0.08, f.D - 0.02, f.D + 0.01, 2.1, 2.14, 'tv-frame');
      for (const u of [f.L / 2 - 0.25, f.L / 2 + 0.2]) f.box(u, u + 0.05, f.D + 0.01, f.D + 0.14, 3.2, 5.4, 'chrome');
      f.box(f.L * 0.3, f.L * 0.7, f.D + 0.01, f.D + 0.14, 1.75, 1.82, 'chrome');
      return;
    }
    case 'stove': case 'range': {
      box(r, 0, 3.0, 'appliance');
      box(inset(r, 0.2), 3.0, 3.04, 'tv-frame');
      for (const [a, b] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) f.post(f.L * a, f.D * b, 0.3, 3.04, 3.07, 'metal', 10);
      f.box(0.2, f.L - 0.2, f.D - 0.02, f.D + 0.01, 0.6, 2.3, 'tv-screen');   // oven window
      f.box(0.3, f.L - 0.3, f.D + 0.01, f.D + 0.1, 2.45, 2.52, 'chrome');
      if (room && wallClear(side, along[0] - 0.3, along[1] + 0.3)) {
        // A chimney hood above the range.
        f.box(-0.25, f.L + 0.25, 0, 1.9, 5.6, 6.1, 'appliance');
        f.box(f.L / 2 - 0.65, f.L / 2 + 0.65, 0, 1.0, 6.1, ceiling - 0.02, 'appliance');
        record('range_hood', r, 5.6, ceiling, { back: side });
      }
      return;
    }
    case 'dishwasher': box(r, 0, 2.85, 'appliance'); return;
    case 'washer': case 'dryer': case 'stacked_washer_dryer': {
      const h = k === 'stacked_washer_dryer' ? 6.2 : 3.1;
      box(r, 0, h, 'appliance');
      for (const base of k === 'stacked_washer_dryer' ? [0, 3.1] : [0]) {
        f.box(0.1, f.L - 0.1, f.D - 0.02, f.D + 0.01, base + 2.55, base + 2.95, 'tv-frame');
        f.wheel(f.L / 2 - 0.1, f.L / 2 + 0.1, f.D - 0.05, base + 1.3, 0.72, 'chrome', 16);
      }
      // (the port above is a short cylinder on the face, seen as the round door)
      return;
    }
    case 'vanity': case 'sink': {
      box(inset(r, 0.05), 0.35, 2.7, 'cabinet');
      box(r, 2.7, 2.85, 'countertop');
      const back = side, basinSide = OPP[back];
      box(inset(strip(r, basinSide, 1.4), 0.3), 2.85, 2.95, 'porcelain');
      f.post(f.L / 2, 0.25, 0.06, 2.85, 3.6, 'chrome', 8);
      f.box(f.L / 2 - 0.04, f.L / 2 + 0.04, 0.25, 0.75, 3.5, 3.6, 'chrome');
      if (room && wallClear(side, mid - 1.2, mid + 1.2)) wallArt(mb, node, room, side, mid, Math.min(2.6, f.L - 0.2), 2.6, 4.9, y, ['mirror'], record);
      return;
    }
    case 'toilet': {
      box(inset(r, 0.3), 0, 1.3, 'porcelain');
      box(strip(inset(r, 0.2), side, 0.6), 1.3, 2.6, 'porcelain');
      return;
    }
    case 'shower': case 'tub': case 'bathtub':
      if (k === 'shower') {
        box(r, 0, 0.25, 'porcelain');
        for (const s of ['n', 's', 'w', 'e']) if (s !== side) box(strip(r, s, 0.05), 0.25, 6.5, 'glass');
        f.post(f.L / 2, 0.12, 0.05, 0.25, 6.4, 'chrome', 8);
        f.post(f.L / 2, 0.5, 0.35, 6.3, 6.38, 'chrome', 12);
        return;
      }
      f.soft(0, f.L, 0, f.D, 0, 1.8, 'porcelain', 0.3);
      f.box(0.35, f.L - 0.35, 0.35, f.D - 0.35, 1.75, 1.8, 'water');
      f.post(f.L / 2, 0.15, 0.06, 1.8, 2.3, 'chrome', 8);
      return;
    case 'car': {
      // A car-sized body (about 6.3 x 15.5 ft) centred in the slot, along its long axis.
      const long = (r.x1 - r.x0) >= (r.z1 - r.z0);
      const len = Math.min(15.5, (long ? r.x1 - r.x0 : r.z1 - r.z0) - 0.4), wid = Math.min(6.3, (long ? r.z1 - r.z0 : r.x1 - r.x0) - 0.4);
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      const q = long ? { x0: cx - len / 2, x1: cx + len / 2, z0: cz - wid / 2, z1: cz + wid / 2 } : { x0: cx - wid / 2, x1: cx + wid / 2, z0: cz - len / 2, z1: cz + len / 2 };
      const g = frame(mb, node, q, long ? 'n' : 'w', y);    // u along the car's length, v across
      const { L, D } = g;
      // Lower body with rounded nose and tail (the section is the side profile).
      g.softV(0.05, L - 0.05, 0.08, D - 0.08, 0.7, 2.55, 'car', 0.6);
      // Cabin: a trapezoid in side view, glass all round, with the roof on top.
      const cab = (v0, v1, lift, mat) => {
        const pts = [[L * 0.26, 2.5], [L * 0.8, 2.5], [L * 0.68, 3.95 + lift], [L * 0.38, 3.95 + lift]]
          .map(([u, h]) => { const [x, z] = g.at(u, v0); return [x, y + h, z]; });
        const [vx, vz] = [g.at(0, 1)[0] - g.at(0, 0)[0], g.at(0, 1)[1] - g.at(0, 0)[1]];  // the frame's v direction
        mb.addExtrusion(node, pts, [vx * (v1 - v0), 0, vz * (v1 - v0)], mat);
      };
      cab(0.45, D - 0.45, 0, 'car-glass');
      g.box(L * 0.4, L * 0.66, 0.55, D - 0.55, 3.93, 4.05, 'car');
      // Wheels with chrome hubs, lights, mirrors.
      const wr = 1.05, wheelW = 0.7;
      for (const u of [L * 0.18, L * 0.8]) for (const v0 of [0.02, D - 0.02 - wheelW]) {
        g.wheelAcross(u, v0, v0 + wheelW, wr, wr, 'tire', 14);
        const hub = v0 < D / 2 ? [v0 - 0.03, v0 + 0.05] : [v0 + wheelW - 0.05, v0 + wheelW + 0.03];
        g.wheelAcross(u, hub[0], hub[1], wr, wr * 0.55, 'chrome', 10);
      }
      for (const [u0, u1, mat] of [[0.02, 0.2, 'headlight'], [L - 0.2, L - 0.02, 'taillight']]) {
        g.box(u0, u1, 0.4, 1.4, 1.9, 2.25, mat); g.box(u0, u1, D - 1.4, D - 0.4, 1.9, 2.25, mat);
      }
      for (const v of [-0.25, D - 0.05]) g.box(L * 0.28, L * 0.28 + 0.4, v, v + 0.3, 2.7, 2.95, 'car');
      return;
    }
    case 'treadmill': {
      f.box(0, f.L, 0.3, f.D - 0.3, 0, 0.6, 'tv-frame');
      f.box(0.1, f.L - 0.1, 0.45, f.D - 0.45, 0.6, 0.65, 'rubber');
      for (const v of [0.3, f.D - 0.45]) f.box(f.L - 0.4, f.L - 0.25, v, v + 0.15, 0.6, 4.2, 'metal');
      f.box(f.L - 0.6, f.L - 0.1, 0.3, f.D - 0.3, 4.0, 4.4, 'tv-frame');
      return;
    }
    case 'exercise_mat': case 'play_mat': box(r, 0, 0.06, k === 'play_mat' ? 'art-sky' : 'rubber'); return;
    case 'toy_storage': {
      box(r, 0, 2.2, 'cabinet');
      const n = Math.max(2, Math.floor(f.L / 1.2));
      for (let i = 0; i < n; i++) f.box(0.1 + i * f.L / n, (i + 1) * f.L / n - 0.1, f.D - 0.02, f.D + 0.02, 0.25, 1.0, ['art-terracotta', 'art-sky', 'art-olive', 'art-sand'][i % 4]);
      return;
    }
    case 'outdoor_table':
      box(r, 2.3, 2.45, 'wood'); legs(r, 2.3, 'metal', 0.12);
      {
        const g = frame(mb, node, { x0: (r.x0 + r.x1) / 2 - 0.5, x1: (r.x0 + r.x1) / 2 + 0.5, z0: (r.z0 + r.z1) / 2 - 0.5, z1: (r.z0 + r.z1) / 2 + 0.5 }, 'n', y);
        g.post(0.5, 0.5, 0.05, 2.45, 7.0, 'metal', 6);
        g.cone(0.5, 0.5, 4.2, 0.15, 6.2, 7.3, 'umbrella', 8);
      }
      return;
    case 'outdoor_chair':
      f.soft(0, f.L, 0, f.D, 1.2, 1.5, 'cushion', 0.1); f.box(0, f.L, 0, 0.25, 1.5, 3.0, 'wood'); legs(r, 1.2, 'metal', 0.1);
      return;
    default:
      box(r, 0, 2.5, 'wood');
  }
}

module.exports = { addFurniture, againstSide, furnitureSide };
