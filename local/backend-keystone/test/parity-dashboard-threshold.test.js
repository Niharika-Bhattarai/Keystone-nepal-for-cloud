'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseThresholdArg } = require('../scripts/parityDashboard');

test('parseThresholdArg defaults to 90 when omitted', () => {
  assert.equal(parseThresholdArg([]), 90);
});

test('parseThresholdArg accepts --threshold <value>', () => {
  assert.equal(parseThresholdArg(['--threshold', '95']), 95);
});

test('parseThresholdArg accepts --threshold=<value>', () => {
  assert.equal(parseThresholdArg(['--json', '--threshold=88.5']), 88.5);
});

test('parseThresholdArg rejects missing value', () => {
  assert.throws(() => parseThresholdArg(['--threshold']), /requires a numeric value/i);
});

test('parseThresholdArg rejects out-of-range values', () => {
  assert.throws(() => parseThresholdArg(['--threshold', '-1']), /between 0 and 100/i);
  assert.throws(() => parseThresholdArg(['--threshold', '101']), /between 0 and 100/i);
});

