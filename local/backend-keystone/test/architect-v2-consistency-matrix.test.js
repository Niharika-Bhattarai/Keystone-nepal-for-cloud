'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/plan');

function invokePlan(payload) {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', body: payload, headers: {} };
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
        resolve({ statusCode: this.statusCode, headers: this.headers, body });
        return this;
      },
      send(body) {
        resolve({ statusCode: this.statusCode, headers: this.headers, body });
        return this;
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function makePayload({
  area,
  bedrooms,
  bathrooms,
  garage,
  features = '',
  privateBaths = '1',
  bedroomConfigs = null,
  frontFacing = 'South',
  shape = 'Rectangular',
  lotContext = 'Suburban standard lot',
}) {
  return {
    surveyData: {
      location: '',
      totalArea: String(area),
      stories: '2 Stories',
      bedrooms,
      bathrooms,
      privateBaths: String(privateBaths),
      bedroomConfigs,
      shape,
      garage,
      materials: 'Craftsman (Wood & Stone)',
      openConcept: 'Open Concept (Combined)',
      masterLocation: 'Level 2 (Upper)',
      kitchenPlacement: 'Rear of House',
      features,
      frontFacing,
      lotContext,
      laundryLocation: 'Level 1 (near garage/mud)',
      ceilingHeight: 'Standard (9 ft)',
      indoorOutdoor: 'Moderate (some connection)',
      naturalLight: 'Balanced windows',
      accessibilityNeeds: 'None',
      budgetTier: 'Mid ($200-300/sqft)',
      freeformWishes: '',
    },
    chatHistory: [],
  };
}

test('architect_v2 keeps the 1800/2100 family-feature matrix on v2 with zero fallback mismatch', async () => {
  const areas = ['1800', '2100'];
  const bedrooms = ['2 Bed', '3 Bed'];
  const bathrooms = ['2 Bath', '3 Bath'];
  const garages = ['1 Car Garage', 'No Garage'];
  const features = ['', '1 Study', '1 Library', '1 Gym'];

  const failures = [];
  let checked = 0;

  for (const area of areas) {
    for (const bed of bedrooms) {
      for (const bath of bathrooms) {
        for (const garage of garages) {
          for (const feature of features) {
            checked += 1;
            const result = await invokePlan(makePayload({
              area,
              bedrooms: bed,
              bathrooms: bath,
              garage,
              features: feature,
            }));
            const engine = result.body?.engine || {};
            const ok =
              result.statusCode === 200 &&
              result.body?.success === true &&
              String(engine.supportTier) === 'wave1' &&
              String(engine.generatorId) === 'architect_v2' &&
              !Boolean(engine.fallbackUsed);

            if (!ok) {
              failures.push({
                area,
                bed,
                bath,
                garage,
                feature: feature || '(none)',
                statusCode: result.statusCode,
                success: result.body?.success,
                generatorId: engine.generatorId,
                fallbackUsed: engine.fallbackUsed,
                supportTier: engine.supportTier,
                housePattern: engine.housePattern,
                topologyFailures: engine.topologyFailures || [],
                geometryFailures: engine.geometryFailures || [],
              });
            }
          }
        }
      }
    }
  }

  assert.equal(checked, 64);
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});

test('architect_v2 keeps the 2400-4200 garage/no-garage family-feature matrix on v2 with zero fallback mismatch', async () => {
  const areas = ['2400', '2700', '3000', '3200', '3600', '4200'];
  const bedrooms = ['2 Bed', '3 Bed'];
  const bathrooms = ['2 Bath', '3 Bath'];
  const garages = ['1 Car Garage', 'No Garage'];
  const features = ['', '1 Study', '1 Library', '1 Gym'];

  const failures = [];
  let checked = 0;

  for (const area of areas) {
    for (const bed of bedrooms) {
      for (const bath of bathrooms) {
        for (const garage of garages) {
          for (const feature of features) {
            checked += 1;
            const result = await invokePlan(makePayload({
              area,
              bedrooms: bed,
              bathrooms: bath,
              garage,
              features: feature,
            }));
            const engine = result.body?.engine || {};
            const ok =
              result.statusCode === 200 &&
              result.body?.success === true &&
              String(engine.supportTier) === 'wave1' &&
              String(engine.generatorId) === 'architect_v2' &&
              !Boolean(engine.fallbackUsed);

            if (!ok) {
              failures.push({
                area,
                bed,
                bath,
                garage,
                feature: feature || '(none)',
                statusCode: result.statusCode,
                success: result.body?.success,
                generatorId: engine.generatorId,
                fallbackUsed: engine.fallbackUsed,
                supportTier: engine.supportTier,
                housePattern: engine.housePattern,
                topologyFailures: engine.topologyFailures || [],
                geometryFailures: engine.geometryFailures || [],
              });
            }
          }
        }
      }
    }
  }

  assert.equal(checked, 192);
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});

test('architect_v2 keeps private-bath and facing edge configurations on v2 without fallback mismatch', async () => {
  const areas = ['2400', '3200'];
  const garages = ['1 Car Garage', 'No Garage'];
  const features = ['', '1 Study', '1 Library', '1 Gym'];
  const facings = ['South', 'West', 'East', 'North'];
  const privateBathModes = [
    {
      tag: 'pb1_default',
      privateBaths: '1',
      bedroomConfigs: null,
    },
    {
      tag: 'pb2_with_two_yes_configs',
      privateBaths: '2',
      bedroomConfigs: [
        { privateBath: 'Yes', closet: 'Walk-in' },
        { privateBath: 'No', closet: 'Standard' },
        { privateBath: 'Yes', closet: 'Standard' },
      ],
    },
  ];

  const failures = [];
  let checked = 0;

  for (const area of areas) {
    for (const garage of garages) {
      for (const feature of features) {
        for (const frontFacing of facings) {
          for (const mode of privateBathModes) {
            checked += 1;
            const result = await invokePlan(makePayload({
              area,
              bedrooms: '3 Bed',
              bathrooms: '3 Bath',
              garage,
              features: feature,
              privateBaths: mode.privateBaths,
              bedroomConfigs: mode.bedroomConfigs,
              frontFacing,
            }));
            const engine = result.body?.engine || {};
            const ok =
              result.statusCode === 200 &&
              result.body?.success === true &&
              String(engine.supportTier) === 'wave1' &&
              String(engine.generatorId) === 'architect_v2' &&
              !Boolean(engine.fallbackUsed);

            if (!ok) {
              failures.push({
                area,
                garage,
                feature: feature || '(none)',
                frontFacing,
                privateBathMode: mode.tag,
                statusCode: result.statusCode,
                success: result.body?.success,
                generatorId: engine.generatorId,
                fallbackUsed: engine.fallbackUsed,
                supportTier: engine.supportTier,
                housePattern: engine.housePattern,
                topologyFailures: engine.topologyFailures || [],
                geometryFailures: engine.geometryFailures || [],
              });
            }
          }
        }
      }
    }
  }

  assert.equal(checked, 128);
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});

test('architect_v2 supports constrained study+gym combo families on v2 (3-bed/3-bath, 3000+ sqft, two-story)', async () => {
  const areas = ['3000', '3200', '3600', '4200'];
  const garages = ['1 Car Garage', 'No Garage'];
  const failures = [];
  let checked = 0;

  for (const area of areas) {
    for (const garage of garages) {
      checked += 1;
      const result = await invokePlan(makePayload({
        area,
        bedrooms: '3 Bed',
        bathrooms: '3 Bath',
        garage,
        features: '1 Study, 1 Gym',
      }));
      const engine = result.body?.engine || {};
      const planSpec = result.body?.planSpec || {};
      const level1Rooms = (planSpec?.levels || []).find((level) => Number(level?.level) === 1)?.rooms || [];
      const level2Rooms = (planSpec?.levels || []).find((level) => Number(level?.level) === 2)?.rooms || [];
      const gymCount = (planSpec?.levels || []).reduce((sum, level) => sum + (level?.rooms || []).filter((room) => String(room?.type) === 'gym').length, 0);
      const studyCount = (planSpec?.levels || []).reduce((sum, level) => sum + (level?.rooms || []).filter((room) => String(room?.type) === 'study').length, 0);
      const gymOnLevel1 = level1Rooms.filter((room) => String(room?.type) === 'gym').length;
      const studyOnLevel2 = level2Rooms.filter((room) => String(room?.type) === 'study').length;
      const ok =
        result.statusCode === 200 &&
        result.body?.success === true &&
        String(engine.supportTier) === 'wave1' &&
        String(engine.generatorId) === 'architect_v2' &&
        !Boolean(engine.fallbackUsed) &&
        gymCount >= 1 &&
        studyCount >= 1 &&
        gymOnLevel1 >= 1 &&
        studyOnLevel2 >= 1;

      if (!ok) {
        failures.push({
          area,
          garage,
          statusCode: result.statusCode,
          success: result.body?.success,
          generatorId: engine.generatorId,
          fallbackUsed: engine.fallbackUsed,
          supportTier: engine.supportTier,
          housePattern: engine.housePattern,
          gymCount,
          studyCount,
          gymOnLevel1,
          studyOnLevel2,
          topologyFailures: engine.topologyFailures || [],
          geometryFailures: engine.geometryFailures || [],
        });
      }
    }
  }

  assert.equal(checked, 8);
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});

test('architect_v2 supports constrained library+gym combo families on v2 (3-bed/3-bath, 3200+ sqft, two-story)', async () => {
  const areas = ['3200', '3600', '4200'];
  const garages = ['1 Car Garage', 'No Garage'];
  const failures = [];
  let checked = 0;

  for (const area of areas) {
    for (const garage of garages) {
      checked += 1;
      const result = await invokePlan(makePayload({
        area,
        bedrooms: '3 Bed',
        bathrooms: '3 Bath',
        garage,
        features: '1 Library, 1 Gym',
      }));
      const engine = result.body?.engine || {};
      const planSpec = result.body?.planSpec || {};
      const level1Rooms = (planSpec?.levels || []).find((level) => Number(level?.level) === 1)?.rooms || [];
      const level2Rooms = (planSpec?.levels || []).find((level) => Number(level?.level) === 2)?.rooms || [];
      const gymCount = (planSpec?.levels || []).reduce((sum, level) => sum + (level?.rooms || []).filter((room) => String(room?.type) === 'gym').length, 0);
      const libraryCount = (planSpec?.levels || []).reduce((sum, level) => sum + (level?.rooms || []).filter((room) => String(room?.type) === 'library').length, 0);
      const gymOnLevel1 = level1Rooms.filter((room) => String(room?.type) === 'gym').length;
      const libraryOnLevel2 = level2Rooms.filter((room) => String(room?.type) === 'library').length;
      const ok =
        result.statusCode === 200 &&
        result.body?.success === true &&
        String(engine.supportTier) === 'wave1' &&
        String(engine.generatorId) === 'architect_v2' &&
        !Boolean(engine.fallbackUsed) &&
        gymCount >= 1 &&
        libraryCount >= 1 &&
        gymOnLevel1 >= 1 &&
        libraryOnLevel2 >= 1;

      if (!ok) {
        failures.push({
          area,
          garage,
          statusCode: result.statusCode,
          success: result.body?.success,
          generatorId: engine.generatorId,
          fallbackUsed: engine.fallbackUsed,
          supportTier: engine.supportTier,
          housePattern: engine.housePattern,
          gymCount,
          libraryCount,
          gymOnLevel1,
          libraryOnLevel2,
          topologyFailures: engine.topologyFailures || [],
          geometryFailures: engine.geometryFailures || [],
        });
      }
    }
  }

  assert.equal(checked, 6);
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});

test('architect_v2 keeps uncommon multi-feature and unsupported-feature briefs explicit on legacy', async () => {
  const legacyOnlyCases = [
    {
      area: '2400',
      bedrooms: '3 Bed',
      bathrooms: '3 Bath',
      garage: '1 Car Garage',
      features: '1 Study, 1 Gym',
    },
    {
      area: '3000',
      bedrooms: '3 Bed',
      bathrooms: '3 Bath',
      garage: 'No Garage',
      features: '1 Library, 1 Gym',
    },
    {
      area: '3200',
      bedrooms: '3 Bed',
      bathrooms: '3 Bath',
      garage: '1 Car Garage',
      features: '1 Observatory',
    },
    {
      area: '3200',
      bedrooms: '3 Bed',
      bathrooms: '3 Bath',
      garage: 'No Garage',
      features: '1 Movie Room, 1 Gym',
    },
  ];

  for (const candidate of legacyOnlyCases) {
    const result = await invokePlan(makePayload(candidate));
    if (candidate.features === '1 Observatory') {
      // Unknown names now fail the input contract before engine routing.
      assert.equal(result.statusCode, 422);
      assert.equal(result.body.code, 'BRIEF_INVALID');
      assert.ok(result.body.diagnostics.blockers.some(b => b.field === 'features'));
      continue;
    }
    const engine = result.body?.engine || {};
    assert.ok(
      result.statusCode === 200 || result.statusCode === 422,
      `Expected 200/422 for ${JSON.stringify(candidate)}, got ${result.statusCode}`
    );
    assert.equal(String(engine.generatorId), 'legacy', JSON.stringify({ candidate, body: result.body }, null, 2));
    assert.equal(Boolean(engine.fallbackUsed), false, JSON.stringify({ candidate, body: result.body }, null, 2));
    assert.ok(
      String(engine.supportTier) === 'unsupported' || String(engine.supportTier) === 'legacy_only',
      `Expected legacy support tier for ${JSON.stringify(candidate)}, got ${engine.supportTier}`
    );
  }
});

test('architect_v2 low-area feasibility guards keep known impossible tiny families explicit on legacy', async () => {
  const guardedCases = [
    { area: '1200', bedrooms: '2 Bed', bathrooms: '2 Bath', garage: '1 Car Garage' },
    { area: '1200', bedrooms: '3 Bed', bathrooms: '3 Bath', garage: '1 Car Garage' },
    { area: '1200', bedrooms: '2 Bed', bathrooms: '2 Bath', garage: 'No Garage' },
    { area: '1200', bedrooms: '3 Bed', bathrooms: '3 Bath', garage: 'No Garage' },
    { area: '1500', bedrooms: '2 Bed', bathrooms: '2 Bath', garage: '1 Car Garage' },
    { area: '1500', bedrooms: '3 Bed', bathrooms: '3 Bath', garage: '1 Car Garage' },
    { area: '1500', bedrooms: '3 Bed', bathrooms: '3 Bath', garage: 'No Garage' },
  ];

  for (const candidate of guardedCases) {
    const result = await invokePlan(makePayload(candidate));
    const engine = result.body?.engine || {};
    assert.ok(
      result.statusCode === 200 || result.statusCode === 422,
      `Expected 200/422 for ${JSON.stringify(candidate)}, got ${result.statusCode}`
    );
    if (result.statusCode === 200) {
      assert.equal(result.body?.success, true, JSON.stringify({ candidate, body: result.body }, null, 2));
    } else {
      assert.equal(result.body?.success, false, JSON.stringify({ candidate, body: result.body }, null, 2));
    }
    assert.equal(String(engine.generatorId), 'legacy');
    assert.equal(Boolean(engine.fallbackUsed), false);
    assert.ok(
      String(engine.supportTier) === 'unsupported' || String(engine.supportTier) === 'legacy_only',
      `Expected legacy support tier for ${JSON.stringify(candidate)}, got ${engine.supportTier}`
    );
  }
});
