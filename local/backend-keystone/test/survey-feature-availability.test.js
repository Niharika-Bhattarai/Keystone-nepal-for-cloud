'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightSurvey } = require('../lib/surveyPreflight');
const { base } = require('../scripts/benchmark/generation-coverage');

const choice = (result, value) => result.featureOptions.find(option => option.value === value);

test('feature choices prevent unsupported additions and always allow removal', () => {
  const result = preflightSurvey({ ...base, features: '1 Study' });
  assert.equal(choice(result, 'Study').allowed, true);
  assert.equal(choice(result, 'Study').selected, true);
  assert.equal(choice(result, 'Gym').allowed, false);
  assert.equal(choice(result, 'Library').allowed, false);
  assert.equal(choice(result, 'Gym').blockers[0].code, 'study_gym_combo_out_of_scope');
});

test('supported two-room choices unlock as the brief gains space', () => {
  const result = preflightSurvey({ ...base, totalArea: '3200', features: '1 Study' });
  assert.equal(choice(result, 'Gym').allowed, true);
  assert.equal(choice(result, 'Library').allowed, true);
  const pair = preflightSurvey({ ...base, totalArea: '3200', features: '1 Study, 1 Gym' });
  assert.equal(pair.supported, true);
  assert.equal(choice(pair, 'Library').allowed, false);
  assert.deepEqual(pair.featureBlockers, []);
});

test('saved unsupported combinations have blocking reasons independent of legacy policy', () => {
  const result = preflightSurvey({ ...base, features: '1 Study, 1 Gym' });
  assert.ok(result.featureBlockers.some(blocker => blocker.code === 'study_gym_combo_out_of_scope'));
  assert.equal(choice(result, 'Study').allowed, true);
  assert.equal(choice(result, 'Gym').allowed, true);
});

test('legacy-only house restrictions are not misreported as feature restrictions', () => {
  // A two-storey five-bedroom house needs 3,000 sq ft: a house limit, not a feature one.
  const result = preflightSurvey({ ...base, bedrooms: '5 Bed', totalArea: '2000', features: '' });
  assert.equal(result.supported, false);
  assert.deepEqual(result.featureBlockers, []);
});

test('special room availability follows single-storey garage restrictions', () => {
  const result = preflightSurvey({ ...base, stories: '1 Story', features: '' });
  assert.ok(result.featureOptions.every(option => !option.allowed));
});
