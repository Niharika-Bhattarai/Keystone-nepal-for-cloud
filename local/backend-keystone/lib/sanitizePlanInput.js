'use strict';

// Guard for planSpecs that arrive from the browser (/api/plan/svg,
// /api/plan/presentation, /api/plan/refine). The renderers escape their text,
// but some SVG coordinates are built with string templates, so a string in a
// geometry field could still be spliced into markup. This coerces geometry to
// numbers and reduces label-like fields to plain text before anything renders.

// Only the drawn geometry is touched. Survey answers ("2 Stories"), estimate
// labels and other metadata are left exactly as sent.
const GEOMETRY_ROOTS = ['levels', 'furniture', 'stairCore', 'envelopeVoidRects', 'buildingModel'];
const TOP_LEVEL_NUMERIC = ['stories', 'totalAreaSqFt', 'tileSizeFt'];
const NUMERIC_KEYS = new Set([
  'x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'depth',
  'level', 'rotation', 'angle', 'envelopeAreaSqFt', 'targetAreaSqFt',
  'areaSqFt', 'widthFt', 'heightFt',
]);
const TEXT_KEYS = new Set(['label', 'displayLabel', 'name', 'title']);
const MAX_DEPTH = 40;

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toPlainText(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/[<>"'`]/g, '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 60);
}

function walk(node, depth) {
  if (depth > MAX_DEPTH || !node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = walk(node[i], depth + 1);
    return node;
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (NUMERIC_KEYS.has(key) && (typeof value !== 'object' || value === null)) node[key] = toNumber(value);
    else if (TEXT_KEYS.has(key) && typeof value !== 'object') node[key] = toPlainText(value);
    else if (value && typeof value === 'object') node[key] = walk(value, depth + 1);
  }
  return node;
}

/** Returns a sanitized deep copy; the input is not modified. */
function sanitizePlanInput(planSpec) {
  if (!planSpec || typeof planSpec !== 'object') return planSpec;
  const copy = structuredClone(planSpec);
  for (const key of TOP_LEVEL_NUMERIC) {
    if (key in copy && (typeof copy[key] !== 'object' || copy[key] === null)) copy[key] = toNumber(copy[key]);
  }
  for (const key of GEOMETRY_ROOTS) if (copy[key] && typeof copy[key] === 'object') walk(copy[key], 0);
  return copy;
}

module.exports = { sanitizePlanInput };
