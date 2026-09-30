'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderElevationForView, getElevationStyleProfile, renderElevations } = require('../lib/renderElevationSvg');
const { renderElevationPresentation, renderElevationPresentations } = require('../lib/renderedElevationStyles');

const plan = { levels: [{ level: 1, width: 30, height: 24,
  rooms: [{ id: 'living', type: 'living_room', x: 0, y: 0, w: 18, h: 24 },
    { id: 'garage', type: 'garage', x: 18, y: 0, w: 12, h: 24 }],
  doors: [{ a: 'garage', b: '__exterior__', x: 24, y: 24, width: 9, dir: 'horizontal', garageDoor: true },
    { a: 'living', b: '__exterior__', x: 8, y: 24, width: 3, dir: 'horizontal', isMainEntry: true }],
  windows: [{ roomId: 'living', x: 6, y: 0, width: 4, dir: 'horizontal' }, { roomId: 'living', x: 0, y: 8, width: 4, dir: 'vertical' }],
}] };

function architecture(svg) {
  const clean = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '')
    .replace(/<g class="elevation-backdrop">[\s\S]*?<\/g>/, '')
    .replace(/<rect width="100%" height="100%"[^>]*\/>/, '');
  return [...clean.matchAll(/<(rect|path|line|circle|ellipse|polygon|polyline)\b[^>]*>/g)].map(([tag, name]) => ({
    name, geometry: [...tag.matchAll(/\b(x|y|x1|x2|y1|y2|width|height|d|points|rx|ry|cx|cy|r|transform)="([^"]*)"/g)]
      .map(([, key, value]) => [key, value]).sort(),
  }));
}

for (const materials of ['Craftsman (Wood & Stone)', 'Modern Farmhouse (Board & Batten)', 'Traditional Colonial (Brick)', 'Contemporary Modern (Concrete)', 'Mediterranean (Stucco & Tile)']) {
  test(`rendered elevations preserve every architectural coordinate: ${materials}`, () => {
    const before = structuredClone(plan);
    for (const frontFacing of ['North', 'South', 'East', 'West']) {
      const survey = { materials, frontFacing };
      const result = renderElevationPresentations(plan, survey);
      const ids = new Set();
      for (const view of ['front', 'rear', 'left', 'right']) {
        const normal = renderElevationForView(plan, survey, view);
        const rendered = result[`${view}Svg`];
        assert.deepEqual(architecture(rendered), architecture(normal));
        assert.equal(rendered.match(/viewBox="[^"]+"/)[0], normal.match(/viewBox="[^"]+"/)[0]);
        assert.match(rendered, /class="rendered-elevation"/);
        assert.match(rendered, /elevation-roof-shadow/);
        for (const [, id] of rendered.matchAll(/\bid="([^"]+)"/g)) {
          assert.ok(!ids.has(id), `SVG resource collision: ${id}`); ids.add(id);
        }
        for (const [, ref] of rendered.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.has(ref), `Missing resource: ${ref}`);
      }
    }
    assert.deepEqual(plan, before);
  });
}

test('rendered material treatments include selected stone and metal roofing', () => {
  const survey = { materials: 'Modern Farmhouse (Board & Batten)' };
  const withFinish = { ...plan, finishSpec: { exterior: { primaryCladding: { material: 'stone_veneer' } }, roofing: { material: 'standing_seam_metal' } } };
  const normal = renderElevationForView(withFinish, survey, 'front');
  const result = renderElevationPresentation(normal, withFinish.finishSpec, survey);
  assert.match(result, /fill="#b7b0a0"/);
  assert.match(result, /fill="#525e63"/);
  assert.deepEqual(architecture(result), architecture(normal));
});

test('new Modern Farmhouse elevations use farmhouse roofs, while saved roof geometry is retained during styling', () => {
  assert.equal(getElevationStyleProfile({ materials: 'Modern Farmhouse (Board & Batten)' }).roofKind, 'cross_gable');
  const oldDrawing = renderElevations(plan, { materials: 'Contemporary Modern (Concrete)' });
  const saved = { ...plan, elevations: oldDrawing };
  const rendered = renderElevationPresentations(saved, { materials: 'Modern Farmhouse (Board & Batten)' });
  assert.equal(rendered.meta.roofKind, oldDrawing.meta.roofKind);
  assert.deepEqual(architecture(rendered.frontSvg), architecture(oldDrawing.frontSvg));
});
