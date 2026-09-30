import test from 'node:test';
import assert from 'node:assert/strict';
import { featureCount, featureChoicesFor, withFeatureCount, normalizeFeatureSelections, parseFeatureSelections } from '../src/lib/featureRooms.js';

test('restored plural and duplicate requests retain their actual quantities', () => {
    assert.equal(featureCount('2 Studies, 1 Study', 'study'), 3);
    assert.equal(featureCount('2 Libraries', 'library'), 2);
    assert.equal(withFeatureCount('2 Studies, 1 Study, 1 Playroom', 'study', 2), '2 Study, 1 Playroom');
    assert.equal(withFeatureCount('2 Studies, 1 Playroom', 'study', 0), '1 Playroom');
});

test('gaming and playroom counts are independent and unknown selections survive editing', () => {
    const source = '1 Gaming Room; 2 Playrooms, 1 Observatory';
    // Invalid/unrecognized text must remain visible for backend diagnostics.
    assert.ok(parseFeatureSelections(source).some(item => item.raw === '1 Observatory' && item.kind === null));
    assert.equal(withFeatureCount('1 Gaming Room, 1 Playroom, 1 Observatory', 'playroom', 2), '1 Gaming Room, 2 Playroom, 1 Observatory');
    assert.equal(featureCount('1 Gaming Room, 2 Playroom', 'gaming_room'), 1);
    assert.throws(() => withFeatureCount('', 'study', 1.5));
});

test('only declared old picker alias pairs collapse during restoration', () => {
    const explicit = '1 Study, 1 Home Office';
    assert.equal(normalizeFeatureSelections(explicit), explicit);
    assert.equal(normalizeFeatureSelections(explicit, 1), '1 Study');
    assert.equal(normalizeFeatureSelections('2 Studies', 1), '2 Studies');
    assert.equal(normalizeFeatureSelections('1 Home Office'), '1 Home Office');
    assert.ok(featureChoicesFor(explicit).some(item => item.kind === 'home_office'));
    assert.equal(withFeatureCount(explicit, 'study', 0), '1 Home Office');
});
