'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/plan');
const {
  runSmokeChecks,
  validateSmokeResult,
} = require('../scripts/smoke/opening_profile_smoke_check');

function invokePlan(payload) {
  return new Promise((resolve, reject) => {
    const req = {
      method: 'POST',
      body: payload,
      headers: {},
    };

    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body,
        });
        return this;
      },
      send(body) {
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body,
        });
        return this;
      },
    };

    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('opening diagnostics smoke checks pass for key profile briefs', async () => {
  const result = await runSmokeChecks({ invokePlan });
  assert.equal(result.pass, true, JSON.stringify(result.failures, null, 2));
  assert.ok(Array.isArray(result.results) && result.results.length >= 3, 'Expected at least 3 smoke-check cases');
});

test('validateSmokeResult catches svg annotation/profile mismatch', () => {
  const fake = {
    caseId: 'fake-max',
    expectedProfiles: {
      openingProfile: 'maximum_glazing',
      indoorOutdoorProfile: 'maximum_outdoor',
      doorwayProfile: 'wide',
    },
    response: {
      statusCode: 200,
      body: {
        success: true,
        svg: 'OPENINGS: BALANCED\nDOORWAYS: STANDARD',
        openingDiagnostics: {
          profiles: {
            openingProfile: 'maximum_glazing',
            indoorOutdoorProfile: 'maximum_outdoor',
            doorwayProfile: 'wide',
          },
          levels: [{ level: 1, windowCount: 4, exteriorDoorCount: 2, wideDoorCount: 1 }],
          totals: { windowCount: 4, exteriorDoorCount: 2, wideDoorCount: 1 },
        },
        planSpec: {
          levels: [{ windows: [{}, {}, {}, {}], doors: [{ b: '__exterior__', width: 4 }, { b: '__exterior__', width: 3 }] }],
        },
      },
    },
  };

  const validation = validateSmokeResult(fake);
  assert.equal(validation.pass, false);
  assert.ok(
    validation.errors.some((error) => String(error).includes('OPENINGS: MAXIMUM GLAZING')),
    `Expected mismatch error to mention opening annotation. errors=${JSON.stringify(validation.errors)}`
  );
});
