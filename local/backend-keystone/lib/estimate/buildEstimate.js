'use strict';

const { normalizeBrief } = require('../tile/normalizeBrief');
const { ESTIMATE_VERSION, DOOR_WIDTHS_FT } = require('./estimateConfig');
const { computeTakeoff } = require('./computeTakeoff');
const { computeEstimateRange } = require('./computeEstimateRange');

function summaryByLevel(levels = []) {
  return levels.map((level) => ({
    level: level.level,
    conditionedAreaSqFt: level.conditionedAreaSqFt,
    garageAreaSqFt: level.garageAreaSqFt,
    totalAreaSqFt: level.totalAreaSqFt,
  }));
}

function buildAssumptions(planSpec, brief, takeoff, costRange, finishSpec = null) {
  const raw = takeoff?.raw || {};
  return {
    estimateType: 'concept',
    currency: 'USD',
    budgetTier: String(brief?.budgetTier || 'MID'),
    rateFamily: costRange?.rateFamily || 'MID',
    finishSpec: finishSpec || null,
    roofKind: raw.roofKind || String(planSpec?.elevations?.meta?.roofKind || 'gabled'),
    roofAreaMultiplier: raw.roofMultiplier || 1.16,
    ceilingHeightType: String(brief?.ceilingHeight || planSpec?.verticalModel?.ceilingHeightType || 'STANDARD'),
    openingDefaults: {
      interiorDoorWidthFt: DOOR_WIDTHS_FT.interior,
      exteriorDoorWidthFt: DOOR_WIDTHS_FT.exterior,
      mainEntryDoorWidthFt: DOOR_WIDTHS_FT.mainEntry,
      garageDoorWidthFt: brief?.garageType === 'TWO_CAR' ? DOOR_WIDTHS_FT.garageDouble : DOOR_WIDTHS_FT.garageSingle,
    },
    regionalNote: 'CSV planning allowances with heuristic regional adjustment. Selected flooring families have dated ZIP-specific retail observations where available. Other prices and installation remain allowances; these are not verified installed quotes.',
    windowSource: `Saved opening schedule (${raw.windowCount || 0} windows); widths use room-type defaults only when absent. Heights use saved opening/room metadata or presentation defaults.`,
    notes: [
      'Planning-grade concept estimate only; not a permit, bid, or contractor quote.',
      'Wall lengths use continuous nominal geometry; wall areas remain gross areas before opening deductions.',
      'Floor quantities are nominal room areas, not finished-face net areas or procurement quantities including waste.',
      'Roof surface area is estimated from plan footprint and elevation roof profile.',
      'Kitchen and bathroom costs are modeled as room-count allowances tied to budget tier.',
      'Cost rates and allowance quantities have not been calibrated against a project reference; no 5% accuracy claim is established.',
      ...(costRange?.detailLineItems || []).filter(item => item.productPrice).map(item =>
        `${item.lineItem}: representative product ${item.productPrice.sku}, observed ${item.productPrice.observed}, ZIP ${item.productPrice.region}; ${item.productPrice.sourceUrl}. Excludes ${item.productPrice.exclusions}. Installation remains an allowance.`),
    ],
  };
}

function buildCsvRows(planSpec, brief, takeoff, costRange, assumptions) {
  const raw = takeoff?.raw || {};
  const rows = [];
  const push = (section, item, unit = '', quantity = '', low = '', target = '', high = '', notes = '') => {
    rows.push({ section, item, unit, quantity, low, target, high, notes });
  };

  push('Project', 'Estimate Version', '', ESTIMATE_VERSION);
  push('Project', 'Budget Tier', '', String(brief?.budgetTier || 'MID'));
  push('Project', 'Front Facing', '', String(brief?.frontFacing || planSpec?.facade?.frontFacing || 'South'));
  push('Project', 'Roof Kind', '', String(raw.roofKind || 'gabled'));
  push('Project', 'Conditioned Area', 'sqft', raw.conditionedAreaSqFt || 0);
  push('Project', 'Garage Area', 'sqft', raw.garageAreaSqFt || 0);

  for (const room of takeoff?.rooms || []) {
    push('Room Schedule', `${room.label} (L${room.level})`, 'sqft', room.areaSqFt, '', '', '', `${room.canonicalType} | ${room.finishClass}`);
  }

  for (const assembly of takeoff?.assemblies || []) {
    push('Takeoff', assembly.label, assembly.unit, assembly.quantity, '', '', '', assembly.notes || '');
  }

  const categoryKeys = ['shell', 'mechanical', 'finishes', 'millwork', 'site', 'softCosts'];
  const categoryLabels = {
    shell: 'STRUCTURE & SHELL',
    mechanical: 'MECHANICAL SYSTEMS',
    finishes: 'INTERIOR FINISHES',
    millwork: 'MILLWORK & APPLIANCES',
    site: 'SITE & FOUNDATION',
    softCosts: 'SOFT COSTS',
  };

  const allLineItems = costRange?.lineItems || [];
  const categorized = new Set();

  categoryKeys.forEach(cat => {
    const catItems = allLineItems.filter(i => i.category === cat);
    if (catItems.length === 0) return;
    const sectionLabel = categoryLabels[cat];
    catItems.forEach(item => {
      categorized.add(item.key);
      push(sectionLabel, item.label, item.unit || '', item.quantity ?? '', item.low ?? '', item.target ?? '', item.high ?? '', item.notes || '');
    });
    const catTotal = costRange?.categoryTotals?.[cat];
    if (catTotal) {
      push(sectionLabel, 'SUBTOTAL', 'lump', 1, catTotal.low, catTotal.target, catTotal.high, '');
    }
  });

  // Any uncategorized items (safety net)
  allLineItems.filter(i => !categorized.has(i.key)).forEach(item => {
    push('Cost Range', item.label, item.unit || '', item.quantity ?? '', item.low ?? '', item.target ?? '', item.high ?? '', item.notes || '');
  });

  push('Cost Range', 'Total Planning Range', 'USD', '', costRange?.total?.low ?? '', costRange?.total?.target ?? '', costRange?.total?.high ?? '', `${costRange?.rateFamily || 'MID'} rate family`);

  for (const note of assumptions?.notes || []) {
    push('Assumptions', note);
  }

  return rows;
}

function buildEstimate(planSpec, options = {}) {
  if (!planSpec || !Array.isArray(planSpec.levels)) return null;

  const brief = options?.brief || normalizeBrief(options?.surveyData || {});
  const finishSpec = options?.finishSpec || brief?.finishSpec || null;
  const takeoff = computeTakeoff(planSpec, brief);
  const projectLocation = options.surveyData?.estimateLocation;
  const location = projectLocation ? require('./unitPrices').estimateLocation(projectLocation) : null;
  const costRange = computeEstimateRange(takeoff, brief, finishSpec, { location: location ? location.state : brief?.location || '', estimateLocation: location });
  const assumptions = buildAssumptions(planSpec, brief, takeoff, costRange, finishSpec);

  return {
    version: ESTIMATE_VERSION,
    location,
    summary: {
      conditionedAreaSqFt: takeoff.raw.conditionedAreaSqFt,
      garageAreaSqFt: takeoff.raw.garageAreaSqFt,
      totalAreaSqFt: takeoff.raw.totalAreaSqFt,
      byLevel: summaryByLevel(takeoff.byLevel),
      roomCount: takeoff.rooms.length,
      bathCount: takeoff.raw.bathroomCount + takeoff.raw.primaryBathroomCount + takeoff.raw.powderRoomCount,
      roofPlanAreaSqFt: takeoff.raw.roofPlanAreaSqFt,
      estimatedRoofSurfaceAreaSqFt: takeoff.raw.estimatedRoofSurfaceAreaSqFt,
      roofKind: takeoff.raw.roofKind,
      windowCount: takeoff.raw.windowCount,
      roughGlazingAreaSqFt: takeoff.raw.roughGlazingAreaSqFt,
      exteriorDoorCount: takeoff.raw.exteriorDoorCount,
      interiorDoorCount: takeoff.raw.interiorDoorCount,
      garageDoorCount: takeoff.raw.garageDoorCount,
      budgetTier: String(brief?.budgetTier || 'MID'),
      rateFamily: costRange.rateFamily,
      materialStyleId: finishSpec?.styleId || null,
      materialStyleLabel: finishSpec?.styleLabel || null,
      normalizedCostPerConditionedSqFt: costRange.normalizedCostPerConditionedSqFt,
      categoryTotals: costRange.categoryTotals || {},
    },
    takeoff: {
      rooms: takeoff.rooms,
      assemblies: takeoff.assemblies,
      windowSchedule: takeoff.windowSchedule,
      raw: takeoff.raw,
    },
    finishSpec: finishSpec || null,
    costRange,
    assumptions,
    csvRows: buildCsvRows(planSpec, brief, takeoff, costRange, assumptions),
  };
}

module.exports = {
  buildEstimate,
};
