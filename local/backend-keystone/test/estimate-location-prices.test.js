'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateLocation, parsePrices, findPrice } = require('../lib/estimate/unitPrices');
const { buildEstimate } = require('../lib/estimate/buildEstimate');
const fixture = require('./fixtures/model3d-plan.json');
test('location preserves leading ZIP zeros and validates US inputs', () => {
  assert.equal(estimateLocation({ zipCode: '02108-1234', city: 'Boston', state: 'ma' }).zipCode, '02108-1234');
  for (const zipCode of ['', '1234', '123456', 'ABCDE']) assert.throws(() => estimateLocation({ zipCode, city: 'Boston', state: 'MA' }), /required/);
  assert.throws(() => estimateLocation({ zipCode: '02108', city: 'Boston', state: 'ZZ' }), /required/);
});
test('unit-price matching selects ZIP before state before national and rejects invalid CSV', () => {
  const header = 'key,unit,material,labor,scope,region,date,source,status\n';
  const rows = parsePrices(header + ['x,sqft,1,2,national,US,2026-09-27,test,uncalibrated', 'x,sqft,3,4,state,MA,2026-09-27,test,uncalibrated', 'x,sqft,5,6,zip,02108,2026-09-27,test,uncalibrated'].join('\n'));
  assert.equal(findPrice('x', { zipCode: '02108-1234', state: 'MA' }, rows).material, 5);
  assert.equal(findPrice('x', { zipCode: '99999', state: 'MA' }, rows).material, 3);
  assert.equal(findPrice('x', { state: 'TX' }, rows).material, 1);
  assert.throws(() => parsePrices(header + 'x,sqft,-1,2,national,US,2026-09-27,test,uncalibrated'), /Invalid price/);
});
test('location recalculation prices identical quantities and publishes allowance provenance', () => {
  const calculate = (state, zipCode) => buildEstimate(fixture, { surveyData: { estimateLocation: { state, zipCode, city: 'Test city' } } });
  const tx = calculate('TX', '75001'), ca = calculate('CA', '94103');
  assert.deepEqual(tx.takeoff, ca.takeoff);
  assert.notEqual(tx.costRange.total.target, ca.costRange.total.target);
  assert.equal(ca.location.zipCode, '94103');
  assert.ok(ca.costRange.detailLineItems.every(i => i.rateSource.status === 'uncalibrated'));
  assert.equal(findPrice('exterior_doors').material, 1250);
});

test('estimate API requires location and rebuilds rather than trusting an embedded estimate', () => {
  const handler = require('../api/estimate');
  const call = body => {
    const result = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    handler({ body }, result);
    return result;
  };
  assert.equal(call({ planSpec: fixture }).statusCode, 400);
  const result = call({ planSpec: { ...fixture, estimate: { costRange: { total: { target: -123 } } } }, surveyData: { estimateLocation: { zipCode: '02108', city: 'Boston', state: 'MA' } } });
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.estimate.costRange.total.target > 0);
  assert.equal(result.body.estimate.location.city, 'Boston');
});
