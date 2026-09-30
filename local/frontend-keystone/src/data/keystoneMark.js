/* The Keystone AI mark: a round arch of seven voussoirs on two piers, locked by
   its keystone. It reads as an arch and as a front doorway; the keystone, the one
   stone that holds the others, is the product's name and its idea (the engine
   assembles the house, the check locks it).

   One geometry on a 32-unit grid feeds every use: the SVG mark and its animation,
   the favicon, the footer's 3D badge and the CAD title block. Points are in SVG
   coordinates (y down). */

export const GRID = 32;
const CX = 16, CY = 19.6;           // centre of the arch's springing line
const R = 11, r = 7.7;              // extrados and intrados radii
const KEY_WIDTH = 26, GAP = 3.6;    // keystone's angular width; joint width (degrees)
const KEY_RISE = 2.7, KEY_DROP = 1.1; // the keystone stands proud above the arch and below its soffit
const PIER_DROP = 6.2, PIER_GAP = 0.8; // piers laid in two courses
const STEPS = 10;                   // polygon segments per curved edge

const rad = (deg) => (deg * Math.PI) / 180;
const at = (radius, deg) => [CX + radius * Math.cos(rad(deg)), CY - radius * Math.sin(rad(deg))];
const round = (p) => p.map((v) => Math.round(v * 1000) / 1000);
const arc = (radius, from, to) => Array.from({ length: STEPS + 1 }, (_, i) => at(radius, from + ((to - from) * i) / STEPS));

/* A wedge between two angles (degrees, 0 = right, 90 = crown). */
const wedge = (a0, a1) => [...arc(R, a0, a1), ...arc(r, a1, a0)].map(round);

const side = (180 - KEY_WIDTH) / 6;
const half = GAP / 2;
/* Voussoirs from the right springer to the left, keystone excluded. `order` is when
   each is set: pairs from the base up, as an arch is built. */
const VOUSSOIRS = [0, 1, 2, 3, 4, 5].map((i) => {
    const a0 = i < 3 ? i * side : 90 + KEY_WIDTH / 2 + (i - 3) * side;
    const a1 = a0 + side;
    return { points: wedge(a0 + (i === 0 ? 0 : half), a1 - (i === 5 ? 0 : half)), order: i < 3 ? i + 1 : 6 - i };
});

/* The keystone: radial sides from the intrados to above the arch, a flat top. */
const k0 = 90 - KEY_WIDTH / 2 + half, k1 = 90 + KEY_WIDTH / 2 - half;
const KEY = [at(R + KEY_RISE, k0), at(R + KEY_RISE, k1), ...arc(r - KEY_DROP, k1, k0)].map(round);

/* The piers the arch springs from (left and right). */
const block = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(round);
const course = (PIER_DROP - PIER_GAP) / 2, y0 = CY + PIER_GAP, y1 = y0 + course, y2 = y1 + PIER_GAP, y3 = y2 + course;
const PIERS = [block(CX - R, CX - r, y0, y1), block(CX - R, CX - r, y2, y3), block(CX + r, CX + R, y0, y1), block(CX + r, CX + R, y2, y3)];

export const MARK = { voussoirs: VOUSSOIRS, key: KEY, piers: PIERS, keyDrop: KEY_RISE + 3.2 };

export const toPath = (points) => `M${points.map((p) => p.join(' ')).join('L')}Z`;

/* The whole mark as plain SVG markup (favicon, static files, exports). */
export function markSvg({ size = 64, tile = '#0F1420', ink = '#F7F8FA', key = '#C9A15A', radius = 8 } = {}) {
    const stones = [...PIERS, ...VOUSSOIRS.map((v) => v.points)].map((p) => `<path d="${toPath(p)}"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${GRID} ${GRID}">`
        + (tile ? `<rect x="0" y="0" width="${GRID}" height="${GRID}" rx="${radius}" fill="${tile}"/>` : '')
        + `<g fill="${ink}">${stones}</g><path d="${toPath(KEY)}" fill="${key}"/></svg>`;
}
