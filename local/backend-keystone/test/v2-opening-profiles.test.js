'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/plan');

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

function totalWindowCount(planSpec) {
  return (planSpec?.levels || []).reduce((sum, level) => {
    return sum + (Array.isArray(level?.windows) ? level.windows.length : 0);
  }, 0);
}

function totalExteriorDoorCount(planSpec) {
  return (planSpec?.levels || []).reduce((sum, level) => {
    return sum + (level?.doors || []).filter((door) => String(door?.b) === '__exterior__').length;
  }, 0);
}

function widenedNonGarageDoorCount(planSpec) {
  return (planSpec?.levels || []).reduce((sum, level) => {
    return sum + (level?.doors || []).filter((door) => {
      const width = Number(door?.width || 0);
      return !door?.garageDoor && width >= 4;
    }).length;
  }, 0);
}

function edgeForFacing(frontFacing) {
  const facing = String(frontFacing || 'South').toLowerCase();
  if (facing.includes('north')) return 'top';
  if (facing.includes('south')) return 'bottom';
  if (facing.includes('east')) return 'right';
  if (facing.includes('west')) return 'left';
  return 'bottom';
}

function openingEdge(opening, levelWidth, levelHeight) {
  if (!opening) return null;
  if (String(opening?.dir) === 'horizontal') {
    if (Number(opening?.y) === 0) return 'top';
    if (Number(opening?.y) === Number(levelHeight)) return 'bottom';
  } else if (String(opening?.dir) === 'vertical') {
    if (Number(opening?.x) === 0) return 'left';
    if (Number(opening?.x) === Number(levelWidth)) return 'right';
  }
  return null;
}

function frontEdgeWindowCount(planSpec, frontFacing) {
  const frontEdge = edgeForFacing(frontFacing);
  return (planSpec?.levels || []).reduce((sum, level) => {
    const levelWindows = (level?.windows || []).filter((window) =>
      openingEdge(window, level?.width, level?.height) === frontEdge
    ).length;
    return sum + levelWindows;
  }, 0);
}

const baseSurvey = {
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
};

test('opening profiles materially change v2 window counts for the same brief', async () => {
  const privacy = await invokePlan({
    surveyData: {
      ...baseSurvey,
      naturalLight: 'Privacy first (fewer windows)',
      indoorOutdoor: 'Moderate (some connection)',
    },
    chatHistory: [],
  });
  const balanced = await invokePlan({
    surveyData: {
      ...baseSurvey,
      naturalLight: 'Balanced windows',
      indoorOutdoor: 'Moderate (some connection)',
    },
    chatHistory: [],
  });
  const maximum = await invokePlan({
    surveyData: {
      ...baseSurvey,
      naturalLight: 'Maximum glazing',
      indoorOutdoor: 'Moderate (some connection)',
    },
    chatHistory: [],
  });

  for (const result of [privacy, balanced, maximum]) {
    assert.equal(result.statusCode, 200);
    assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
    assert.equal(result.body?.engine?.generatorId, 'architect_v2');
    assert.equal(result.body?.engine?.fallbackUsed, false);
  }

  const privacyWindows = totalWindowCount(privacy.body?.planSpec);
  const balancedWindows = totalWindowCount(balanced.body?.planSpec);
  const maximumWindows = totalWindowCount(maximum.body?.planSpec);

  assert.ok(
    privacyWindows < balancedWindows,
    `Expected privacy-first glazing to have fewer windows than balanced. privacy=${privacyWindows}, balanced=${balancedWindows}`
  );
  assert.ok(
    maximumWindows > balancedWindows,
    `Expected maximum-glazing profile to have more windows than balanced. maximum=${maximumWindows}, balanced=${balancedWindows}`
  );
});

test('maximum indoor-outdoor profile adds extra exterior openings', async () => {
  const moderate = await invokePlan({
    surveyData: {
      ...baseSurvey,
      naturalLight: 'Balanced windows',
      indoorOutdoor: 'Moderate (some connection)',
    },
    chatHistory: [],
  });
  const maximum = await invokePlan({
    surveyData: {
      ...baseSurvey,
      naturalLight: 'Balanced windows',
      indoorOutdoor: 'Maximum (open to outdoors)',
    },
    chatHistory: [],
  });

  assert.equal(moderate.statusCode, 200);
  assert.equal(maximum.statusCode, 200);
  assert.equal(moderate.body?.success, true, JSON.stringify(moderate.body, null, 2));
  assert.equal(maximum.body?.success, true, JSON.stringify(maximum.body, null, 2));
  assert.equal(moderate.body?.engine?.generatorId, 'architect_v2');
  assert.equal(maximum.body?.engine?.generatorId, 'architect_v2');
  assert.equal(moderate.body?.engine?.fallbackUsed, false);
  assert.equal(maximum.body?.engine?.fallbackUsed, false);

  const moderateExteriorDoors = totalExteriorDoorCount(moderate.body?.planSpec);
  const maximumExteriorDoors = totalExteriorDoorCount(maximum.body?.planSpec);
  assert.ok(
    maximumExteriorDoors > moderateExteriorDoors,
    `Expected max indoor-outdoor profile to add exterior openings. moderate=${moderateExteriorDoors}, maximum=${maximumExteriorDoors}`
  );
});

test('wide-door accessibility profile creates wider non-garage doors', async () => {
  const standard = await invokePlan({
    surveyData: {
      ...baseSurvey,
      naturalLight: 'Balanced windows',
      indoorOutdoor: 'Moderate (some connection)',
      accessibilityNeeds: 'None',
    },
    chatHistory: [],
  });
  const wide = await invokePlan({
    surveyData: {
      ...baseSurvey,
      naturalLight: 'Balanced windows',
      indoorOutdoor: 'Moderate (some connection)',
      accessibilityNeeds: 'Wide doorways',
    },
    chatHistory: [],
  });

  assert.equal(standard.statusCode, 200);
  assert.equal(wide.statusCode, 200);
  assert.equal(standard.body?.success, true, JSON.stringify(standard.body, null, 2));
  assert.equal(wide.body?.success, true, JSON.stringify(wide.body, null, 2));
  assert.equal(standard.body?.engine?.generatorId, 'architect_v2');
  assert.equal(wide.body?.engine?.generatorId, 'architect_v2');
  assert.equal(standard.body?.engine?.fallbackUsed, false);
  assert.equal(wide.body?.engine?.fallbackUsed, false);

  const standardWideDoors = widenedNonGarageDoorCount(standard.body?.planSpec);
  const wideDoors = widenedNonGarageDoorCount(wide.body?.planSpec);
  assert.ok(
    wideDoors > standardWideDoors,
    `Expected wide-door accessibility to increase widened non-garage doors. standard=${standardWideDoors}, wide=${wideDoors}`
  );
  assert.ok(wideDoors > 0, `Expected at least one widened non-garage door for wide-door profile, got ${wideDoors}`);
});

test('opening profile behavior remains monotonic across front-facing orientations', async () => {
  const orientations = ['South', 'North', 'East', 'West'];

  for (const frontFacing of orientations) {
    const privacy = await invokePlan({
      surveyData: {
        ...baseSurvey,
        frontFacing,
        naturalLight: 'Privacy first (fewer windows)',
        indoorOutdoor: 'Moderate (some connection)',
      },
      chatHistory: [],
    });
    const balanced = await invokePlan({
      surveyData: {
        ...baseSurvey,
        frontFacing,
        naturalLight: 'Balanced windows',
        indoorOutdoor: 'Moderate (some connection)',
      },
      chatHistory: [],
    });
    const maximum = await invokePlan({
      surveyData: {
        ...baseSurvey,
        frontFacing,
        naturalLight: 'Maximum glazing',
        indoorOutdoor: 'Moderate (some connection)',
      },
      chatHistory: [],
    });

    for (const result of [privacy, balanced, maximum]) {
      assert.equal(result.statusCode, 200);
      assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
      assert.equal(result.body?.engine?.generatorId, 'architect_v2');
      assert.equal(result.body?.engine?.fallbackUsed, false);
    }

    const privacyWindows = totalWindowCount(privacy.body?.planSpec);
    const balancedWindows = totalWindowCount(balanced.body?.planSpec);
    const maximumWindows = totalWindowCount(maximum.body?.planSpec);

    assert.ok(
      privacyWindows < balancedWindows,
      `Expected privacy-first windows < balanced for ${frontFacing}. privacy=${privacyWindows}, balanced=${balancedWindows}`
    );
    assert.ok(
      balancedWindows < maximumWindows,
      `Expected balanced windows < maximum for ${frontFacing}. balanced=${balancedWindows}, maximum=${maximumWindows}`
    );

    const privacyFrontWindows = frontEdgeWindowCount(privacy.body?.planSpec, frontFacing);
    const balancedFrontWindows = frontEdgeWindowCount(balanced.body?.planSpec, frontFacing);
    const maximumFrontWindows = frontEdgeWindowCount(maximum.body?.planSpec, frontFacing);

    assert.ok(
      privacyFrontWindows <= balancedFrontWindows,
      `Expected privacy-first front-edge windows <= balanced for ${frontFacing}. privacy=${privacyFrontWindows}, balanced=${balancedFrontWindows}`
    );
    assert.ok(
      balancedFrontWindows <= maximumFrontWindows,
      `Expected balanced front-edge windows <= maximum for ${frontFacing}. balanced=${balancedFrontWindows}, maximum=${maximumFrontWindows}`
    );
  }
});

test('opening profiles stay consistent across study and gym family variants', async () => {
  const familyCases = [
    { name: '2-bed-2-bath-study-garage', survey: { ...baseSurvey, bedrooms: '2 Bed', bathrooms: '2 Bath', garage: '1 Car Garage', features: '1 Study' } },
    { name: '2-bed-3-bath-study-garage', survey: { ...baseSurvey, bedrooms: '2 Bed', bathrooms: '3 Bath', garage: '1 Car Garage', features: '1 Study' } },
    { name: '3-bed-3-bath-gym-garage', survey: { ...baseSurvey, bedrooms: '3 Bed', bathrooms: '3 Bath', garage: '1 Car Garage', features: '1 Gym' } },
    { name: '3-bed-3-bath-gym-no-garage', survey: { ...baseSurvey, bedrooms: '3 Bed', bathrooms: '3 Bath', garage: 'No Garage', features: '1 Gym' } },
  ];

  for (const family of familyCases) {
    const privacy = await invokePlan({
      surveyData: {
        ...family.survey,
        naturalLight: 'Privacy first (fewer windows)',
        indoorOutdoor: 'Moderate (some connection)',
        accessibilityNeeds: 'None',
      },
      chatHistory: [],
    });
    const balanced = await invokePlan({
      surveyData: {
        ...family.survey,
        naturalLight: 'Balanced windows',
        indoorOutdoor: 'Moderate (some connection)',
        accessibilityNeeds: 'None',
      },
      chatHistory: [],
    });
    const maximum = await invokePlan({
      surveyData: {
        ...family.survey,
        naturalLight: 'Maximum glazing',
        indoorOutdoor: 'Moderate (some connection)',
        accessibilityNeeds: 'None',
      },
      chatHistory: [],
    });
    const outdoorMax = await invokePlan({
      surveyData: {
        ...family.survey,
        naturalLight: 'Balanced windows',
        indoorOutdoor: 'Maximum (open to outdoors)',
        accessibilityNeeds: 'None',
      },
      chatHistory: [],
    });
    const wide = await invokePlan({
      surveyData: {
        ...family.survey,
        naturalLight: 'Balanced windows',
        indoorOutdoor: 'Moderate (some connection)',
        accessibilityNeeds: 'Wide doorways',
      },
      chatHistory: [],
    });

    for (const result of [privacy, balanced, maximum, outdoorMax, wide]) {
      assert.equal(result.statusCode, 200);
      assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
      assert.equal(result.body?.engine?.generatorId, 'architect_v2');
      assert.equal(result.body?.engine?.fallbackUsed, false);
    }

    const privacyWindows = totalWindowCount(privacy.body?.planSpec);
    const balancedWindows = totalWindowCount(balanced.body?.planSpec);
    const maximumWindows = totalWindowCount(maximum.body?.planSpec);
    assert.ok(
      privacyWindows < balancedWindows,
      `Expected privacy-first windows < balanced for ${family.name}. privacy=${privacyWindows}, balanced=${balancedWindows}`
    );
    assert.ok(
      balancedWindows < maximumWindows,
      `Expected balanced windows < maximum for ${family.name}. balanced=${balancedWindows}, maximum=${maximumWindows}`
    );

    const balancedExteriorDoors = totalExteriorDoorCount(balanced.body?.planSpec);
    const maxOutdoorExteriorDoors = totalExteriorDoorCount(outdoorMax.body?.planSpec);
    assert.ok(
      maxOutdoorExteriorDoors > balancedExteriorDoors,
      `Expected indoor-outdoor maximum to increase exterior doors for ${family.name}. balanced=${balancedExteriorDoors}, maximum=${maxOutdoorExteriorDoors}`
    );

    const balancedWideDoors = widenedNonGarageDoorCount(balanced.body?.planSpec);
    const wideProfileDoors = widenedNonGarageDoorCount(wide.body?.planSpec);
    assert.ok(
      wideProfileDoors > balancedWideDoors,
      `Expected wide doorway profile to increase widened non-garage doors for ${family.name}. balanced=${balancedWideDoors}, wide=${wideProfileDoors}`
    );
  }
});

test('api response includes opening diagnostics summary for primary and alternatives', async () => {
  const result = await invokePlan({
    surveyData: {
      ...baseSurvey,
      naturalLight: 'Maximum glazing',
      indoorOutdoor: 'Maximum (open to outdoors)',
      accessibilityNeeds: 'Wide doorways',
      frontFacing: 'West',
    },
    chatHistory: [],
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(result.body?.engine?.generatorId, 'architect_v2');
  assert.equal(result.body?.engine?.fallbackUsed, false);

  const diagnostics = result.body?.openingDiagnostics;
  assert.ok(diagnostics, 'Expected openingDiagnostics on API response');
  assert.equal(diagnostics?.profiles?.openingProfile, 'maximum_glazing');
  assert.equal(diagnostics?.profiles?.indoorOutdoorProfile, 'maximum_outdoor');
  assert.equal(diagnostics?.profiles?.doorwayProfile, 'wide');
  assert.ok(Array.isArray(diagnostics?.levels) && diagnostics.levels.length > 0, 'Expected per-level opening diagnostics');
  assert.ok(Number(diagnostics?.totals?.windowCount || 0) > 0, 'Expected total window count in opening diagnostics');
  assert.ok(Number(diagnostics?.totals?.exteriorDoorCount || 0) >= 2, 'Expected exterior door count in opening diagnostics');
  assert.ok(Number(diagnostics?.totals?.wideDoorCount || 0) > 0, 'Expected wide door count in opening diagnostics');

  const alternatives = Array.isArray(result.body?.alternatives) ? result.body.alternatives : [];
  assert.ok(alternatives.length > 0, 'Expected alternatives');
  assert.ok(alternatives[0]?.openingDiagnostics, 'Expected alternatives to include openingDiagnostics');
});

test('svg contains opening profile annotation for quick visual verification', async () => {
  const result = await invokePlan({
    surveyData: {
      ...baseSurvey,
      naturalLight: 'Maximum glazing',
      indoorOutdoor: 'Maximum (open to outdoors)',
      accessibilityNeeds: 'Wide doorways',
    },
    chatHistory: [],
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body?.success, true, JSON.stringify(result.body, null, 2));
  assert.equal(result.body?.engine?.generatorId, 'architect_v2');
  assert.equal(result.body?.engine?.fallbackUsed, false);

  const svg = String(result.body?.svg || '');
  assert.ok(svg.includes('OPENINGS: MAXIMUM GLAZING'), 'Expected SVG opening profile annotation');
  assert.ok(svg.includes('DOORWAYS: WIDE'), 'Expected SVG doorway profile annotation');
});
