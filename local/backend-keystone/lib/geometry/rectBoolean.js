'use strict';

// Exact axis-aligned rectangle set operations in feet. Results have disjoint
// interiors, so areas never double-count composite parts or wall junctions.
const EPS = 1e-9;
const area = r => r.w * r.h;
function intersection(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > EPS && h > EPS ? { x, y, w, h } : null;
}
function subtractOne(rect, cut) {
  const hit = intersection(rect, cut);
  if (!hit) return [rect];
  return [
    { x: rect.x, y: rect.y, w: rect.w, h: hit.y - rect.y },
    { x: rect.x, y: hit.y + hit.h, w: rect.w, h: rect.y + rect.h - hit.y - hit.h },
    { x: rect.x, y: hit.y, w: hit.x - rect.x, h: hit.h },
    { x: hit.x + hit.w, y: hit.y, w: rect.x + rect.w - hit.x - hit.w, h: hit.h },
  ].filter(r => r.w > EPS && r.h > EPS);
}
function subtract(rects, cuts) {
  return cuts.reduce((remaining, cut) => remaining.flatMap(r => subtractOne(r, cut)), rects);
}
function union(rects) {
  const result = [];
  for (const rect of rects) result.push(...subtract([rect], result));
  return result;
}
function unionArea(rects) { return union(rects).reduce((sum, r) => sum + area(r), 0); }
function containsRect(parts, rect) {
  return subtract([rect], parts).reduce((sum, r) => sum + area(r), 0) <= EPS;
}
module.exports = { intersection, subtract, union, unionArea, containsRect };
