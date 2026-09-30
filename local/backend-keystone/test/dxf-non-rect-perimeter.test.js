'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { generateSmokeDxf } = require('../scripts/smoke/dxf_export_smoke_check');

function buildSingleLevelSpec({ width, height, outlineSegments, envelopeAreaSqFt }) {
  return {
    levels: [
      {
        level: 1,
        width,
        height,
        outlineSegments,
        envelopeAreaSqFt,
        rooms: [
          {
            id: 'room_1',
            name: 'LIVING ROOM',
            label: 'LIVING ROOM',
            type: 'living_room',
            x: 0,
            y: 0,
            w: width,
            h: height,
          },
        ],
      },
    ],
    elevations: { frontSvg: '', rearSvg: '', leftSvg: '', rightSvg: '', meta: { frontEdge: 'bottom' } },
    style: 'craftsman',
    roofStyle: 'craftsman gable',
    houseWidth: width,
    houseDepth: height,
  };
}

function countExteriorWallLines(dxfString) {
  return (String(dxfString).match(/0\nLINE\n8\nA-WALL\n/g) || []).length;
}

test('DXF perimeter uses explicit L-shape outline segments (6 perimeter segments -> 12 exterior wall lines)', () => {
  const outlineSegments = [
    { x1: 0, y1: 0, x2: 40, y2: 0 },
    { x1: 40, y1: 0, x2: 40, y2: 18 },
    { x1: 40, y1: 18, x2: 24, y2: 18 },
    { x1: 24, y1: 18, x2: 24, y2: 30 },
    { x1: 24, y1: 30, x2: 0, y2: 30 },
    { x1: 0, y1: 30, x2: 0, y2: 0 },
  ];
  const dxf = generateSmokeDxf({
    planSpec: buildSingleLevelSpec({
      width: 40,
      height: 30,
      outlineSegments,
      envelopeAreaSqFt: 912,
    }),
  });

  assert.equal(countExteriorWallLines(dxf), outlineSegments.length * 2);
});

test('DXF perimeter uses explicit T-shape outline segments (8 perimeter segments -> 16 exterior wall lines)', () => {
  const outlineSegments = [
    { x1: 0, y1: 0, x2: 42, y2: 0 },
    { x1: 42, y1: 0, x2: 42, y2: 14 },
    { x1: 42, y1: 14, x2: 28, y2: 14 },
    { x1: 28, y1: 14, x2: 28, y2: 30 },
    { x1: 28, y1: 30, x2: 14, y2: 30 },
    { x1: 14, y1: 30, x2: 14, y2: 14 },
    { x1: 14, y1: 14, x2: 0, y2: 14 },
    { x1: 0, y1: 14, x2: 0, y2: 0 },
  ];
  const dxf = generateSmokeDxf({
    planSpec: buildSingleLevelSpec({
      width: 42,
      height: 30,
      outlineSegments,
      envelopeAreaSqFt: 980,
    }),
  });

  assert.equal(countExteriorWallLines(dxf), outlineSegments.length * 2);
});

