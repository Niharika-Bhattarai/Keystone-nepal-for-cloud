import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';

/* Surface detail for the instant 3D model, drawn in the browser (no downloads).

   Each texture is grey detail around white (planks, grout, siding shadow lines,
   brick courses, speckle) and multiplies the material's own colour, so the finish
   colours the plan chose stay exactly as they are. The model's UVs are in meters,
   so every pattern keeps its real size: a plank is 19 cm wide, a tile 60 cm, a
   siding course 18 cm, a brick course 7.5 cm.
   On high quality the same height pattern also becomes a normal map (the gaps and
   grout read as relief); standard quality gets the colour detail only, smaller. */

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Each painter fills a square canvas covering `meters` of surface with a height
// pattern in [0, 1] (1 = the surface, 0 = a gap), and returns tone and height.
const PAINTERS = {
  planks: { meters: 2.28, paint(ctx, n, r) {
    const rows = 12, rh = n / rows; // 19 cm planks
    for (let i = 0; i < rows; i++) {
      let x = -r() * n * 0.5;
      while (x < n) {
        const len = n * (0.35 + r() * 0.4), tone = 0.82 + r() * 0.16;
        ctx.fillStyle = shade(tone); ctx.fillRect(x, i * rh, len, rh);
        // grain: faint lines along the plank
        for (let g = 0; g < 5; g++) { ctx.fillStyle = shade(tone - 0.03 - r() * 0.03); ctx.fillRect(x, i * rh + r() * rh, len, 1 + r()); }
        ctx.fillStyle = shade(0.55); ctx.fillRect(x, i * rh, 2, rh); // end joint
        x += len;
      }
      ctx.fillStyle = shade(0.5); ctx.fillRect(0, i * rh, n, 2);    // long joint
    }
  } },
  tiles: { meters: 1.2, paint(ctx, n, r) {
    const k = 2, t = n / k; // 60 cm tiles, 3 mm grout
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { ctx.fillStyle = shade(0.9 + r() * 0.08); ctx.fillRect(i * t, j * t, t, t); }
    speckle(ctx, n, r, 900, 0.86, 0.97);
    ctx.fillStyle = shade(0.62);
    for (let i = 0; i <= k; i++) { ctx.fillRect(i * t - 2, 0, 4, n); ctx.fillRect(0, i * t - 2, n, 4); }
  } },
  subway: { meters: 0.6, paint(ctx, n, r) {
    const rows = 8, rh = n / rows, w = n / 4; // 7.5 x 15 cm
    for (let i = 0; i < rows; i++) for (let j = -1; j < 5; j++) {
      const x = j * w + (i % 2 ? w / 2 : 0);
      ctx.fillStyle = shade(0.93 + r() * 0.06); ctx.fillRect(x + 2, i * rh + 2, w - 4, rh - 4);
    }
  }, ground: 0.68 },
  carpet: { meters: 0.8, paint(ctx, n, r) {
    ctx.fillStyle = shade(0.93); ctx.fillRect(0, 0, n, n);
    speckle(ctx, n, r, n * n / 30, 0.84, 1.0, 1.5);
  } },
  concrete: { meters: 3, paint(ctx, n, r) {
    ctx.fillStyle = shade(0.92); ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(${[0, 0, 0]},${0.02 + r() * 0.03})`; ctx.beginPath(); ctx.arc(r() * n, r() * n, n * (0.05 + r() * 0.15), 0, 7); ctx.fill(); }
    speckle(ctx, n, r, 2500, 0.8, 1.0);
    ctx.fillStyle = shade(0.6); ctx.fillRect(0, 0, n, 3); ctx.fillRect(0, 0, 3, n); // control joints every 3 m
  } },
  pavers: { meters: 1.2, paint(ctx, n, r) {
    const k = 4, t = n / k;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { ctx.fillStyle = shade(0.82 + r() * 0.15); ctx.fillRect(i * t + 3, j * t + 3, t - 6, t - 6); }
  }, ground: 0.6 },
  stone: { meters: 1.0, paint(ctx, n, r) {
    ctx.fillStyle = shade(0.94); ctx.fillRect(0, 0, n, n);
    speckle(ctx, n, r, 6000, 0.72, 1.0, 1.8);
  } },
  siding: { meters: 1.8, paint(ctx, n, r) {
    const rows = 10, rh = n / rows; // 18 cm courses: a shadow line under each lap
    for (let i = 0; i < rows; i++) {
      const g = ctx.createLinearGradient(0, i * rh, 0, (i + 1) * rh);
      g.addColorStop(0, shade(0.78)); g.addColorStop(0.12, shade(0.97)); g.addColorStop(1, shade(0.9));
      ctx.fillStyle = g; ctx.fillRect(0, i * rh, n, rh);
    }
  } },
  battens: { meters: 1.2, paint(ctx, n, r) {
    ctx.fillStyle = shade(0.95); ctx.fillRect(0, 0, n, n);
    const k = 3, t = n / k; // a batten every 40 cm
    for (let i = 0; i < k; i++) { ctx.fillStyle = shade(0.8); ctx.fillRect(i * t, 0, 5, n); ctx.fillStyle = shade(1); ctx.fillRect(i * t + 5, 0, 10, n); }
  } },
  brick: { meters: 0.9, paint(ctx, n, r) {
    const rows = 12, rh = n / rows, w = n / 4; // 7.5 cm courses, 22.5 cm bricks
    for (let i = 0; i < rows; i++) for (let j = -1; j < 5; j++) {
      const x = j * w + (i % 2 ? w / 2 : 0);
      ctx.fillStyle = shade(0.72 + r() * 0.28); ctx.fillRect(x + 2, i * rh + 2, w - 4, rh - 4);
    }
  }, ground: 0.62 },
  stucco: { meters: 1.5, paint(ctx, n, r) {
    ctx.fillStyle = shade(0.95); ctx.fillRect(0, 0, n, n);
    speckle(ctx, n, r, 9000, 0.86, 1.0, 1.2);
  } },
};

function shade(v) { const c = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${c},${c},${c})`; }
function speckle(ctx, n, r, count, lo, hi, size = 1) {
  for (let i = 0; i < count; i++) { ctx.fillStyle = shade(lo + r() * (hi - lo)); ctx.fillRect(r() * n, r() * n, size, size); }
}

// Height (the tone) to a tangent-space normal map on a second canvas.
function normalsFrom(src, n, strength) {
  const data = src.getImageData(0, 0, n, n).data;
  const h = (x, y) => data[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  const out = new ImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
    out.data[i] = (-dx / len * 0.5 + 0.5) * 255; out.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
    out.data[i + 2] = (1 / len * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  return out;
}

function makeTextures(scene, pattern, high) {
  const painter = PAINTERS[pattern];
  const n = high ? 1024 : 512;
  const tone = new DynamicTexture(`tone-${pattern}`, { width: n, height: n }, scene, true);
  const ctx = tone.getContext();
  ctx.fillStyle = shade(painter.ground ?? 0.9); ctx.fillRect(0, 0, n, n);
  painter.paint(ctx, n, rng(pattern.length * 7919));
  tone.update(true);
  const scale = 1 / painter.meters;
  tone.uScale = scale; tone.vScale = scale;
  tone.anisotropicFilteringLevel = high ? 8 : 4;
  let bump = null;
  if (high) {
    bump = new DynamicTexture(`bump-${pattern}`, { width: n, height: n }, scene, true);
    bump.getContext().putImageData(normalsFrom(ctx, n, pattern === 'carpet' || pattern === 'stucco' || pattern === 'stone' ? 1.5 : 4), 0, 0);
    bump.update(true);
    bump.uScale = scale; bump.vScale = scale;
    bump.anisotropicFilteringLevel = 8;
  }
  return { tone, bump };
}

const floorPattern = (finish, fallback) => {
  const v = String(finish || '');
  if (/hardwood|wood|lvp|plank|laminate|oak/i.test(v)) return 'planks';
  if (/tile|porcelain|marble|ceramic|stone/i.test(v)) return 'tiles';
  if (/carpet/i.test(v)) return 'carpet';
  if (/concrete/i.test(v)) return 'concrete';
  return fallback;
};
const claddingPattern = (finish) => {
  const v = String(finish || 'cedar_lap');
  if (/brick/i.test(v)) return 'brick';
  if (/stucco|render|plaster/i.test(v)) return 'stucco';
  if (/batten/i.test(v)) return 'battens';
  if (/stone/i.test(v)) return 'stone';
  if (/concrete/i.test(v)) return 'concrete';
  return 'siding';
};

/* Give the model's materials their surface detail. `finish` is the GLB's
   extras.finish (the plan's chosen finishes); `high` selects the larger textures
   and the normal maps. Returns the textures, for disposal with the scene. */
export function applySurfaceDetail(scene, materials, { finish = {}, high = false } = {}) {
  const want = {
    'floor-public': floorPattern(finish.floorPublic, 'planks'),
    'floor-bedroom': floorPattern(finish.floorBedroom, 'carpet'),
    'floor-wet': floorPattern(finish.floorWet, 'tiles'),
    'floor-garage': 'concrete',
    driveway: 'concrete',
    walkway: 'pavers',
    cladding: claddingPattern(finish.primaryCladding),
    'cladding-accent': claddingPattern(finish.accentCladding || finish.primaryCladding),
    countertop: 'stone',
    backsplash: 'subway',
  };
  const made = new Map();
  for (const mat of materials) {
    const pattern = want[mat.name];
    if (!pattern || !PAINTERS[pattern] || !('albedoTexture' in mat)) continue;
    if (!made.has(pattern)) made.set(pattern, makeTextures(scene, pattern, high));
    const { tone, bump } = made.get(pattern);
    mat.albedoTexture = tone;
    if (bump) { mat.bumpTexture = bump; bump.level = 0.55; }
  }
  return [...made.values()].flatMap((t) => [t.tone, t.bump].filter(Boolean));
}
