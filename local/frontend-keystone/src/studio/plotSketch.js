// Plot geometry for the survey sketcher: sides entered as length + angle (or
// drawn by clicking) become surveyed corner coordinates in metres. The first
// corner is (0, 0) and the first side runs along +x ("bottom edge"); corners go
// counter-clockwise so the plot is on the left of each side.
//
// Angle modes:
//   'interior'  – the inside angle of the plot at the corner where this side
//                 starts (a rectangle has 90° everywhere). Side 1 has no corner
//                 before it and uses direction 0°.
//   'direction' – absolute direction of the side, degrees counter-clockwise
//                 from the first side.

const RAD = Math.PI / 180;
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d + 0; // + 0 turns -0 into 0
const FT = 0.3048;

export function toMetres(value, unit) { return Number(value) * (unit === 'ft' ? FT : 1); }

export function segmentsToVertices(segments, mode = 'interior') {
    const pts = [{ x: 0, y: 0 }];
    let dir = 0;
    segments.forEach((s, i) => {
        const len = toMetres(s.length, s.unit);
        if (!(len > 0)) return;
        if (mode === 'direction') dir = Number(s.angle) || 0;
        else if (i > 0) dir += 180 - Number(s.angle);
        const p = pts[pts.length - 1];
        pts.push({ x: round(p.x + len * Math.cos(dir * RAD)), y: round(p.y + len * Math.sin(dir * RAD)) });
    });
    return pts;
}

// Closure: distance from the last drawn point back to the start.
export function closure(points) {
    if (points.length < 2) return { gapM: 0, closed: false };
    const a = points[0], b = points[points.length - 1];
    const gapM = Math.hypot(a.x - b.x, a.y - b.y);
    return { gapM: round(gapM), closed: gapM <= 0.05 };
}

// Corner list of the closed plot (drops a final point that lands on the start).
export function corners(points) {
    const c = closure(points);
    return c.closed && points.length > 1 ? points.slice(0, -1) : points;
}

export function area(vertices) {
    let twice = 0;
    for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i], b = vertices[(i + 1) % vertices.length];
        twice += a.x * b.y - b.x * a.y;
    }
    return Math.abs(twice) / 2;
}

function cross(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function segmentsCross(a, b, c, d) {
    const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
    return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}
export function selfIntersects(vertices) {
    const n = vertices.length;
    for (let i = 0; i < n; i++) for (let k = i + 2; k < n; k++) {
        if (i === 0 && k === n - 1) continue;
        if (segmentsCross(vertices[i], vertices[(i + 1) % n], vertices[k], vertices[(k + 1) % n])) return true;
    }
    return false;
}

// The side that closes the plot, as length + angle in the chosen mode.
export function closingSegment(segments, mode = 'interior') {
    const pts = segmentsToVertices(segments, mode);
    if (pts.length < 3) return null;
    const a = pts[pts.length - 1], b = pts[0];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.01) return null;
    const dir = Math.atan2(b.y - a.y, b.x - a.x) / RAD;
    if (mode === 'direction') return { length: round(len), unit: 'm', angle: round(((dir % 360) + 360) % 360, 2) };
    const prev = pts[pts.length - 2], prevDir = Math.atan2(a.y - prev.y, a.x - prev.x) / RAD;
    let turn = dir - prevDir; turn = ((turn + 540) % 360) - 180;
    return { length: round(len), unit: 'm', angle: round(180 - turn, 2) };
}

// Segments (length + angle) that reproduce a list of corners, e.g. from clicks.
export function verticesToSegments(points, mode = 'interior') {
    const out = [];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y), dir = Math.atan2(b.y - a.y, b.x - a.x) / RAD;
        if (mode === 'direction' || i === 1) { out.push({ length: round(len), unit: 'm', angle: mode === 'direction' ? round(((dir % 360) + 360) % 360, 2) : 90 }); continue; }
        const p = points[i - 2], prevDir = Math.atan2(a.y - p.y, a.x - p.x) / RAD;
        let turn = dir - prevDir; turn = ((turn + 540) % 360) - 180;
        out.push({ length: round(len), unit: 'm', angle: round(180 - turn, 2) });
    }
    return out;
}

// Ropani-aana-paisa-daam (1 ropani = 16 aana = 5476 sq ft).
export function rapd(m2) {
    const daam = Math.round(m2 / 0.09290304 / (342.25 / 16) * 100) / 100; // avoid 255.999… daam
    const r = Math.floor(daam / 256), a = Math.floor((daam - r * 256) / 16), p = Math.floor((daam - r * 256 - a * 16) / 4);
    return `${r}-${a}-${p}-${round(daam - r * 256 - a * 16 - p * 4, 1)}`;
}

// Survey payload for the backend's surveyedPolygon contract.
export function surveyedPolygon(vertices) {
    return {
        shape: 'surveyedPolygon',
        vertices: vertices.map(p => ({ x: round(p.x), y: round(p.y), unit: 'm' })),
        sideLengths: vertices.map((p, i) => {
            const q = vertices[(i + 1) % vertices.length];
            return { value: round(Math.hypot(q.x - p.x, q.y - p.y), 4), unit: 'm' };
        }),
    };
}
