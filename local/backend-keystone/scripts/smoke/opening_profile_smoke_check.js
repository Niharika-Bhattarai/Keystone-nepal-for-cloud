'use strict';

const path = require('node:path');

const planHandler = require(path.resolve(__dirname, '../../api/plan'));

const BASE_SURVEY = Object.freeze({
  location: '',
  totalArea: '2400',
  stories: '2 Stories',
  bedrooms: '3 Bed',
  bathrooms: '3 Bath',
  privateBaths: '1',
  bedroomConfigs: null,
  shape: 'Rectangular',
  garage: '1 Car Garage',
  materials: 'Craftsman (Wood & Stone)',
  openConcept: 'Open Concept (Combined)',
  masterLocation: 'Level 2 (Upper)',
  kitchenPlacement: 'Rear of House',
  features: '',
  frontFacing: 'South',
  lotContext: 'Suburban standard lot',
  laundryLocation: 'Level 1 (near garage/mud)',
  ceilingHeight: 'Standard (9 ft)',
  accessibilityNeeds: 'None',
  budgetTier: 'Mid ($200-300/sqft)',
  freeformWishes: '',
});

const DEFAULT_SMOKE_CASES = Object.freeze([
  {
    caseId: 'balanced_baseline',
    surveyData: {
      ...BASE_SURVEY,
      naturalLight: 'Balanced windows',
      indoorOutdoor: 'Moderate (some connection)',
      accessibilityNeeds: 'None',
      frontFacing: 'West',
    },
    expectedProfiles: {
      openingProfile: 'balanced',
      indoorOutdoorProfile: 'moderate',
      doorwayProfile: 'standard',
    },
  },
  {
    caseId: 'max_glazing_outdoor_wide',
    surveyData: {
      ...BASE_SURVEY,
      naturalLight: 'Maximum glazing',
      indoorOutdoor: 'Maximum (open to outdoors)',
      accessibilityNeeds: 'Wide doorways',
      frontFacing: 'West',
    },
    expectedProfiles: {
      openingProfile: 'maximum_glazing',
      indoorOutdoorProfile: 'maximum_outdoor',
      doorwayProfile: 'wide',
    },
  },
  {
    caseId: 'privacy_first_study',
    surveyData: {
      ...BASE_SURVEY,
      bedrooms: '2 Bed',
      bathrooms: '3 Bath',
      features: '1 Study',
      naturalLight: 'Privacy first (fewer windows)',
      indoorOutdoor: 'Moderate (some connection)',
      accessibilityNeeds: 'None',
      frontFacing: 'East',
    },
    expectedProfiles: {
      openingProfile: 'privacy_first',
      indoorOutdoorProfile: 'moderate',
      doorwayProfile: 'standard',
    },
  },
]);

function invokePlanViaHandler(payload) {
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
    Promise.resolve(planHandler(req, res)).catch(reject);
  });
}

function openingProfileLabel(value) {
  const profile = String(value || '').toLowerCase();
  if (profile === 'maximum_glazing') return 'MAXIMUM GLAZING';
  if (profile === 'privacy_first') return 'PRIVACY FIRST';
  return 'BALANCED';
}

function doorwayProfileLabel(value) {
  const profile = String(value || '').toLowerCase();
  if (profile === 'wide') return 'WIDE';
  return 'STANDARD';
}

function countFromPlanSpec(planSpec) {
  return (planSpec?.levels || []).reduce((acc, level) => {
    const windows = Array.isArray(level?.windows) ? level.windows.length : 0;
    const doors = Array.isArray(level?.doors) ? level.doors : [];
    const exteriorDoors = doors.filter((door) => String(door?.b) === '__exterior__').length;
    const wideDoors = doors.filter((door) => !door?.garageDoor && Number(door?.width || 0) >= 4).length;

    acc.windowCount += windows;
    acc.exteriorDoorCount += exteriorDoors;
    acc.wideDoorCount += wideDoors;
    return acc;
  }, {
    windowCount: 0,
    exteriorDoorCount: 0,
    wideDoorCount: 0,
  });
}

function validateSmokeResult(smokeResult) {
  const errors = [];
  const response = smokeResult?.response || {};
  const body = response.body || {};
  const expectedProfiles = smokeResult?.expectedProfiles || {};
  const diagnostics = body?.openingDiagnostics || {};
  const diagnosticsProfiles = diagnostics?.profiles || {};

  if (response.statusCode !== 200) errors.push(`Expected statusCode 200, got ${response.statusCode}`);
  if (body?.success !== true) errors.push('Expected success=true in response body');

  if (String(body?.engine?.generatorId || '') !== 'architect_v2') {
    errors.push(`Expected generatorId=architect_v2, got ${String(body?.engine?.generatorId || 'unknown')}`);
  }

  if (!diagnostics || !diagnostics.totals) {
    errors.push('Missing openingDiagnostics totals in API response');
  }

  const profileKeys = ['openingProfile', 'indoorOutdoorProfile', 'doorwayProfile'];
  for (const key of profileKeys) {
    if (expectedProfiles[key] && String(diagnosticsProfiles[key] || '') !== String(expectedProfiles[key])) {
      errors.push(`Profile mismatch for ${key}: expected=${expectedProfiles[key]} actual=${String(diagnosticsProfiles[key] || 'missing')}`);
    }
  }

  const svg = String(body?.svg || '');
  const expectedOpeningLabel = openingProfileLabel(expectedProfiles.openingProfile);
  const expectedDoorLabel = doorwayProfileLabel(expectedProfiles.doorwayProfile);
  if (!svg.includes(`OPENINGS: ${expectedOpeningLabel}`)) {
    errors.push(`Missing SVG opening annotation: OPENINGS: ${expectedOpeningLabel}`);
  }
  if (!svg.includes(`DOORWAYS: ${expectedDoorLabel}`)) {
    errors.push(`Missing SVG doorway annotation: DOORWAYS: ${expectedDoorLabel}`);
  }

  const computed = countFromPlanSpec(body?.planSpec);
  const totals = diagnostics?.totals || {};
  if (Number(totals.windowCount || 0) !== computed.windowCount) {
    errors.push(`windowCount mismatch: diagnostics=${Number(totals.windowCount || 0)} computed=${computed.windowCount}`);
  }
  if (Number(totals.exteriorDoorCount || 0) !== computed.exteriorDoorCount) {
    errors.push(`exteriorDoorCount mismatch: diagnostics=${Number(totals.exteriorDoorCount || 0)} computed=${computed.exteriorDoorCount}`);
  }
  if (Number(totals.wideDoorCount || 0) !== computed.wideDoorCount) {
    errors.push(`wideDoorCount mismatch: diagnostics=${Number(totals.wideDoorCount || 0)} computed=${computed.wideDoorCount}`);
  }

  return {
    caseId: smokeResult?.caseId || 'unknown_case',
    pass: errors.length === 0,
    errors,
    observed: {
      openingProfile: diagnosticsProfiles?.openingProfile || null,
      indoorOutdoorProfile: diagnosticsProfiles?.indoorOutdoorProfile || null,
      doorwayProfile: diagnosticsProfiles?.doorwayProfile || null,
      totals: {
        windowCount: Number(totals.windowCount || 0),
        exteriorDoorCount: Number(totals.exteriorDoorCount || 0),
        wideDoorCount: Number(totals.wideDoorCount || 0),
      },
    },
  };
}

async function runSmokeChecks(options = {}) {
  const invokePlan = typeof options.invokePlan === 'function' ? options.invokePlan : invokePlanViaHandler;
  const cases = Array.isArray(options.cases) && options.cases.length ? options.cases : DEFAULT_SMOKE_CASES;
  const results = [];

  for (const smokeCase of cases) {
    const payload = {
      surveyData: smokeCase.surveyData,
      chatHistory: [],
    };
    const response = await invokePlan(payload);
    const validation = validateSmokeResult({
      caseId: smokeCase.caseId,
      expectedProfiles: smokeCase.expectedProfiles,
      response,
    });
    results.push(validation);
  }

  const failures = results.filter((result) => !result.pass);
  return {
    pass: failures.length === 0,
    results,
    failures,
  };
}

function printCliSummary(summary) {
  console.log('\nOpening-profile smoke check summary');
  console.log('===================================');
  for (const result of summary.results || []) {
    const status = result.pass ? 'PASS' : 'FAIL';
    console.log(`${status} ${result.caseId}`);
    if (result.pass) {
      const totals = result.observed?.totals || {};
      console.log(`  profiles: ${result.observed?.openingProfile} / ${result.observed?.indoorOutdoorProfile} / ${result.observed?.doorwayProfile}`);
      console.log(`  totals: windows=${totals.windowCount}, exteriorDoors=${totals.exteriorDoorCount}, wideDoors=${totals.wideDoorCount}`);
      continue;
    }
    for (const error of result.errors || []) {
      console.log(`  - ${error}`);
    }
  }
  console.log('\nResult:', summary.pass ? 'PASS' : 'FAIL');
}

async function main() {
  try {
    const summary = await runSmokeChecks();
    printCliSummary(summary);
    process.exitCode = summary.pass ? 0 : 1;
  } catch (error) {
    console.error('Opening-profile smoke check failed with an unhandled error.');
    console.error(error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  DEFAULT_SMOKE_CASES,
  runSmokeChecks,
  validateSmokeResult,
  countFromPlanSpec,
};
