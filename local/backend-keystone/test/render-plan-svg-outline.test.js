'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderPlanSvg, resolveExteriorOutlineSegments } = require('../lib/renderPlanSvg');

test('open public rooms do not gain false walls against a composite dining room', () => {
  const plan = { openConcept: true, levels: [{ level: 1, width: 30, height: 30,
    rooms: [
      { id: 'dining', type: 'dining_room', x: 0, y: 0, w: 30, h: 20,
        parts: [{ x: 0, y: 0, w: 10, h: 20 }, { x: 10, y: 12, w: 20, h: 8 }] },
      { id: 'living', type: 'living_room', x: 10, y: 0, w: 20, h: 12 },
      { id: 'kitchen', type: 'kitchen', x: 0, y: 20, w: 30, h: 10 },
    ], doors: [], windows: [],
  }] };
  const walls = openConcept => [...renderPlanSvg({ ...plan, openConcept }).matchAll(/<line\b[^>]*stroke="#2c2c2e"[^>]*>/g)].map(([line]) =>
    Object.fromEntries([...line.matchAll(/(x1|x2|y1|y2)="([\d.]+)"/g)].map(([, key, value]) => [key, Number(value)])));
  const lines = walls(true);
  const minX = Math.min(...lines.flatMap(l => [l.x1, l.x2])), maxX = Math.max(...lines.flatMap(l => [l.x1, l.x2]));
  const minY = Math.min(...lines.flatMap(l => [l.y1, l.y2])), maxY = Math.max(...lines.flatMap(l => [l.y1, l.y2]));
  const exterior = l => (l.x1 === l.x2 && [minX, maxX].includes(l.x1)) || (l.y1 === l.y2 && [minY, maxY].includes(l.y1));
  assert.ok(lines.length > 0);
  assert.ok(lines.every(exterior), 'Open public boundaries must not render as partitions');
  assert.ok(walls(false).some(l => !exterior(l)), 'Separate-room mode must retain partitions');
});

test('resolveExteriorOutlineSegments ignores protrusion metadata when rooms form a rectangle', () => {
  const level = {
    level: 1,
    width: 40,
    height: 30,
    protrusionFt: 6,
    protrusionSide: 'top',
    rooms: [
      { id: 'living', type: 'living_room', x: 0, y: 0, w: 20, h: 30 },
      { id: 'kitchen', type: 'kitchen', x: 20, y: 0, w: 20, h: 30 },
    ],
  };

  const segments = resolveExteriorOutlineSegments(level);
  assert.equal(segments.length, 4, `Expected a rectangular envelope, got ${segments.length} segments`);
  assert.deepEqual(
    segments.map((segment) => [segment.x1, segment.y1, segment.x2, segment.y2]).sort(),
    [
      [0, 0, 0, 30],
      [0, 0, 40, 0],
      [0, 30, 40, 30],
      [40, 0, 40, 30],
    ].sort(),
  );
});

test('resolveExteriorOutlineSegments follows the actual room envelope for non-rectangular footprints', () => {
  const level = {
    level: 1,
    width: 40,
    height: 30,
    rooms: [
      { id: 'left', type: 'living_room', x: 0, y: 0, w: 14, h: 30 },
      { id: 'top_right', type: 'kitchen', x: 14, y: 0, w: 26, h: 18 },
      { id: 'bottom_mid', type: 'garage', x: 14, y: 18, w: 16, h: 12 },
    ],
  };

  const segments = resolveExteriorOutlineSegments(level);
  assert.ok(segments.length > 4, `Expected a notched outline, got ${segments.length} segments`);
  assert.ok(
    segments.some((segment) => segment.x1 === 30 && segment.y1 === 18 && segment.x2 === 30 && segment.y2 === 30),
    'Expected right-side notch edge from actual room geometry',
  );
  assert.ok(
    segments.some((segment) =>
      (segment.x1 === 0 && segment.y1 === 30 && segment.x2 === 30 && segment.y2 === 30) ||
      (segment.x1 === 30 && segment.y1 === 30 && segment.x2 === 0 && segment.y2 === 30)
    ),
    'Expected bottom notch edge from actual room geometry',
  );
});

test('renderPlanSvg does not draw a fake protrusion dimension for rectangular room geometry', () => {
  const svg = renderPlanSvg({
    levels: [
      {
        level: 1,
        width: 40,
        height: 30,
        protrusionFt: 6,
        protrusionSide: 'top',
        rooms: [
          { id: 'living', type: 'living_room', label: 'Living Room', x: 0, y: 0, w: 20, h: 30 },
          { id: 'kitchen', type: 'kitchen', label: 'Kitchen', x: 20, y: 0, w: 20, h: 30 },
        ],
        doors: [],
        windows: [],
      },
    ],
    openConcept: false,
  });

  assert.doesNotMatch(svg, />\+6'<\/text>/);
  const outlineCount = (svg.match(/class="exterior-outline"/g) || []).length;
  assert.equal(outlineCount, 4, `Expected 4 exterior outline segments, got ${outlineCount}`);
});
