import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentsToVertices, closure, corners, area, selfIntersects, closingSegment, verticesToSegments, rapd, surveyedPolygon }
    from '../src/studio/plotSketch.js';

test('a rectangle entered as four sides with 90° corners closes exactly', () => {
    const sides = [{ length: 12, unit: 'm', angle: 0 }, { length: 10, unit: 'm', angle: 90 },
        { length: 12, unit: 'm', angle: 90 }, { length: 10, unit: 'm', angle: 90 }];
    const pts = segmentsToVertices(sides, 'interior');
    assert.deepEqual(pts.at(-1), { x: 0, y: 0 });
    assert.equal(closure(pts).closed, true);
    assert.equal(corners(pts).length, 4);
    assert.equal(area(corners(pts)), 120);
});

test('direction mode and feet units give the same plot', () => {
    const ft = 1 / 0.3048;
    const sides = [{ length: 12 * ft, unit: 'ft', angle: 0 }, { length: 10 * ft, unit: 'ft', angle: 90 },
        { length: 12 * ft, unit: 'ft', angle: 180 }, { length: 10 * ft, unit: 'ft', angle: 270 }];
    const pts = segmentsToVertices(sides, 'direction');
    assert.ok(closure(pts).gapM < 0.002);
    assert.ok(Math.abs(area(corners(pts)) - 120) < 0.02);
});

test('the closing side is computed in both modes and an irregular plot round-trips', () => {
    const survey = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 13, y: 10 }, { x: 4, y: 13 }, { x: 0, y: 9 }];
    for (const mode of ['interior', 'direction']) {
        const segs = verticesToSegments(survey, mode);
        assert.equal(segs.length, 4);
        const last = closingSegment(segs, mode);
        const pts = segmentsToVertices([...segs, last], mode);
        assert.equal(closure(pts).closed, true, mode);
        corners(pts).forEach((p, i) => { assert.ok(Math.abs(p.x - survey[i].x) < 0.01 && Math.abs(p.y - survey[i].y) < 0.01, `${mode} ${i}`); });
    }
    assert.equal(area(survey), 142.5);
});

test('crossed boundaries are detected and the survey payload matches the backend contract', () => {
    assert.equal(selfIntersects([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), true);
    assert.equal(selfIntersects([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), false);
    const s = surveyedPolygon([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]);
    assert.equal(s.shape, 'surveyedPolygon');
    assert.deepEqual(s.vertices[1], { x: 3, y: 0, unit: 'm' });
    assert.deepEqual(s.sideLengths.map(l => l.value), [3, 4, 5]);
    assert.equal(rapd(508.737), '1-0-0-0');
});
