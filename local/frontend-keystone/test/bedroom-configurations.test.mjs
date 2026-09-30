import test from 'node:test';
import assert from 'node:assert/strict';
import { surveyWithBedroomConfigurations as prepare } from '../src/lib/bedroomConfigurations.js';
import { DEFAULT_FORM_DATA } from '../src/data/survey.js';

test('untouched visible defaults are included in the generation payload', () => {
    const result = prepare(DEFAULT_FORM_DATA);
    assert.deepEqual(result.bedroomConfigs, [
        { privateBath: 'Yes', closet: 'Walk-in' },
        { privateBath: 'No', closet: 'Standard' },
        { privateBath: 'No', closet: 'Standard' },
    ]);
    assert.equal(result.privateBaths, '1');
    assert.equal(DEFAULT_FORM_DATA.bedroomConfigs, null, 'Saved-plan source state is not mutated');
});
test('saved total private-bath count is reflected by the displayed bedroom defaults', () => {
    for (const count of [0, 1, 2, 3]) {
        const result = prepare({ ...DEFAULT_FORM_DATA, privateBaths: String(count) });
        assert.equal(result.bedroomConfigs.filter(c => c.privateBath === 'Yes').length, count);
        assert.equal(result.privateBaths, String(count));
    }
});
test('explicit bedroom choices survive preparation and resizing keeps counts consistent', () => {
    const original = { ...DEFAULT_FORM_DATA, bedroomConfigs: [
        { privateBath: 'No', closet: 'Standard' }, { privateBath: 'Yes', closet: 'Walk-in' }, { privateBath: 'Yes', closet: 'Standard' },
    ] };
    assert.deepEqual(prepare(original).bedroomConfigs, original.bedroomConfigs);
    const larger = prepare({ ...original, bedrooms: '5 Bed' });
    assert.deepEqual(larger.bedroomConfigs.slice(0, 3), original.bedroomConfigs);
    assert.ok(larger.bedroomConfigs.slice(3).every(c => c.privateBath === 'No' && c.closet === 'Standard'));
    assert.equal(larger.privateBaths, '2');
    const smaller = prepare({ ...original, bedrooms: '1 Bed' });
    assert.equal(smaller.bedroomConfigs.length, 1);
    assert.equal(smaller.privateBaths, '0');
    assert.deepEqual(prepare(larger), larger, 'Preparation is idempotent');
});
test('known legacy aliases remain visible and impossible aggregate counts are not hidden', () => {
    const result = prepare({ ...DEFAULT_FORM_DATA, bedrooms: '1 Bed', bedroomConfigs: [{ privateBath: false, closet: 'Small' }] });
    assert.deepEqual(result.bedroomConfigs, [{ privateBath: 'No', closet: 'Standard' }]);
    assert.equal(prepare({ ...DEFAULT_FORM_DATA, privateBaths: '5' }).privateBaths, '5');
});
test('too few bathrooms turn off en-suites so every bedroom can reach a shared one', () => {
    const yes = r => r.bedroomConfigs.map(c => c.privateBath === 'Yes');
    // One bathroom: it is the hall bathroom, for any household.
    assert.deepEqual(yes(prepare({ ...DEFAULT_FORM_DATA, bathrooms: '1 Bath' })), [false, false, false]);
    assert.deepEqual(yes(prepare({ ...DEFAULT_FORM_DATA, bedrooms: '1 Bed', bathrooms: '1 Bath' })), [false]);
    // Saved choices give way from the last bedroom, keeping the primary en-suite.
    const saved = { ...DEFAULT_FORM_DATA, bathrooms: '2 Bath', bedroomConfigs: [
        { privateBath: 'Yes', closet: 'Walk-in' }, { privateBath: 'Yes', closet: 'Standard' }, { privateBath: 'No', closet: 'Standard' },
    ] };
    const result = prepare(saved);
    assert.deepEqual(yes(result), [true, false, false]);
    assert.equal(result.privateBaths, '1');
    assert.equal(saved.bedroomConfigs[1].privateBath, 'Yes', 'The form state itself is not mutated');
    // A one-bedroom home may keep its only bathroom as an explicit en-suite.
    assert.deepEqual(yes(prepare({ ...DEFAULT_FORM_DATA, bedrooms: '1 Bed', bathrooms: '1 Bath', bedroomConfigs: [{ privateBath: 'Yes', closet: 'Walk-in' }] })), [true]);
});
