'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPlanSvg } = require('../lib/renderPlanSvg');

function render(doors, windows = []) {
  return renderPlanSvg({ levels: [{ level: 1, width: 24, height: 24,
    rooms: [{ id: 'room', type: 'garage', label: 'Garage', x: 0, y: 0, w: 24, h: 24 }],
    doors, windows }] });
}

test('SVG draws the specified door and window widths at the plan scale', () => {
  const svg = render([{ a: 'room', b: '__exterior__', x: 6, y: 24, dir: 'horizontal', width: 4 }],
    [{ roomId: 'room', x: 12, y: 0, dir: 'horizontal', width: 6 }]);
  assert.match(svg, /A 72 72 /, 'four-foot swing must have a 72px radius');
  assert.match(svg, /width="108" height="8"/, 'six-foot glazing must span 108px');
});

test('SVG rotates garage doors on vertical exterior walls', () => {
  const svg = render([{ a: 'room', b: '__exterior__', x: 0, y: 12, dir: 'vertical', width: 9, garageDoor: true }]);
  assert.match(svg, /rotate\(90[ ,]+100[ ,]+316\)/);
});

test('opening legend stays below the floor geometry and clear of titles', () => {
  const svg = render([]);
  const legend = svg.match(/class="opening-profile-annotation">\s*<text x="[^"]+" y="([^"]+)"/);
  assert.ok(legend);
  assert.ok(Number(legend[1]) > 100 + 24 * 18);
});
