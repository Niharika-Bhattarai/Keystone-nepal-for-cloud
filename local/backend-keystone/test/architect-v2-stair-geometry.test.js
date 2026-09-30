'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateStairGeometry } = require('../lib/residential/v2/validators/stairGeometryValidator');
const {fitStairLayout}=require('../lib/stairLayout');

function makeLevel(level, width, height, rooms, stairCore) {
  return {
    level,
    width,
    height,
    rooms,
    doors: [],
    stairCore,
  };
}

test('validateStairGeometry rejects mis-stacked cores and missing fitted flights', () => {
  const errors = validateStairGeometry({
    levels: [
      makeLevel(1, 40, 30, [
        { id: 'stairs_1', type: 'stairs', level: 1, x: 14, y: 18, w: 8, h: 8 },
        { id: 'entry_1', type: 'entry', level: 1, x: 22, y: 18, w: 12, h: 12 },
      ], {
        roomId: 'stairs_1',
        landingRoomId: 'entry_1',
        x: 14,
        y: 18,
        w: 8,
        h: 8,
      }),
      makeLevel(2, 40, 30, [
        { id: 'stairs_2', type: 'stairs', level: 2, x: 14, y: 8, w: 8, h: 22 },
        { id: 'landing_2', type: 'hallway', level: 2, x: 14, y: 0, w: 8, h: 8 },
      ], {
        roomId: 'stairs_2',
        landingRoomId: 'landing_2',
        x: 14,
        y: 8,
        w: 8,
        h: 22,
      }),
    ],
  });

  assert.ok(errors.some((error) => error.includes('stacked stairs must keep the same x/y/w/h')));
  assert.ok(errors.some((error) => error.includes('no fitted flights')));
});

test('stacked nominal rectangles alone do not establish a fitted residential stair', () => {
  const errors = validateStairGeometry({
    levels: [
      makeLevel(1, 40, 30, [
        { id: 'stairs_1', type: 'stairs', level: 1, x: 14, y: 18, w: 6, h: 12 },
        { id: 'entry_1', type: 'entry', level: 1, x: 20, y: 18, w: 12, h: 12 },
      ], {
        roomId: 'stairs_1',
        landingRoomId: 'entry_1',
        x: 14,
        y: 18,
        w: 6,
        h: 12,
      }),
      makeLevel(2, 40, 30, [
        { id: 'stairs_2', type: 'stairs', level: 2, x: 14, y: 18, w: 6, h: 12 },
        { id: 'landing_2', type: 'hallway', level: 2, x: 14, y: 12, w: 6, h: 6 },
      ], {
        roomId: 'stairs_2',
        landingRoomId: 'landing_2',
        x: 14,
        y: 18,
        w: 6,
        h: 12,
      }),
    ],
  });

  assert.equal(errors.filter(error=>error.includes('no fitted flights')).length,2);
});

test('validateStairGeometry accepts a rotated east-west stair core after front-facing transforms', () => {
  const core={x:14,y:18,w:14,h:6};
  const layout=fitStairLayout({core,lowerHall:{x:28,y:18,w:6,h:6},upperHall:{x:8,y:18,w:6,h:6},riseFt:10});
  assert.equal(layout.valid,true);
  assert.equal(layout.flights[0].from.y,layout.flights[0].to.y,'travel is east-west after rotation');
  const errors = validateStairGeometry({
    levels: [
      makeLevel(1, 40, 40, [
        { id: 'stairs_1', type: 'stairs', level: 1, ...core },
        { id: 'entry_1', type: 'entry', level: 1, x: 28, y: 18, w: 6, h: 6 },
      ], {
        roomId: 'stairs_1',
        landingRoomId: 'entry_1',
        x: 14,
        y: 18,
        layout,
        w: 14,
        h: 6,
      }),
      makeLevel(2, 40, 40, [
        { id: 'stairs_2', type: 'stairs', level: 2, ...core },
        { id: 'landing_2', type: 'hallway', level: 2, x: 8, y: 18, w: 6, h: 10 },
      ], {
        roomId: 'stairs_2',
        landingRoomId: 'landing_2',
        x: 14,
        y: 18,
        layout,
        w: 14,
        h: 6,
      }),
    ],
  });

  assert.deepEqual(errors, []);
});
