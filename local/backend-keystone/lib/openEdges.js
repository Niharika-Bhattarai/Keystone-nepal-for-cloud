'use strict';

/* Walls a person took out in the Studio's edit mode.
 *
 * `level.openEdges` lists pairs of rooms, [{ a, b }], that open into each
 * other with no wall and no door, the way open-plan rooms do. The pair is by
 * room, not by line, so the opening follows the rooms when a wall between
 * them is dragged. The drawing, the doors, access, the wall model (and with
 * it DXF and the estimate) and the 3D model all read the pairs from here.
 */

const EPS = 1e-6;

function pairKey(a, b) {
  const A = String(a), B = String(b);
  return A < B ? `${A}|${B}` : `${B}|${A}`;
}

/** The level's open pairs, as pairKey strings. */
function openPairKeys(level) {
  const out = new Set();
  for (const e of Array.isArray(level?.openEdges) ? level.openEdges : []) {
    if (!e || e.a === undefined || e.a === null || e.b === undefined || e.b === null) continue;
    if (String(e.a) !== String(e.b)) out.add(pairKey(e.a, e.b));
  }
  return out;
}

const partsOf = (room) => (Array.isArray(room?.parts) && room.parts.length ? room.parts : [room])
  .map((p) => ({ x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h) }));

/**
 * The stretches of line two rooms share, each { axis, at, from, to }:
 * axis 'x' is a vertical line x = at, axis 'y' a horizontal line y = at.
 */
function sharedSegments(a, b) {
  const out = [];
  for (const p of partsOf(a)) {
    for (const q of partsOf(b)) {
      for (const [at, touching] of [[p.x + p.w, Math.abs(p.x + p.w - q.x) < EPS], [p.x, Math.abs(q.x + q.w - p.x) < EPS]]) {
        if (!touching) continue;
        const from = Math.max(p.y, q.y), to = Math.min(p.y + p.h, q.y + q.h);
        if (to - from > EPS) out.push({ axis: 'x', at, from, to });
      }
      for (const [at, touching] of [[p.y + p.h, Math.abs(p.y + p.h - q.y) < EPS], [p.y, Math.abs(q.y + q.h - p.y) < EPS]]) {
        if (!touching) continue;
        const from = Math.max(p.x, q.x), to = Math.min(p.x + p.w, q.x + q.w);
        if (to - from > EPS) out.push({ axis: 'y', at, from, to });
      }
    }
  }
  return out;
}

const sharedLength = (a, b) => sharedSegments(a, b).reduce((s, seg) => s + seg.to - seg.from, 0);

module.exports = { pairKey, openPairKeys, sharedSegments, sharedLength };
