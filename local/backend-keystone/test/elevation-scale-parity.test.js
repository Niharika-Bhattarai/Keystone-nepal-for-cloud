'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderElevationForView } = require('../lib/renderElevationSvg');

function parseSvgWidth(svg) {
  const match = String(svg || '').match(/\bwidth="(\d+)"/i);
  return match ? Number(match[1]) : 0;
}

test('elevation SVG width uses a stable feet-based scale across front/rear/side views', () => {
  const planSpec = {
    stories: 2,
    frontFacing: 'SOUTH',
    levels: [
      {
        level: 1,
        width: 46,
        height: 28,
        rooms: [
          { id: 'living', type: 'living_room', x: 0, y: 0, w: 24, h: 14 },
          { id: 'kitchen', type: 'kitchen', x: 24, y: 0, w: 22, h: 14 },
          { id: 'garage', type: 'garage', x: 0, y: 14, w: 18, h: 14 },
          { id: 'entry', type: 'entry', x: 18, y: 14, w: 8, h: 14 },
        ],
        doors: [],
        windows: [],
      },
      {
        level: 2,
        width: 46,
        height: 28,
        rooms: [
          { id: 'primary', type: 'primary_bedroom', x: 22, y: 0, w: 24, h: 14 },
          { id: 'bed2', type: 'bedroom', x: 0, y: 0, w: 22, h: 14 },
          { id: 'hall', type: 'hallway', x: 16, y: 14, w: 12, h: 14 },
          { id: 'bath', type: 'bathroom', x: 0, y: 14, w: 10, h: 14 },
        ],
        doors: [],
        windows: [],
      },
    ],
  };

  const frontWidth = parseSvgWidth(renderElevationForView(planSpec, {}, 'front'));
  const rearWidth = parseSvgWidth(renderElevationForView(planSpec, {}, 'rear'));
  const leftWidth = parseSvgWidth(renderElevationForView(planSpec, {}, 'left'));
  const rightWidth = parseSvgWidth(renderElevationForView(planSpec, {}, 'right'));

  assert.ok(frontWidth > 0 && rearWidth > 0 && leftWidth > 0 && rightWidth > 0, 'Expected non-zero elevation SVG widths');
  assert.equal(frontWidth, rearWidth, 'Front and rear should share the same span-based width');
  assert.equal(leftWidth, rightWidth, 'Left and right should share the same span-based width');

  const frontSpanPx = frontWidth - 160;
  const sideSpanPx = leftWidth - 160;
  const measuredRatio = frontSpanPx / Math.max(1, sideSpanPx);
  const expectedRatio = 46 / 28;
  assert.ok(
    Math.abs(measuredRatio - expectedRatio) < 0.02,
    `Expected span scaling ratio ${expectedRatio.toFixed(3)}, got ${measuredRatio.toFixed(3)}`
  );
});

test('L-shape elevation renders step lines at void boundaries', () => {
  const planSpec = {
    stories: 2,
    frontFacing: 'SOUTH',
    envelopeShape: 'L_SHAPE',
    envelopeVoidRects: [{ x: 32, y: 0, w: 14, h: 8 }],
    levels: [
      {
        level: 1,
        width: 46,
        height: 28,
        rooms: [
          { id: 'living', type: 'living_room', x: 0, y: 0, w: 24, h: 14 },
          { id: 'kitchen', type: 'kitchen', x: 24, y: 0, w: 8, h: 14 },
          { id: 'garage', type: 'garage', x: 0, y: 14, w: 18, h: 14 },
        ],
        doors: [],
        windows: [],
      },
      {
        level: 2,
        width: 46,
        height: 28,
        rooms: [
          { id: 'primary', type: 'primary_bedroom', x: 0, y: 8, w: 24, h: 20 },
          { id: 'bed2', type: 'bedroom', x: 24, y: 8, w: 22, h: 20 },
        ],
        doors: [],
        windows: [],
      },
    ],
  };

  const rearSvg = renderElevationForView(planSpec, {}, 'rear');
  // The void at y=0 (rear/top edge), x:32-46 should produce step lines
  // Step line positions: x=32 and x=46 in feet, at scale 18px/ft → 576+80 and 828+80
  assert.ok(rearSvg.length > 0, 'Expected non-empty rear elevation SVG');
  // Count line elements — the step lines should add at least 2 extra lines
  const lineMatches = rearSvg.match(/<line /g) || [];
  assert.ok(lineMatches.length >= 3, `Expected step lines in L-shape rear elevation, got ${lineMatches.length} lines`);
});
