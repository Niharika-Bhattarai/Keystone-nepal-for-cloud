import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTERIOR_SCHEMES, INTERIOR_SCHEMES, exteriorScheme, interiorScheme, roomPaint, subtractIntervals } from '../src/studio/colourSchemes.js';

test('every exterior scheme defines each painted element as a hex colour', () => {
    assert.ok(EXTERIOR_SCHEMES.length >= 8);
    for (const s of EXTERIOR_SCHEMES) for (const k of ['wall', 'band', 'trim', 'parapet', 'plinth', 'roof'])
        assert.match(s[k], /^#[0-9a-f]{6}$/, `${s.id}.${k}`);
    assert.equal(new Set(EXTERIOR_SCHEMES.map(s => s.id)).size, EXTERIOR_SCHEMES.length);
    assert.equal(exteriorScheme('nope').id, EXTERIOR_SCHEMES[0].id);
});

test('interior schemes paint every room type the planner produces', () => {
    for (const s of INTERIOR_SCHEMES) for (const t of ['livingRoom', 'kitchen', 'primaryBedroom', 'bedroom', 'bathroom', 'puja', 'lobby', 'study'])
        assert.match(roomPaint(s, t), /^#[0-9a-f]{6}$/, `${s.id}.${t}`);
    assert.match(interiorScheme('vastu-guidance').note, /not from the supplied library/);
});

test('paint strips leave gaps for doors and windows', () => {
    assert.deepEqual(subtractIntervals(0, 1000, [[200, 400], [700, 900]]), [[0, 200], [400, 700], [900, 1000]]);
    assert.deepEqual(subtractIntervals(0, 1000, [[-50, 1200]]), []);
    assert.deepEqual(subtractIntervals(0, 1000, []), [[0, 1000]]);
});
