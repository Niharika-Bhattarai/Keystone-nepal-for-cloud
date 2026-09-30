'use strict';

// Collects triangles grouped by node (for example "Level 1", "Roof") and by
// material. Geometry is in feet in the engine's frame: X = plan x, Z = plan y,
// Y = up. Writers convert to their own units.
//
// Everything the engine draws is a convex solid given as corner points plus
// face loops. Face winding is fixed here by comparing each face normal with
// the direction from the solid's centre, so callers never think about it.
//
// Every vertex also gets a UV in meters, so tiling textures (siding, brick,
// wood floors) keep their real-world size on any surface. The default is a
// box projection on the face's dominant axis; callers with sloped surfaces
// (roofs) pass their own mapping.

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

const FT = 0.3048;
function boxUv(p, n) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [p[0] * FT, p[2] * FT];
  if (ax >= az) return [p[2] * FT, p[1] * FT];
  return [p[0] * FT, p[1] * FT];
}

// Face order for boxes and any 8-point hexahedron built as bottom quad
// (0..3) then top quad (4..7), both counter-clockwise from above.
const HEX_FACES = {
  ny: [0, 3, 2, 1],
  py: [4, 5, 6, 7],
  f0: [0, 1, 5, 4],
  f1: [1, 2, 6, 5],
  f2: [2, 3, 7, 6],
  f3: [3, 0, 4, 7],
};

class MeshBuilder {
  constructor() {
    this.nodes = new Map(); // node name -> Map(material -> { positions, normals, indices })
    this.nodeExtras = new Map();
    this.triangles = 0;
    this.solid = 0; // id of the solid being written; lets Blender weld each one closed
  }

  bucket(node, material) {
    if (!this.nodes.has(node)) this.nodes.set(node, new Map());
    const byMat = this.nodes.get(node);
    if (!byMat.has(material)) byMat.set(material, { positions: [], normals: [], uvs: [], solids: [], indices: [] });
    return byMat.get(material);
  }

  setNodeExtras(node, extras) { this.nodeExtras.set(node, extras); }

  addPolygon(node, material, pts, n, uvFn = null) {
    if (pts.length < 3) return;
    const b = this.bucket(node, material);
    const base = b.positions.length / 3;
    for (const p of pts) {
      b.positions.push(p[0], p[1], p[2]); b.normals.push(n[0], n[1], n[2]);
      const uv = (uvFn && uvFn(p, n)) || boxUv(p, n);
      b.uvs.push(uv[0], uv[1]);
      b.solids.push(this.solid);
    }
    for (let i = 1; i < pts.length - 1; i++) b.indices.push(base, base + i, base + i + 1);
    this.triangles += pts.length - 2;
  }

  // points: [[x,y,z]...]; faces: { key: [i,j,k,...] }; materialFor: string or (faceKey, outwardNormal) => string|null
  // uvFn (optional): (point, normal, faceKey) => [u, v] in meters, or null for the box projection.
  addSolid(node, points, faces, materialFor, uvFn = null) {
    this.solid++;
    const c = [0, 0, 0];
    for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    c[0] /= points.length; c[1] /= points.length; c[2] /= points.length;
    for (const [key, loop] of Object.entries(faces)) {
      let pts = loop.map((i) => points[i]);
      // drop repeated corners (degenerate quads become triangles)
      pts = pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 1e-6; });
      if (pts.length < 3) continue;
      let n = [0, 0, 0];
      for (let i = 1; i < pts.length - 1; i++) {
        const t = cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0]));
        n = [n[0] + t[0], n[1] + t[1], n[2] + t[2]];
      }
      if (Math.hypot(n[0], n[1], n[2]) < 1e-9) continue;
      n = norm(n);
      const fc = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
      if (dot(n, sub(fc, c)) < 0) { pts = pts.slice().reverse(); n = [-n[0], -n[1], -n[2]]; }
      const mat = typeof materialFor === 'function' ? materialFor(key, n) : materialFor;
      if (mat) this.addPolygon(node, mat, pts, n, uvFn ? (p, nn) => uvFn(p, nn, key) : null);
    }
  }

  // Axis-aligned box from min to max corner.
  addBox(node, min, max, materialFor, uvFn) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6 || z1 - z0 < 1e-6) return;
    const pts = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    this.addSolid(node, pts, HEX_FACES, materialFor, uvFn);
  }

  // Any 8-point hexahedron: bottom quad then top quad.
  addHex(node, points, materialFor, uvFn) { this.addSolid(node, points, HEX_FACES, materialFor, uvFn); }

  // Vertical prism from a convex footprint polygon [[x,z]...] between y0 and y1.
  addPrism(node, footprint, y0, y1, materialFor) {
    const n = footprint.length;
    const pts = [...footprint.map(([x, z]) => [x, y0, z]), ...footprint.map(([x, z]) => [x, y1, z])];
    const faces = { ny: [...Array(n).keys()], py: [...Array(n).keys()].map((i) => i + n) };
    for (let i = 0; i < n; i++) faces['s' + i] = [i, (i + 1) % n, ((i + 1) % n) + n, i + n];
    this.addSolid(node, pts, faces, materialFor);
  }

  // Extruded convex polygon given in 3D (for example a gable triangle), pushed
  // by the vector `depth`.
  addExtrusion(node, polygon, depth, materialFor) {
    const n = polygon.length;
    const pts = [...polygon, ...polygon.map((p) => [p[0] + depth[0], p[1] + depth[1], p[2] + depth[2]])];
    const faces = { a: [...Array(n).keys()], b: [...Array(n).keys()].map((i) => i + n) };
    for (let i = 0; i < n; i++) faces['s' + i] = [i, (i + 1) % n, ((i + 1) % n) + n, i + n];
    this.addSolid(node, pts, faces, materialFor);
  }

  stats() {
    let vertices = 0, primitives = 0;
    for (const byMat of this.nodes.values()) for (const b of byMat.values()) { vertices += b.positions.length / 3; primitives++; }
    return { nodes: this.nodes.size, primitives, vertices, triangles: this.triangles };
  }
}

module.exports = { MeshBuilder, FT };
