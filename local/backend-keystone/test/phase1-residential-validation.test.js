'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeBrief } = require('../lib/tile/normalizeBrief');
const { buildProgramFromBrief } = require('../lib/tile/buildProgramFromBrief');
const { validatePlanSpec } = require('../lib/validatePlan');

function makeSingleLevelPlan({ width = 30, height = 20, rooms = [], doors = [] }) {
  return {
    stories: 1,
    totalAreaSqFt: width * height,
    levels: [
      {
        level: 1,
        width,
        height,
        rooms,
        doors,
        windows: [],
      },
    ],
  };
}

function room(id, type, x, y, w, h, extras = {}) {
  return { id, type, x, y, w, h, level: 1, ...extras };
}

test('buildProgramFromBrief adds room contracts for core residential rooms', () => {
  const brief = normalizeBrief({
    totalArea: '2400',
    stories: '2 Stories',
    bedrooms: '3 Bed',
    bathrooms: '3 Bath',
    privateBaths: '1',
    garage: '1 Car Garage',
    shape: 'Rectangular',
    lotContext: 'Suburban standard lot',
    frontFacing: 'South',
    features: '1 Study',
  });

  const program = buildProgramFromBrief(brief, { levelAreaSqFtActual: 1200 });
  const rooms = program.levels.flatMap((level) => level.rooms);
  const primaryBedroom = rooms.find((spec) => spec.type === 'primary_bedroom');
  const diningRoom = rooms.find((spec) => spec.type === 'dining_room');

  assert.ok(primaryBedroom?.roomContract, 'Expected primary bedroom roomContract');
  assert.equal(primaryBedroom.roomContract?.contractType, 'bedroom');
  assert.equal(primaryBedroom.roomContract?.bedType, 'queen');

  assert.ok(diningRoom?.roomContract, 'Expected dining room roomContract');
  assert.equal(diningRoom.roomContract?.contractType, 'dining');
  assert.ok(Number(diningRoom.roomContract?.seatCount) >= 4, 'Expected dining contract seatCount');
});

test('validatePlanSpec rejects a primary bedroom that is too narrow for its bed contract', () => {
  const surveyData = {
    totalArea: '1200',
    stories: '1 Story',
    bedrooms: '1 Bed',
    bathrooms: '1 Bath',
    garage: 'No Garage',
    masterLocation: 'Level 1 (Main)',
    features: '',
  };

  const planSpec = makeSingleLevelPlan({
    height: 24,
    rooms: [
      room('living', 'living_room', 0, 0, 12, 10),
      room('kitchen', 'kitchen', 12, 0, 10, 10),
      room('dining', 'dining_room', 22, 0, 8, 10),
      room('bed', 'primary_bedroom', 0, 10, 8, 14, {
        roomContract: { contractType: 'bedroom', bedType: 'queen' },
      }),
      room('bath', 'primary_bathroom', 8, 10, 6, 8),
    ],
    doors: [
      { a: 'living', b: 'kitchen', x: 12, y: 4, dir: 'vertical' },
      { a: 'living', b: 'dining', x: 22, y: 4, dir: 'vertical' },
      { a: 'living', b: 'bed', x: 6, y: 10, dir: 'horizontal' },
      { a: 'bed', b: 'bath', x: 8, y: 14, dir: 'vertical' },
    ],
  });

  const errors = validatePlanSpec(planSpec, surveyData);
  assert.ok(
    errors.some((error) => String(error).startsWith('Bedroom fit invalid:')),
    `Expected bedroom fit error, got: ${errors.join(' | ')}`
  );
});

test('validatePlanSpec rejects a dining room that cannot fit a real table with circulation', () => {
  const surveyData = {
    totalArea: '1200',
    stories: '1 Story',
    bedrooms: '1 Bed',
    bathrooms: '1 Bath',
    garage: 'No Garage',
    masterLocation: 'Level 1 (Main)',
    features: '',
  };

  const planSpec = makeSingleLevelPlan({
    height: 24,
    rooms: [
      room('living', 'living_room', 0, 0, 12, 10),
      room('kitchen', 'kitchen', 12, 0, 10, 10),
      room('dining', 'dining_room', 22, 0, 8, 10, {
        roomContract: { contractType: 'dining', seatCount: 4 },
      }),
      room('bed', 'primary_bedroom', 0, 10, 12, 12),
      room('bath', 'primary_bathroom', 12, 10, 6, 8),
    ],
    doors: [
      { a: 'living', b: 'kitchen', x: 12, y: 4, dir: 'vertical' },
      { a: 'kitchen', b: 'dining', x: 22, y: 4, dir: 'vertical' },
      { a: 'living', b: 'bed', x: 6, y: 10, dir: 'horizontal' },
      { a: 'bed', b: 'bath', x: 12, y: 14, dir: 'vertical' },
    ],
  });

  const errors = validatePlanSpec(planSpec, surveyData);
  assert.ok(
    errors.some((error) => String(error).startsWith('Dining fit invalid:')),
    `Expected dining fit error, got: ${errors.join(' | ')}`
  );
});

test('validatePlanSpec rejects a shared bathroom that is only reachable through a bedroom', () => {
  const surveyData = {
    totalArea: '1500',
    stories: '1 Story',
    bedrooms: '2 Bed',
    bathrooms: '1 Bath',
    garage: 'No Garage',
    masterLocation: 'Level 1 (Main)',
    features: '',
  };

  const planSpec = makeSingleLevelPlan({
    rooms: [
      room('living', 'living_room', 0, 0, 12, 10),
      room('kitchen', 'kitchen', 12, 0, 10, 10),
      room('dining', 'dining_room', 22, 0, 8, 10),
      room('bed_a', 'bedroom', 0, 10, 10, 10),
      room('bed_b', 'bedroom', 10, 10, 10, 10),
      room('bath', 'bathroom', 20, 10, 6, 8),
    ],
    doors: [
      { a: 'living', b: 'kitchen', x: 12, y: 4, dir: 'vertical' },
      { a: 'kitchen', b: 'dining', x: 22, y: 4, dir: 'vertical' },
      { a: 'living', b: 'bed_a', x: 5, y: 10, dir: 'horizontal' },
      { a: 'bed_a', b: 'bed_b', x: 10, y: 14, dir: 'vertical' },
      { a: 'bed_b', b: 'bath', x: 20, y: 14, dir: 'vertical' },
    ],
  });

  const errors = validatePlanSpec(planSpec, surveyData);
  assert.ok(
    errors.some((error) => String(error).startsWith('Shared bathroom access invalid:')),
    `Expected shared bathroom access error, got: ${errors.join(' | ')}`
  );
});
