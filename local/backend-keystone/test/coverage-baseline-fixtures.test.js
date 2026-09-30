'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const baseline = require('./fixtures/coverage/baseline-20260924.json');
const gaps = require('./fixtures/coverage/known-gaps.json');
const { structureCases } = require('../scripts/benchmark/generation-coverage');
test('historical structural inputs retain their identity and exact grid hash', () => {
  const inputs = baseline.structure.map(r => r.survey);
  assert.equal(inputs.length, 96);
  assert.deepEqual(inputs, structureCases());
  assert.equal(createHash('sha256').update(JSON.stringify(inputs)).digest('hex'), baseline.gridSha256);
  assert.equal(baseline.structure.filter(r => r.observed.valid).length, 56);
  assert.equal(baseline.structure.filter(r => r.observed.threeDistinct).length, 45);
});
test('survey history and named gaps are self-contained and complete', () => {
  assert.equal(baseline.survey.length, 27);
  assert.equal(baseline.survey.filter(r => r.observed.valid).length, 23);
  assert.equal(gaps.cases.length, 9);
  assert.equal(new Set(gaps.cases.map(r => r.id)).size, 9);
  for (const row of gaps.cases) {
    const source = [...baseline.structure, ...baseline.survey].find(r => r.id === (row.sourceId || row.id));
    assert.deepEqual(row.survey, source.survey);
    assert.deepEqual(row.observed, source.observed);
  }
});
