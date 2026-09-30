'use strict';

// Physically based material palette. Colours are sRGB hex; writers convert
// to linear where the format needs it (glTF). Finish choices from the plan's
// finishSpec pick the cladding, roof and floor materials.

const BASE = {
  'wall-paint':      { color: '#F2EFE9', roughness: 0.92, metallic: 0 },
  'slab':            { color: '#9C9A94', roughness: 0.85, metallic: 0 },
  'foundation':      { color: '#8F8C86', roughness: 0.9, metallic: 0 },
  'trim':            { color: '#F7F5F0', roughness: 0.6, metallic: 0 },
  'glass':           { color: '#BFD9EA', roughness: 0.05, metallic: 0, alpha: 0.32 },
  'screen':          { color: '#2E3438', roughness: 0.8, metallic: 0, alpha: 0.35 },
  'window-frame':    { color: '#2E3238', roughness: 0.5, metallic: 0.1 },
  'door':            { color: '#F4F1EA', roughness: 0.55, metallic: 0 },
  'door-exterior':   { color: '#5B3D28', roughness: 0.5, metallic: 0 },
  'garage-door':     { color: '#E9E6DF', roughness: 0.6, metallic: 0.05 },
  'stair':           { color: '#8A6440', roughness: 0.6, metallic: 0 },
  'fabric':          { color: '#CFC7BA', roughness: 0.95, metallic: 0 },
  'fabric-dark':     { color: '#5E6670', roughness: 0.95, metallic: 0 },
  'wood':            { color: '#9C7550', roughness: 0.55, metallic: 0 },
  'mattress':        { color: '#F1ECE4', roughness: 0.95, metallic: 0 },
  'appliance':       { color: '#DCDFE2', roughness: 0.35, metallic: 0.4 },
  'porcelain':       { color: '#F6F6F4', roughness: 0.2, metallic: 0 },
  'countertop':      { color: '#D8D3CB', roughness: 0.3, metallic: 0 },
  'cabinet':         { color: '#EDEAE3', roughness: 0.6, metallic: 0 },
  'car':             { color: '#3C4E63', roughness: 0.3, metallic: 0.6 },
  'car-glass':       { color: '#1C232B', roughness: 0.1, metallic: 0.2 },
  'metal':           { color: '#6B7079', roughness: 0.4, metallic: 0.8 },
  'ceiling':         { color: '#F8F7F3', roughness: 0.95, metallic: 0 },
  'soffit':          { color: '#F1EFE9', roughness: 0.8, metallic: 0 },
  'baseboard':       { color: '#F7F5F0', roughness: 0.45, metallic: 0 },
  'handrail':        { color: '#5E4330', roughness: 0.45, metallic: 0 },
  'stair-riser':     { color: '#F4F2EC', roughness: 0.5, metallic: 0 },
  'gutter':          { color: '#ECECE8', roughness: 0.35, metallic: 0.3 },
  'driveway':        { color: '#B9B7B1', roughness: 0.9, metallic: 0 },
  'walkway':         { color: '#C4BDB2', roughness: 0.85, metallic: 0 },
  'fixture':         { color: '#FFF4DE', roughness: 0.3, metallic: 0, emissive: '#FFE3B0' },
  // Dressing for the instant model (the photoreal bake replaces all furniture).
  'wood-dark':       { color: '#5C4432', roughness: 0.5, metallic: 0 },
  'media':           { color: '#6E5540', roughness: 0.45, metallic: 0 },
  'headboard':       { color: '#8C8174', roughness: 0.95, metallic: 0 },
  'duvet':           { color: '#E9E4DA', roughness: 0.95, metallic: 0 },
  'throw':           { color: '#8B5E47', roughness: 0.95, metallic: 0 },
  'pillow':          { color: '#F7F4EE', roughness: 0.95, metallic: 0 },
  'cushion':         { color: '#B9AFA2', roughness: 0.95, metallic: 0 },
  'cushion-accent':  { color: '#C3643F', roughness: 0.9, metallic: 0 },
  'rug':             { color: '#C9B99F', roughness: 1, metallic: 0 },
  'rug-living':      { color: '#8E9AA0', roughness: 1, metallic: 0 },
  'tv-frame':        { color: '#1B1D21', roughness: 0.35, metallic: 0.3 },
  'tv-screen':       { color: '#07090C', roughness: 0.06, metallic: 0.1 },
  'art-frame':       { color: '#2C2621', roughness: 0.5, metallic: 0 },
  'art-sand':        { color: '#D8C2A0', roughness: 0.9, metallic: 0 },
  'art-terracotta':  { color: '#B8613F', roughness: 0.9, metallic: 0 },
  'art-cream':       { color: '#F0E8DA', roughness: 0.9, metallic: 0 },
  'art-sky':         { color: '#8FB3C9', roughness: 0.9, metallic: 0 },
  'art-sea':         { color: '#2F5D73', roughness: 0.9, metallic: 0 },
  'art-olive':       { color: '#7B8456', roughness: 0.9, metallic: 0 },
  'art-ink':         { color: '#26303B', roughness: 0.9, metallic: 0 },
  // Kept semi-metallic: the studio viewer has no environment map, so a pure mirror or
  // chrome would render black there.
  'mirror':          { color: '#C9D6DE', roughness: 0.08, metallic: 0.35 },
  'chrome':          { color: '#D2D7DC', roughness: 0.22, metallic: 0.5 },
  'sink':            { color: '#C4C9CE', roughness: 0.25, metallic: 0.45 },
  'backsplash':      { color: '#E6E2DA', roughness: 0.25, metallic: 0 },
  'lamp-base':       { color: '#CBBFAE', roughness: 0.4, metallic: 0 },
  'lamp-shade':      { color: '#F6EEDF', roughness: 0.9, metallic: 0, emissive: '#6E5A3A' },
  'pendant':         { color: '#2A2A2A', roughness: 0.4, metallic: 0.6 },
  'plant':           { color: '#56804A', roughness: 0.8, metallic: 0 },
  'plant-dark':      { color: '#3B5E36', roughness: 0.8, metallic: 0 },
  'pot':             { color: '#D8D1C6', roughness: 0.7, metallic: 0 },
  'vase':            { color: '#3F5A63', roughness: 0.2, metallic: 0 },
  'soil':            { color: '#4A3A2C', roughness: 1, metallic: 0 },
  'book-1':          { color: '#9C4A3A', roughness: 0.8, metallic: 0 },
  'book-2':          { color: '#35556B', roughness: 0.8, metallic: 0 },
  'book-3':          { color: '#D6C9AE', roughness: 0.8, metallic: 0 },
  'book-4':          { color: '#556B4A', roughness: 0.8, metallic: 0 },
  'tire':            { color: '#1C1D1F', roughness: 0.9, metallic: 0 },
  'headlight':       { color: '#F4F6F8', roughness: 0.1, metallic: 0, emissive: '#C9D2DA' },
  'taillight':       { color: '#8E1B14', roughness: 0.2, metallic: 0, emissive: '#5A0E0A' },
  'water':           { color: '#A9C9D6', roughness: 0.05, metallic: 0 },
  'rubber':          { color: '#34373B', roughness: 0.9, metallic: 0 },
  'umbrella':        { color: '#E8E1D3', roughness: 0.9, metallic: 0 },
};

// Claddings that read as boards, and so get corner boards at every corner.
const SIDING = /cedar|wood|lap|board|batten|fiber_cement|vinyl|siding|shake/;

const CLADDING = {
  cedar_lap: '#8C6A4A', cedar: '#8C6A4A', wood_siding: '#8C6A4A',
  board_batten: '#EDEBE4', board_and_batten: '#EDEBE4',
  brick: '#9A4E3A', brick_veneer: '#9A4E3A',
  stucco: '#E6DCC8',
  concrete_panel: '#B4B2AC', concrete: '#B4B2AC',
  stone: '#9C958A', stone_veneer: '#9C958A',
  fiber_cement_lap: '#C9C4B8', fiber_cement: '#C9C4B8',
  vinyl: '#D8D2C6',
};

const ROOFING = {
  asphalt_architectural: ['#4A4D52', 0.9, 0], asphalt: ['#4A4D52', 0.9, 0], asphalt_shingles: ['#55585C', 0.9, 0],
  standing_seam_metal: ['#3A3F46', 0.35, 0.7], metal: ['#3A3F46', 0.35, 0.7],
  clay_tile: ['#A5543A', 0.7, 0], tile: ['#A5543A', 0.7, 0],
  slate: ['#3E4247', 0.6, 0],
  flat_membrane: ['#7E8185', 0.8, 0], membrane: ['#7E8185', 0.8, 0],
};

const FLOORING = {
  engineered_hardwood: ['#B98A5A', 0.55], hardwood: ['#B07E4E', 0.5], lvp: ['#A8835C', 0.5],
  porcelain_tile: ['#D9D6CF', 0.3], tile: ['#D9D6CF', 0.3], marble: ['#E8E5DF', 0.2],
  carpet: ['#B7ADA0', 1], sealed_concrete: ['#A9A9A5', 0.7], polished_concrete: ['#B3B3AF', 0.35],
};

const key = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const lookup = (table, v) => { const k = key(v); if (table[k]) return table[k]; const hit = Object.keys(table).find((t) => k.includes(t)); return hit ? table[hit] : null; };

function buildPalette(finishSpec = {}) {
  const ext = finishSpec.exterior || {};
  const mats = { ...BASE };
  mats['cladding'] = { color: lookup(CLADDING, ext.primaryCladding?.material) || '#D8D2C6', roughness: 0.85, metallic: 0 };
  mats['cladding-accent'] = { color: lookup(CLADDING, ext.accentCladding?.material) || mats['cladding'].color, roughness: 0.9, metallic: 0 };
  const roof = lookup(ROOFING, finishSpec.roofing?.material) || ROOFING.asphalt_architectural;
  mats['roof'] = { color: roof[0], roughness: roof[1], metallic: roof[2] };
  mats['ridge'] = { ...mats['roof'] };
  const fl = finishSpec.interiorFinishes?.flooring || {};
  const floor = (v, fallback) => { const f = lookup(FLOORING, v) || fallback; return { color: f[0], roughness: f[1], metallic: 0 }; };
  mats['floor-public'] = floor(fl.public?.material, FLOORING.engineered_hardwood);
  mats['floor-wet'] = floor(fl.wet?.material, FLOORING.porcelain_tile);
  mats['floor-bedroom'] = floor(fl.bedroom?.material, FLOORING.carpet);
  mats['floor-garage'] = floor(fl.garage?.material, FLOORING.sealed_concrete);
  mats._hasAccent = Boolean(ext.accentCladding?.material);
  mats._siding = SIDING.test(key(ext.primaryCladding?.material || 'cedar_lap'));
  return mats;
}

function floorMaterialFor(roomType) {
  const t = String(roomType || '');
  if (/bath|powder|laundry|mudroom|wc/.test(t)) return 'floor-wet';
  if (/bedroom|nursery/.test(t)) return 'floor-bedroom';
  if (t === 'garage') return 'floor-garage';
  return 'floor-public';
}

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function hexToRgb(hex) { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); }

module.exports = { buildPalette, floorMaterialFor, hexToRgb, srgbToLinear };
