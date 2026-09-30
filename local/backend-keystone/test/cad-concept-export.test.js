'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { buildDxf, prepareDxf } = require('../lib/cad/buildDxf');
const fixture = () => ({ levels: [{ level: 1, width: 20, height: 10,
  rooms: [{ id: 'a', type: 'bedroom', x: 0, y: 0, w: 10, h: 10 },
    { id: 'b', type: 'study', x: 10, y: 0, w: 10, h: 10 }],
  doors: [{ a: 'a', b: 'b', x: 10, y: 5, width: 6, dir: 'vertical' }],
  windows: [{ roomId: 'a', x: 5, y: 0, width: 4, dir: 'horizontal', sillHeightFt: 3, headHeightFt: 7 }],
}] });

test('fractional wall thickness leaves no disconnected wall endpoints on furnished two-storey plan', () => {
  const plan = require('./fixtures/model3d-plan.json');
  const drawing = prepareDxf(plan);
  for (const level of drawing.levels) {
    const degree = new Map();
    for (const edge of level.outline) for (const end of [edge.start, edge.end]) {
      const point = edge.dir === 'vertical' ? [edge.fixed, end] : [end, edge.fixed];
      const key = point.map(n => n.toFixed(6)).join(',');
      degree.set(key, (degree.get(key) || 0) + 1);
    }
    assert.ok([...degree.values()].every(n => n === 2), 'wall boundaries must form closed loops');
    assert.equal(level.furniture.length, plan.levels.find(l => l.level === level.level).furniture.length);
    assert.equal(level.openings.find(o => o.kind === 'window').tag, `W${level.level}-1`);
  }
  const dxf = buildDxf(plan).dxf;
  for (const layer of ['A-FURN', 'A-FIXT', 'A-STAIR-RISR', 'A-STAIR-PATH', 'A-DOOR-SWNG']) assert.ok(dxf.includes(layer));
  assert.ok(dxf.includes('BUILDING OPENING SCHEDULE'));
});

test('wall outlines have actual six-foot door and four-foot window gaps', () => {
  const drawing = prepareDxf(fixture()).levels[0];
  const crosses = (edge, dir, fixed, start, end) => edge.dir === dir && Math.abs(edge.fixed - fixed) < .01
    && edge.start < end - .001 && edge.end > start + .001;
  for (const face of [10 - .1875, 10 + .1875]) {
    assert.equal(drawing.outline.some(e => crosses(e, 'vertical', face, 2, 8)), false);
  }
  for (const face of [-7.25 / 24, 7.25 / 24]) {
    assert.equal(drawing.outline.some(e => crosses(e, 'horizontal', face, 3, 7)), false);
  }
  assert.equal(drawing.openings[0].width, 6);
});

test('DXF parses cleanly with editable dimensions, level blocks and opening schedule', () => {
  const result = buildDxf(fixture());
  const checked = spawnSync(process.env.PYTHON || 'python', ['-c', [
    'import io,json,sys,ezdxf',
    'd=ezdxf.read(io.StringIO(sys.stdin.read()))',
    'a=d.audit()',
    'b=d.blocks.get("LEVEL_1")',
    'print(json.dumps({"errors":len(a.errors),"fixes":len(a.fixes),"units":d.units,"dims":len(b.query("DIMENSION")),"arcs":len(b.query("ARC")),"schedule":[e.dxf.text for e in [e for block in d.blocks for e in block.query("TEXT")]]}))',
  ].join('\n')], { input: result.dxf, encoding: 'utf8', windowsHide: true });
  assert.equal(checked.status, 0, checked.stderr);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.errors, 0);
  assert.equal(report.fixes, 0);
  assert.equal(report.units, 2);
  assert.ok(report.dims > 2);
  assert.equal(report.arcs, 1);
  assert.ok(report.schedule.some(s => s === '6.000'));
});

test('invalid and unattached openings fail explicitly instead of exporting invented geometry', () => {
  const p = fixture();
  p.levels[0].doors[0].x = 7;
  assert.throws(() => prepareDxf(p), /does not lie on a wall/);
  p.levels[0].doors[0].x = 10;
  p.levels[0].doors[0].width = 30;
  assert.throws(() => prepareDxf(p), /extends beyond/);
});

test('overlapping openings and a falsely valid stale stair layout are rejected', () => {
  const p = fixture();
  p.levels[0].doors.push({ ...p.levels[0].doors[0], y: 6 });
  assert.throws(() => prepareDxf(p), /overlap/);
  const stairs = structuredClone(require('./fixtures/model3d-plan.json'));
  stairs.levels[0].stairCore.layout.risers += 1;
  assert.throws(() => prepareDxf(stairs), /Invalid saved stair/);
});

test('paper sheets preserve model feet and include plans, elevations and schedules', () => {
  const result = buildDxf(fixture());
  const checked = spawnSync(process.env.PYTHON || 'python', ['-c', [
    'import io,json,sys,ezdxf',
    'd=ezdxf.read(io.StringIO(sys.stdin.read()))',
    'print(json.dumps({"layouts":d.layouts.names(),"views":[{"locked":bool(v.dxf.flags & 16384),"height":v.dxf.view_height} for l in d.layouts if l.name!="Model" for v in l.query("VIEWPORT") if v.dxf.id>1],"roof":len(d.blocks.get("ELEVATION_TOP").query("LWPOLYLINE"))}))',
  ].join('\n')], { input: result.dxf, encoding: 'utf8', windowsHide: true });
  assert.equal(checked.status, 0, checked.stderr);
  const report = JSON.parse(checked.stdout);
  for (const name of ['A101', 'A201', 'A202', 'A203', 'A204', 'A601', 'A701']) assert.ok(report.layouts.includes(name));
  assert.ok(report.views.length >= 7);
  assert.ok(report.views.every(v => v.locked && v.height > 0));
  assert.ok(report.roof > 0);
});

test('lineweight hierarchy survives DXF roundtrip and sheets print physical widths', () => {
  const checked = spawnSync(process.env.PYTHON || 'python', ['-c', [
    'import io,json,sys,ezdxf',
    'd=ezdxf.read(io.StringIO(sys.stdin.read()))',
    'b=d.blocks.get("LEVEL_1")',
    'print(json.dumps({"weights":{l.dxf.name:l.dxf.lineweight for l in d.layers},"display":d.header["$LWDISPLAY"],"flags":[l.dxf_layout.dxf.plot_layout_flags for l in d.layouts if l.name.startswith("A")],"wallWeights":[e.dxf.lineweight for e in b.query(\'LINE[layer=="A-WALL"]\')],"dimensions":[e.dxf.text for e in b.query("DIMENSION")]}))',
  ].join('\n')], { input: buildDxf(fixture()).dxf, encoding: 'utf8', windowsHide: true });
  assert.equal(checked.status, 0, checked.stderr);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.weights['A-WALL'], 50);
  assert.equal(report.weights['A-DOOR'], 25);
  assert.equal(report.weights['A-STAIR-RISR'], 18);
  assert.equal(report.weights['A-FURN'], 13);
  assert.equal(report.weights['A-STAIR-OVHD'], 9);
  assert.equal(report.display, 1);
  assert.ok(report.wallWeights.length > 0 && report.wallWeights.every(w => w === -1));
  assert.ok(report.flags.length > 0 && report.flags.every(f => (f & 128) && !(f & 64) && !(f & 32)));
  assert.ok(report.dimensions.some(text => text === '6\'-0"'));
});

test('all saved floors are exported, including a third floor', () => {
  const p = fixture();
  p.levels = [1, 2, 3].map(level => ({ ...structuredClone(p.levels[0]), level }));
  assert.equal(prepareDxf(p).levels.length, 3);
  assert.match(buildDxf(p).dxf, /LEVEL_3/);
});

test('backend endpoint enforces downloads entitlement and returns a CAD attachment', async () => {
  const { MemoryStore, setStore } = require('../lib/accounts/store');
  const { setVerifier } = require('../lib/accounts/auth');
  const { createApp } = require('../app');
  const store = new MemoryStore();
  setStore(store);
  setVerifier(async token => ({ uid: token, email: `${token}@example.test`, email_verified: true }));
  await store.ensureUser('paid', 'paid@example.test');
  await store.updateUser('paid', { devAccess: true });
  const unused = (req, res) => res.status(503).end();
  const app = createApp({ handlers: Object.fromEntries(['plan', 'preflight', 'presentation', 'svg', 'model', 'refine', 'estimate'].map(k => [k, unused])) });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const request = (token, planSpec = fixture()) => fetch(`http://127.0.0.1:${server.address().port}/api/plan/dxf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ planSpec }),
    });
    assert.equal((await request()).status, 401);
    assert.equal((await request('free')).status, 402);
    const response = await request('paid');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /attachment.*\.dxf/);
    assert.match(await response.text(), /AC1024/);
    assert.equal((await request('paid', {})).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    setVerifier(null);
  }
});
