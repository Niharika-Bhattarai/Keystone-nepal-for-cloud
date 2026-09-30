'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateSurvey } = require('../lib/surveyMigration');
const { base } = require('../scripts/benchmark/generation-coverage');
const configs = [
  { privateBath: 'No', closet: 'Standard' },
  { privateBath: 'Yes', closet: 'Walk-in' },
  { privateBath: 'No', closet: 'Standard' },
];
test('migration retains exact selected bedroom identity, primary No and closet type without mutation', () => {
  const input = { ...base, bedroomConfigs: configs };
  const original = structuredClone(input);
  const result = migrateSurvey(input);
  assert.deepEqual(input, original);
  assert.deepEqual(result.ambiguities, []);
  assert.deepEqual(result.survey.bedroomProgram.map(b => b.programId), ['primary', 'bedroom_2', 'bedroom_3']);
  assert.equal(result.survey.bedroomProgram[0].privateBath, false);
  assert.equal(result.survey.bedroomProgram[1].closet, 'walk_in');
  assert.equal(result.survey.privateBathCount, 1);
  assert.deepEqual(migrateSurvey(result.survey).survey, result.survey);
});
test('unversioned contradictory bathroom serializations report ambiguity', () => {
  const result = migrateSurvey({ ...base, privateBaths: '2', bedroomConfigs: configs.map(c => ({ ...c, privateBath: 'Yes' })) });
  assert.equal(result.ambiguities[0].code, 'BRIEF_AMBIGUOUS');
  assert.equal(result.original.privateBaths, '2');
});
test('named secondary and total adapters preserve distinct meanings', () => {
  const input = { ...base, privateBaths: '1' };
  assert.equal(migrateSurvey(input, 'legacy-total-v1').survey.privateBathCount, 1);
  assert.equal(migrateSurvey(input, 'legacy-secondary-v1').survey.privateBathCount, 2);
  const secondary = migrateSurvey(input, 'legacy-secondary-v1');
  assert.deepEqual(migrateSurvey(secondary.survey).ambiguities, []);
  assert.deepEqual(migrateSurvey(secondary.survey).survey, secondary.survey);
});
test('legacy null bedroom configurations remain explicit unspecified closets, with idempotent migration', () => {
  const first = migrateSurvey({ ...base, bedroomConfigs: null });
  assert.ok(first.survey.bedroomProgram.every(b => b.closet === null));
  assert.deepEqual(migrateSurvey(first.survey).survey, first.survey);
  const missing = migrateSurvey({ bedrooms: '1 Bed', bathrooms: '1 Bath' });
  assert.deepEqual(migrateSurvey(missing.survey).survey, missing.survey);
});
test('new guest suite consumes bath budget, legacy guest room does not gain a bathroom on restore', () => {
  const input = { ...base, bathrooms: '1 Bath', features: '1 Guest Suite' };
  assert.deepEqual(migrateSurvey(input, 1).ambiguities, []);
  assert.equal(migrateSurvey(input, 2).ambiguities[0].code, 'PROGRAM_CONFLICT');
  const legacy = migrateSurvey(input, 1).survey;
  assert.equal(migrateSurvey(legacy).survey.guestSuiteSemantics, 'legacy_guest_room_only');
});
test('only known old picker versions collapse the office alias; explicit counts and gaming/playroom survive', () => {
  const input = { ...base, features: '1 Study, 1 Home Office, 1 Gaming Room, 1 Playroom' };
  assert.equal(migrateSurvey(input, 1).survey.features, '1 Study, 1 Gaming Room, 1 Playroom');
  assert.equal(migrateSurvey(input, 2).survey.features, input.features);
  assert.equal(migrateSurvey({ ...base, features: '2 Study' }, 1).survey.features, '2 Study');
});
test('one shared bath and five attached baths retain exact counts; new contradictions are conflicts', () => {
  const one = migrateSurvey({ bedrooms: '1 Bed', bathrooms: '1 Bath', privateBaths: '0', bedroomConfigs: [configs[0]] }, 2);
  assert.equal(one.survey.privateBathCount, 0);
  assert.deepEqual(one.ambiguities, []);
  const five = migrateSurvey({ bedrooms: '5 Bed', bathrooms: '5 Bath', privateBaths: '5', bedroomConfigs: Array.from({ length: 5 }, () => configs[1]) }, 2);
  assert.equal(five.survey.privateBathCount, 5);
  assert.deepEqual(five.ambiguities, []);
  assert.equal(migrateSurvey({ ...base, bedroomConfigs: configs, privateBathCount: 2 }, 2).ambiguities[0].code, 'PROGRAM_CONFLICT');
});
