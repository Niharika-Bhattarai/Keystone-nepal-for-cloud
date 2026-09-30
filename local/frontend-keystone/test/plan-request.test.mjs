import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_DEADLINE_MS, PLAN_OFFLINE, PLAN_SLOW, planFailureMessage } from '../src/lib/planRequest.js';

// C7: every plan failure says what happened and what to do, in the user's terms.
test('plan failures are specific and actionable, never a bare status code', () => {
  assert.equal(PLAN_DEADLINE_MS, 120_000);
  for (const status of [400, 404, 413, 422, 429, 500, 502, 503]) {
    const text = planFailureMessage(status);
    assert.doesNotMatch(text, /status|\b\d{3}\b|error|failed/i, `${status}: ${text}`);
    assert.match(text, /try again/i, `${status} says what to do`);
  }
  assert.match(planFailureMessage(429), /wait a minute/i);
  assert.match(planFailureMessage(503), /brief is unchanged/i);
  for (const text of [PLAN_SLOW, PLAN_OFFLINE]) assert.match(text, /brief is unchanged/i);
});
