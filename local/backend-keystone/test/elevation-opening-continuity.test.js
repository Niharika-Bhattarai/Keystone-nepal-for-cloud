'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderElevations } = require('../lib/renderElevationSvg');

function fixture() {
  return {
    facade: { frontEdge:'bottom' },
    verticalModel: { levels:[
      { level:1, floorZFt:0, ceilingZFt:9, topOfStructureZFt:10 },
      { level:2, floorZFt:10, ceilingZFt:19, topOfStructureZFt:20 },
    ] },
    levels:[1,2].map(level => ({ level, width:40, height:30,
      rooms:[{ id:`living_${level}`, type:'living_room', x:0, y:0, w:40, h:30 }],
      doors:[],
      windows:[
        { id:`front_${level}`, dir:'horizontal', x:12, y:30, width:8 },
        { id:`rear_${level}`, dir:'horizontal', x:16, y:0, width:6 },
        { id:`left_${level}`, dir:'vertical', x:0, y:12, width:4 },
        { id:`right_${level}`, dir:'vertical', x:40, y:18, width:5 },
      ],
    })),
  };
}

test('facade includes floor structure so stacked levels meet without an empty band', () => {
  const elevations = renderElevations(fixture());
  for (const view of ['front','rear','left','right']) {
    const rects = [...elevations[`${view}Svg`].matchAll(/<rect data-facade-level="(\d+)"[^>]* y="([\d.]+)"[^>]* height="([\d.]+)"/g)]
      .map(match => ({ level:Number(match[1]), y:Number(match[2]), h:Number(match[3]) }));
    const lower = rects.find(rect => rect.level === 1), upper = rects.find(rect => rect.level === 2);
    assert.equal(lower.h, 180);
    assert.equal(upper.h, 180);
    assert.equal(upper.y + upper.h, lower.y, `${view}: upper floor meets lower structure`);
  }
});

test('each exterior window projects once at its full width, including paired panes', () => {
  const plan = fixture();
  const elevations = renderElevations(plan, { materials:'Craftsman (Wood & Stone)' });
  const all = [];
  for (const view of ['front','rear','left','right']) {
    const svg = elevations[`${view}Svg`];
    const assemblies = [...svg.matchAll(/<g data-opening="window" data-opening-id="([^"]+)" data-level="(\d+)" data-width-ft="([\d.]+)"[^>]*>([\s\S]*?)<\/g>/g)]; // later attributes (sill/head) are allowed
    assert.equal(assemblies.length, 2, `${view}: one window per floor`);
    for (const match of assemblies) {
      const expected = plan.levels.find(level => level.level === Number(match[2])).windows.find(window => window.id === match[1]);
      assert.ok(expected);
      assert.equal(Number(match[3]), expected.width);
      const panes = [...match[4].matchAll(/<rect x="([\d.-]+)"[^>]* width="([\d.]+)"/g)].map(pane => ({ x:Number(pane[1]), w:Number(pane[2]) }));
      const width = Math.max(...panes.map(pane => pane.x + pane.w)) - Math.min(...panes.map(pane => pane.x));
      assert.ok(Math.abs(width - expected.width * 18) < 1e-8, 'pane assembly retains opening width');
      all.push(match[1]);
    }
  }
  assert.deepEqual(all.sort(), plan.levels.flatMap(level => level.windows.map(window => window.id)).sort());
});
