'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v1 = require('../lib/residential/v2/variationDiversityValidator');
const {
  THRESHOLDS,
  collectWholeRooms,
  buildAdjacencySet,
  checkPairDiversityV2,
  compareMetrics,
  validateVariationDiversityV2,
  METRIC_VERSION,
} = require('../lib/residential/v2/diversityMetricV2');
const { selectDiversePlans } = require('../lib/residential/v2/selectDiversePlans');

const plan = (rooms) => ({ levels: [{ level: 1, rooms }] });

/* The same four rooms, in the same relationship, slid sideways. */
const slidPlan = (dx) => plan([
  { id: 'kitchen', type: 'kitchen', x: 0 + dx, y: 0, w: 12, h: 12 },
  { id: 'dining', type: 'dining_room', x: 12 + dx, y: 0, w: 12, h: 12 },
  { id: 'living', type: 'living_room', x: 24 + dx, y: 0, w: 14, h: 12 },
  { id: 'hall', type: 'hallway', x: 0 + dx, y: 12, w: 38, h: 4 },
]);

/* Counterexample 1: unchanged topology, moved coordinates.
 *
 * v1 keys adjacency edges by a signature containing grid coordinates, so
 * sliding the plan changes every edge ID and one move registers as a placement
 * change AND a graph change. Two dimensions is the bar, so a pure translation
 * can pass as a genuinely different option. */
test('a plan slid sideways is not a different plan', () => {
  const a = slidPlan(0);
  const b = slidPlan(8);

  const legacy = v1.checkPairDiversity(a, b);
  const corrected = checkPairDiversityV2(a, b);

  assert.equal(legacy.valid, true,
    'documents the v1 behaviour being corrected: a translation passes today');
  assert.equal(corrected.valid, false,
    'the graph is identical, so only placement changed and one dimension is not enough');

  const graph = corrected.dims.find((dim) => dim.name === 'adjacency_graph');
  assert.equal(graph.diverse, false, 'same rooms, same connections, same graph');
  assert.equal(graph.editDistance, 0);
});

test('corrected selection rejects translated duplicates without changing legacy policy', () => {
  const ranked = [0, 8, 16].map(dx => ({ planSpec: slidPlan(dx) }));
  const snapshot = structuredClone(ranked);
  assert.equal(selectDiversePlans(ranked).selected.length, 3);
  const selected = selectDiversePlans(ranked, 4, { metricVersion: METRIC_VERSION });
  assert.equal(selected.selected.length, 1);
  assert.equal(selected.selected[0], ranked[0], 'Rank order breaks ties');
  assert.equal(selected.targetMet, false);
  assert.equal(selected.metricVersion, METRIC_VERSION);
  assert.deepEqual(selectDiversePlans(ranked, 4, { metricVersion: METRIC_VERSION }), selected);
  assert.deepEqual(ranked, snapshot);
  assert.throws(() => selectDiversePlans(ranked, 4, { metricVersion: 'unknown' }), /Unknown diversity metric/);
});

test('corrected response diagnostics do not certify empty, singleton or duplicate option sets', () => {
  for (const plans of [[], [slidPlan(0)], [slidPlan(0), slidPlan(8)]]) {
    const summary = validateVariationDiversityV2(plans);
    assert.equal(summary.metricVersion, METRIC_VERSION);
    assert.equal(summary.valid, false);
    assert.equal(summary.validPairCount, 0);
    assert.equal(summary.pairCount, plans.length === 2 ? 1 : 0);
  }
  assert.equal(validateVariationDiversityV2([slidPlan(0), slidPlan(8)]).failedPairs.length, 1);
});

/* Counterexample 2: a composite room is one room.
 *
 * v1 flattens parts into separate entries, so an L-shaped living room counts
 * as two living rooms and can contribute twice to the two-major-rooms
 * placement threshold. */
test('a composite room counts once, with one centroid', () => {
  const composite = plan([
    {
      id: 'living',
      type: 'living_room',
      parts: [
        { x: 0, y: 0, w: 10, h: 20 },
        { x: 10, y: 0, w: 10, h: 10 },
      ],
    },
    { id: 'kitchen', type: 'kitchen', x: 10, y: 10, w: 10, h: 10 },
  ]);

  const whole = collectWholeRooms(composite);
  const living = whole.filter((room) => room.type === 'living_room');
  assert.equal(living.length, 1, 'an L-shaped room is one room, not two');
  assert.equal(living[0].areaSqFt, 300, 'its area is the sum of its parts');

  // Area-weighted centroid: 200 sq ft at (5,10) and 100 sq ft at (15,5).
  assert.ok(Math.abs(living[0].centroid.x - (5 * 200 + 15 * 100) / 300) < 1e-9);
  assert.ok(Math.abs(living[0].centroid.y - (10 * 200 + 5 * 100) / 300) < 1e-9);

  const legacyRooms = v1.collectPlanRooms(composite).filter((room) => room.type === 'living_room');
  assert.ok(legacyRooms.length > 1, 'documents the v1 behaviour being corrected');
});

/* Counterexample 3: relabelling a room is not a topology change.
 *
 * v1's edge signature includes the room type, so renaming a study to a library
 * rewrites edges and registers as a graph difference even though nothing moved
 * and nothing reconnected. */
test('relabelling a room does not rewrite the graph', () => {
  const before = plan([
    { id: 'r1', type: 'study', x: 0, y: 0, w: 10, h: 10 },
    { id: 'r2', type: 'kitchen', x: 10, y: 0, w: 10, h: 10 },
  ]);
  const after = plan([
    { id: 'r1', type: 'library', x: 0, y: 0, w: 10, h: 10 },
    { id: 'r2', type: 'kitchen', x: 10, y: 0, w: 10, h: 10 },
  ]);

  const edgesBefore = buildAdjacencySet(before);
  const edgesAfter = buildAdjacencySet(after);
  assert.deepEqual([...edgesBefore], [...edgesAfter],
    'the rooms are still connected the same way, so the edge set is unchanged');
});

/* Insufficient data must not be an automatic pass. */
test('plans that cannot be compared are not called diverse', () => {
  const sparse = plan([{ id: 'only', type: 'kitchen', x: 0, y: 0, w: 10, h: 10 }]);
  const other = plan([{ id: 'only', type: 'kitchen', x: 4, y: 0, w: 10, h: 10 }]);

  const corrected = checkPairDiversityV2(sparse, other);
  const placement = corrected.dims.find((dim) => dim.name === 'room_centroid');
  assert.equal(placement.notEvaluable, true, 'one major room is not enough to judge placement');
  assert.equal(placement.diverse, false, 'not evaluable cannot satisfy a requirement');
  assert.equal(corrected.valid, false);

  const legacy = v1.checkPairDiversity(sparse, other);
  const legacyPlacement = legacy.dims.find((dim) => dim.name === 'room_centroid');
  assert.equal(legacyPlacement.diverse, true,
    'documents the v1 behaviour being corrected: knowing nothing counted as diverse');
});

/* The correction changes how the dimensions are measured, not how much
   difference is demanded. If these move, the comparison stops being like for
   like and any change in pass rate becomes uninterpretable. */
test('the acceptance thresholds are unchanged from v1', () => {
  assert.equal(THRESHOLDS.minDimensions, 2);
  assert.equal(THRESHOLDS.placementShiftFt, 6);
  assert.equal(THRESHOLDS.placementRoomCount, 2);
  assert.equal(THRESHOLDS.adjacencyEditDistance, 3);
});

/* Both metrics must be reportable on one plan set, so a difference can be
   shown as a measurement change rather than asserted as an engine gain. */
test('the two metrics can be reported side by side', () => {
  const report = compareMetrics([slidPlan(0), slidPlan(8), slidPlan(16)]);
  assert.equal(report.pairCount, 3);
  assert.ok(report.v1ValidPairs > report.v2ValidPairs,
    'translations pass under v1 and not under v2');
  assert.equal(report.disagreements.length, report.v1ValidPairs - report.v2ValidPairs);
  assert.ok(report.metricVersion);
});

test('one counterpart cannot count twice through stable-ID and type fallback matching', () => {
  const a=plan([{id:'kept',type:'bedroom',x:0,y:0,w:10,h:10},{id:'removed',type:'bedroom',x:20,y:0,w:10,h:10}]);
  const b=plan([{id:'kept',type:'bedroom',x:30,y:0,w:10,h:10},{id:'new',type:'bedroom',x:20,y:0,w:10,h:10}]);
  const placement=checkPairDiversityV2(a,b).dims.find(d=>d.name==='room_centroid');
  assert.equal(placement.shiftedCount,1);
  assert.equal(placement.diverse,false);
});

test('duplicate anonymous bedroom identities cannot establish diversity', () => {
  const a=plan([{type:'bedroom',x:0,y:0,w:10,h:10},{type:'bedroom',x:10,y:0,w:10,h:10}]);
  const b=plan([{type:'bedroom',x:20,y:0,w:10,h:10},{type:'bedroom',x:30,y:0,w:10,h:10}]);
  const result=checkPairDiversityV2(a,b);
  assert.equal(result.valid,false);
  assert.ok(result.dims.find(d=>d.name==='adjacency_graph').notEvaluable);
});
