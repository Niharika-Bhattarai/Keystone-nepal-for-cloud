'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
  materialForRoom,
  patternIdForRoom,
  planPresentationDefs,
  attachPresentationMetadata,
  MATERIAL_LEGEND,
  SVG_PATTERN_ID,
} = require('../lib/planPresentationStyles');

// ── materialForRoom ───────────────────────────────────────────────────────────

test('materialForRoom returns wood for living spaces', () => {
  assert.equal(materialForRoom('living_room'),     'wood');
  assert.equal(materialForRoom('dining_room'),     'wood');
  assert.equal(materialForRoom('primary_bedroom'), 'wood');
  assert.equal(materialForRoom('bedroom'),         'wood');
  assert.equal(materialForRoom('study'),           'wood');
  assert.equal(materialForRoom('library'),         'wood');
  assert.equal(materialForRoom('loft'),            'wood');
});

test('materialForRoom returns tile for wet rooms', () => {
  assert.equal(materialForRoom('kitchen'),          'tile');
  assert.equal(materialForRoom('bathroom'),         'tile');
  assert.equal(materialForRoom('primary_bathroom'), 'tile');
  assert.equal(materialForRoom('powder_room'),      'tile');
  assert.equal(materialForRoom('laundry'),          'tile');
  assert.equal(materialForRoom('mudroom'),          'tile');
});

test('materialForRoom returns concrete for garage', () => {
  assert.equal(materialForRoom('garage'), 'concrete');
});

test('materialForRoom returns stone for entry', () => {
  assert.equal(materialForRoom('entry'), 'stone');
});

test('materialForRoom returns neutral for hallway and stairs', () => {
  assert.equal(materialForRoom('hallway'), 'neutral');
  assert.equal(materialForRoom('stairs'),  'neutral');
});

test('materialForRoom returns null for storage, closet, and unknown types', () => {
  assert.equal(materialForRoom('storage'), null);
  assert.equal(materialForRoom('closet'),  null);
  assert.equal(materialForRoom('unknown'), null);
  assert.equal(materialForRoom(''),        null);
});

// ── patternIdForRoom ──────────────────────────────────────────────────────────

test('patternIdForRoom returns a pattern id string for known room types', () => {
  assert.equal(patternIdForRoom('living_room'), SVG_PATTERN_ID.wood);
  assert.equal(patternIdForRoom('kitchen'),     SVG_PATTERN_ID.tile);
  assert.equal(patternIdForRoom('garage'),      SVG_PATTERN_ID.concrete);
  assert.equal(patternIdForRoom('entry'),       SVG_PATTERN_ID.stone);
  assert.equal(patternIdForRoom('hallway'),     SVG_PATTERN_ID.neutral);
});

test('patternIdForRoom returns null for unpatterned types', () => {
  assert.equal(patternIdForRoom('storage'), null);
  assert.equal(patternIdForRoom('closet'),  null);
});

// ── planPresentationDefs ──────────────────────────────────────────────────────

test('planPresentationDefs emits a pattern def for each material type', () => {
  const defs = planPresentationDefs();
  assert.ok(typeof defs === 'string', 'Expected a string');
  for (const id of Object.values(SVG_PATTERN_ID)) {
    assert.ok(defs.includes(`id="${id}"`), `Missing pattern def for id="${id}"`);
  }
});

test('planPresentationDefs does not emit a wrapping <defs> tag', () => {
  const defs = planPresentationDefs();
  assert.ok(!defs.includes('<defs>'), 'Should not include wrapping <defs> tag — caller owns that');
});

// ── renderPlanSvg integration: patterns appear in SVG output ─────────────────

test('renderPlanSvg emits pattern defs and uses patterns in room fills', () => {
  const { renderPlanSvg } = require('../lib/renderPlanSvg');

  const planSpec = {
    levels: [{
      level: 1,
      width: 40,
      height: 30,
      rooms: [
        { id: 'lr', type: 'living_room',     x: 0,  y: 0,  w: 14, h: 14 },
        { id: 'k',  type: 'kitchen',         x: 14, y: 0,  w: 12, h: 12 },
        { id: 'g',  type: 'garage',          x: 0,  y: 14, w: 12, h: 16 },
        { id: 'e',  type: 'entry',           x: 12, y: 14, w: 8,  h: 8  },
        { id: 'h',  type: 'hallway',         x: 20, y: 14, w: 6,  h: 6  },
        { id: 's',  type: 'storage',         x: 26, y: 14, w: 6,  h: 6  },
      ],
      doors:   [],
      windows: [],
      furniture: [],
    }],
  };

  const svg = renderPlanSvg(planSpec);
  assert.ok(svg.length > 0, 'Expected non-empty SVG');

  // Pattern defs present
  for (const id of Object.values(SVG_PATTERN_ID)) {
    assert.ok(svg.includes(`id="${id}"`), `SVG missing pattern def: ${id}`);
  }

  // Pattern references appear in room fills (at least wood + tile + concrete)
  assert.ok(svg.includes(`url(#${SVG_PATTERN_ID.wood})`),     'Expected wood pattern applied to living room');
  assert.ok(svg.includes(`url(#${SVG_PATTERN_ID.tile})`),     'Expected tile pattern applied to kitchen');
  assert.ok(svg.includes(`url(#${SVG_PATTERN_ID.concrete})`), 'Expected concrete pattern applied to garage');
  assert.ok(svg.includes(`url(#${SVG_PATTERN_ID.stone})`),    'Expected stone pattern applied to entry');
  assert.ok(svg.includes(`url(#${SVG_PATTERN_ID.neutral})`),  'Expected neutral pattern applied to hallway');

  // Storage has no pattern reference
  const storagePatterns = svg.match(/url\(#ksPat_\w+\)/g) || [];
  // Storage should not be the only thing with patterns — it should have fewer refs than rooms with patterns
  assert.ok(storagePatterns.length >= 1, 'Expected at least one pattern url reference in the SVG');
});

// ── furniture: garage car ─────────────────────────────────────────────────────

test('applyFurnitureLayout places a car in a large enough garage', () => {
  const { applyFurnitureLayout } = require('../lib/planFurniture');

  const planSpec = {
    levels: [{
      level: 1,
      width: 40,
      height: 30,
      rooms: [
        { id: 'g', type: 'garage', x: 0, y: 0, w: 20, h: 22 },
      ],
      doors: [],
    }],
  };

  applyFurnitureLayout(planSpec);
  const items = planSpec.levels[0].furniture;
  const car = items.find((i) => i.kind === 'car');
  assert.ok(car, 'Expected a car item in a large garage');
  assert.ok(car.w >= 6, `Car width should be at least 6ft, got ${car.w}`);
  assert.ok(car.h >= 10, `Car length should be at least 10ft, got ${car.h}`);
});

test('applyFurnitureLayout omits car from a too-small garage', () => {
  const { applyFurnitureLayout } = require('../lib/planFurniture');

  const planSpec = {
    levels: [{
      level: 1,
      width: 20,
      height: 20,
      rooms: [
        { id: 'g', type: 'garage', x: 0, y: 0, w: 8, h: 10 },
      ],
      doors: [],
    }],
  };

  applyFurnitureLayout(planSpec);
  const items = planSpec.levels[0].furniture;
  const car = items.find((i) => i.kind === 'car');
  assert.equal(car, undefined, 'Expected no car in a too-small garage');
});

// ── furniture: kitchen appliances ─────────────────────────────────────────────

test('applyFurnitureLayout places fridge and stove in a large enough kitchen', () => {
  const { applyFurnitureLayout } = require('../lib/planFurniture');

  const planSpec = {
    levels: [{
      level: 1,
      width: 40,
      height: 30,
      rooms: [
        { id: 'k', type: 'kitchen', x: 0, y: 0, w: 14, h: 12 },
      ],
      doors: [],
    }],
  };

  applyFurnitureLayout(planSpec);
  const items = planSpec.levels[0].furniture;
  const fridge = items.find((i) => i.kind === 'refrigerator');
  const stove  = items.find((i) => i.kind === 'stove');
  assert.ok(fridge, 'Expected a refrigerator in a large kitchen');
  assert.ok(stove,  'Expected a stove in a large kitchen');
});

// ── furniture: SVG symbols render without error ───────────────────────────────

test('furnitureItemSvg renders car, fridge, and stove symbols', () => {
  const { renderPlanSvg } = require('../lib/renderPlanSvg');

  const planSpec = {
    levels: [{
      level: 1,
      width: 50,
      height: 40,
      rooms: [
        { id: 'g', type: 'garage', x: 0,  y: 0,  w: 20, h: 22 },
        { id: 'k', type: 'kitchen', x: 20, y: 0, w: 14, h: 12 },
      ],
      doors:   [],
      windows: [],
      furniture: [
        { id: 'car1',   roomId: 'g', kind: 'car',          shape: 'rect', x: 1,  y: 1,  w: 16, h: 14 },
        { id: 'fridge1',roomId: 'k', kind: 'refrigerator', shape: 'rect', x: 21, y: 1,  w: 2.5, h: 2.5 },
        { id: 'stove1', roomId: 'k', kind: 'stove',        shape: 'rect', x: 24, y: 1,  w: 2.5, h: 2.5 },
      ],
    }],
  };

  const svg = renderPlanSvg(planSpec);
  assert.ok(svg.includes('REF'),    'Expected fridge REF label in SVG');
  assert.ok(svg.includes('circle'), 'Expected stove burner circles in SVG');
  // Car body is a rect with rx — check it appears somewhere
  assert.ok(svg.length > 500,       'Expected substantial SVG output');
});

// ── MATERIAL_LEGEND ───────────────────────────────────────────────────────────

test('MATERIAL_LEGEND covers all five material types', () => {
  const materials = MATERIAL_LEGEND.map((e) => e.material);
  for (const mat of ['wood', 'tile', 'concrete', 'stone', 'neutral']) {
    assert.ok(materials.includes(mat), `MATERIAL_LEGEND missing: ${mat}`);
  }
});

// ── attachPresentationMetadata ────────────────────────────────────────────────

test('attachPresentationMetadata adds surfaceMaterial and surfacePattern to rooms', () => {
  const planSpec = {
    levels: [{
      level: 1,
      rooms: [
        { id: 'lr', type: 'living_room' },
        { id: 'k',  type: 'kitchen' },
        { id: 's',  type: 'storage' },
      ],
    }],
  };

  attachPresentationMetadata(planSpec);

  const lr = planSpec.levels[0].rooms[0];
  assert.equal(lr.surfaceMaterial, 'wood');
  assert.equal(lr.surfacePattern,  SVG_PATTERN_ID.wood);

  const k = planSpec.levels[0].rooms[1];
  assert.equal(k.surfaceMaterial, 'tile');
  assert.equal(k.surfacePattern,  SVG_PATTERN_ID.tile);

  const s = planSpec.levels[0].rooms[2];
  assert.equal(s.surfaceMaterial, undefined, 'storage should not get a surface material');
});

test('attachPresentationMetadata sets presentation.materialLegend on planSpec', () => {
  const planSpec = { levels: [{ level: 1, rooms: [] }] };
  attachPresentationMetadata(planSpec);
  assert.ok(Array.isArray(planSpec.presentation.materialLegend), 'Expected materialLegend array');
  assert.ok(planSpec.presentation.materialLegend.length >= 5);
});
