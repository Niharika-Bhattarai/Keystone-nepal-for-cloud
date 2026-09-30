import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFeet, levelTransform, previewCells, quickResize, roomSides, snapDelta, sortIssues, issueTitle, sharedSegments, sharedLength,
    canJoin, keeperOf, runSections, openPairs, openPlanPair, pairKey, membersOf, groupName, boxOf, roomAt, placementProblem } from '../src/lib/planEdit.js';

const plan = { levels: [{ level: 1, rooms: [
    { id: 'k', type: 'kitchen', label: 'Kitchen', x: 0, y: 0, w: 12, h: 10 },
    { id: 'd', type: 'dining_room', label: 'Dining', x: 12, y: 0, w: 10, h: 10 },
    { id: 'l', type: 'living_room', label: 'Living', x: 0, y: 10, w: 22, h: 12, parts: [{ x: 0, y: 10, w: 22, h: 12 }] },
] }] };
const run = { id: '1:x:12:0-10', level: 1, axis: 'x', at: 12, from: 0, to: 10, movable: true, minDelta: -9, maxDelta: 7,
    moves: [{ roomId: 'k', part: null, edge: 'right' }, { roomId: 'd', part: null, edge: 'left' }] };
const floor = { id: '1:y:10:0-22', level: 1, axis: 'y', at: 10, from: 0, to: 22, movable: true, minDelta: -7, maxDelta: 9,
    moves: [{ roomId: 'k', part: null, edge: 'bottom' }, { roomId: 'd', part: null, edge: 'bottom' }, { roomId: 'l', part: 0, edge: 'top' }] };

test('feet read as a drafter writes them', () => {
    assert.equal(formatFeet(12), '12′');
    assert.equal(formatFeet(12.5), '12′ 6″');
    assert.equal(formatFeet(7.25), '7′ 3″');
    assert.equal(formatFeet(-1.5), '−1′ 6″');
    assert.equal(formatFeet(9.999), '10′');
});

test('a dragged wall snaps to six inches and stops where a room would drop under 3 ft', () => {
    assert.equal(snapDelta(1.2, run), 1);
    assert.equal(snapDelta(1.3, run), 1.5);
    assert.equal(snapDelta(20, run), 7);
    assert.equal(snapDelta(-20, run), -9);
});

test('the preview moves exactly the room edges on the run', () => {
    const cells = previewCells(plan, run, 2);
    assert.deepEqual(cells.map((c) => [c.roomId, c.x, c.w]), [['k', 0, 14], ['d', 14, 8]]);
    const below = previewCells(plan, floor, -1);
    assert.deepEqual(below.map((c) => [c.roomId, c.y, c.h]), [['k', 0, 9], ['d', 0, 9], ['l', 9, 13]]);
});

test('quick actions pick a wall that can move, growing or shrinking the room', () => {
    const runs = [run, floor];
    assert.deepEqual(roomSides(runs, 'k'), { left: null, right: run, top: null, bottom: floor });
    assert.deepEqual(quickResize(runs, 'k', 'wide', 1), { op: 'moveWall', runId: run.id, delta: 1 });
    assert.deepEqual(quickResize(runs, 'd', 'wide', 1), { op: 'moveWall', runId: run.id, delta: -1 });
    assert.deepEqual(quickResize(runs, 'k', 'deep', -1), { op: 'moveWall', runId: floor.id, delta: -1 });
    assert.equal(quickResize(runs, 'k', 'wide', 10), null);
});

test('plan feet map into the drawing through each floor\'s origin', () => {
    const t = levelTransform({ levels: [{ level: 2, originX: 500, originY: 100, pxPerFt: 18 }] }, 2);
    assert.equal(t.x(10), 680);
    assert.equal(t.y(0), 100);
    assert.equal(t.toFt(36), 2);
    assert.equal(t.ftX(680), 10);
    assert.equal(t.ftY(136), 2);
    assert.equal(levelTransform({ levels: [] }, 1), null);
});

test('rooms share walls, and only neighbours that are not the stair or garage can open up or merge', () => {
    const [k, d, l] = plan.levels[0].rooms;
    assert.deepEqual(sharedSegments(k, d), [{ axis: 'x', at: 12, from: 0, to: 10 }]);
    assert.deepEqual(sharedSegments(d, k), [{ axis: 'x', at: 12, from: 0, to: 10 }]);
    assert.equal(sharedLength(k, l), 12);
    assert.equal(sharedLength(l, d), 10);
    assert.equal(canJoin(k, d), true);
    assert.equal(canJoin(k, { ...d, type: 'garage' }), false);
    assert.equal(canJoin(k, { id: 'far', type: 'bedroom', x: 40, y: 0, w: 10, h: 10 }), false);
    // The larger room keeps its name, unless the other is the primary suite.
    assert.equal(keeperOf(k, l), l);
    assert.equal(keeperOf({ ...k, type: 'primary_bedroom' }, l).type, 'primary_bedroom');
    assert.equal(pairKey('b', 'a'), 'a|b');
    assert.equal(openPlanPair({ openConcept: true }, k, d), true, 'an open-plan kitchen and dining room have no wall');
    assert.equal(openPlanPair({ openConcept: false }, k, d), false);
    assert.equal(openPlanPair({ openConcept: true }, k, { type: 'bedroom' }), false);
    assert.deepEqual([...openPairs({ openEdges: [{ a: 'k', b: 'd' }] })], ['d|k']);
});

test('a click on a wall run finds the two rooms it divides there', () => {
    const sections = runSections(floor, plan.levels[0]);
    assert.deepEqual(sections.map((s) => [s.a.id, s.b.id, s.from, s.to]), [['k', 'l', 0, 12], ['d', 'l', 12, 22]]);
    assert.deepEqual(runSections(run, plan.levels[0]).map((s) => [s.a.id, s.b.id]), [['k', 'd']]);
});

test('furniture moves with its group and companions, and stays where it belongs', () => {
    const furniture = [
        { id: 'bed', kind: 'bed_queen', roomId: 'b', x: 2, y: 0.3, w: 5, h: 7 },
        { id: 'ns1', kind: 'nightstand', roomId: 'b', x: 0.3, y: 0.3, w: 1.5, h: 1.5 },
        { id: 'ns2', kind: 'nightstand', roomId: 'b', x: 7.2, y: 0.3, w: 1.5, h: 1.5 },
        { id: 'dresser', kind: 'dresser', roomId: 'b', x: 2, y: 10, w: 5, h: 2 },
        { id: 't', kind: 'dining_table', roomId: 'd', x: 3, y: 3, w: 4, h: 3 },
        { id: 'c1', kind: 'chair_1', roomId: 'd', x: 2, y: 4, w: 1.5, h: 1.5 },
    ];
    assert.deepEqual(membersOf(furniture, furniture[0]).map((i) => i.id), ['bed', 'ns1', 'ns2']);
    assert.deepEqual(membersOf(furniture, furniture[1]).map((i) => i.id), ['ns1'], 'a nightstand moves alone');
    assert.deepEqual(membersOf(furniture, furniture[5]).map((i) => i.id), ['t', 'c1']);
    assert.equal(groupName(membersOf(furniture, furniture[0])), 'Queen bed and nightstands');
    assert.equal(groupName([furniture[4], furniture[5]]), 'Dining table and chairs');
    assert.deepEqual(boxOf([furniture[0], furniture[1]]), { x: 0.3, y: 0.3, w: 6.7, h: 7 });
    assert.equal(roomAt(plan.levels[0], 15, 5).id, 'd');
    assert.equal(roomAt(plan.levels[0], 50, 5), null);
    assert.equal(placementProblem([{ kind: 'toilet' }], { type: 'bedroom' }), 'The toilet stays in a bathroom.');
    assert.equal(placementProblem([{ kind: 'sofa' }], null), 'Keep the sofa inside the house.');
    assert.equal(placementProblem([{ kind: 'sofa' }], { type: 'bedroom' }), null);
});

test('findings sort by severity and are titled by their room', () => {
    const issues = [{ severity: 'info', code: 'x' }, { severity: 'warn', code: 'room_narrow', roomId: 'd' }, { severity: 'block', code: 'y' }];
    assert.deepEqual(sortIssues(issues).map((i) => i.severity), ['block', 'warn', 'info']);
    assert.equal(issueTitle(issues[1], plan.levels[0].rooms), 'Dining is now very narrow');
});
