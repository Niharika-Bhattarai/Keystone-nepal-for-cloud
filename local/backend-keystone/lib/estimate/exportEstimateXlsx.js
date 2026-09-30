'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { normalizeBrief } = require('../tile/normalizeBrief');
const { buildEstimate } = require('./buildEstimate');
const { getDefaultSpec } = require('./materialSpecLibrary');
const { PRODUCT_NAME } = require('../brand');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sanitizeFileStem(value) {
  return String(value || 'Keystone_AI_Planning_Estimate')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'Keystone_AI_Planning_Estimate';
}

function isoStamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function chooseProjectName(exportMeta = {}, surveyData = {}, brief = {}) {
  const explicit = String(exportMeta?.projectName || '').trim();
  if (explicit) return explicit;
  const facing = String(surveyData?.frontFacing || brief?.frontFacing || 'South').trim();
  const beds = String(surveyData?.bedrooms || '').trim();
  return `${PRODUCT_NAME} ${facing}${beds ? ` ${beds}` : ''} Planning Estimate`.trim();
}

function buildSurveyHighlights(surveyData = {}, brief = {}) {
  const pairs = [
    ['Stories', surveyData?.stories || brief?.stories],
    ['Bedrooms', surveyData?.bedrooms || brief?.bedroomCount],
    ['Bathrooms', surveyData?.bathrooms || brief?.bathroomCount],
    ['Private Baths', surveyData?.privateBaths || brief?.privateBathCount],
    ['Garage', surveyData?.garage || brief?.garageType],
    ['Front Facing', surveyData?.frontFacing || brief?.frontFacing],
    ['Lot Context', surveyData?.lotContext || brief?.lotContext],
    ['Materials', surveyData?.materials || brief?.materials],
    ['Kitchen Placement', surveyData?.kitchenPlacement || brief?.kitchenPlacement],
    ['Primary Suite', surveyData?.masterLocation || brief?.primaryLevel],
    ['Ceiling Height', surveyData?.ceilingHeight || brief?.ceilingHeight],
    ['Budget Tier', surveyData?.budgetTier || brief?.budgetTier],
  ];

  return pairs
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .map(([label, value]) => ({ label, value: String(value) }));
}

function addDerivedCostLineItems(lineItems = []) {
  return lineItems.map((item) => {
    const quantity = Number(item?.quantity);
    const divisor = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    const derive = (value) => {
      if (!divisor || String(item?.unit || '').toLowerCase() === 'percent') return null;
      return Math.round(((Number(value) || 0) / divisor) * 100) / 100;
    };
    return {
      ...item,
      lowUnitRate: derive(item?.low),
      targetUnitRate: derive(item?.target),
      highUnitRate: derive(item?.high),
      basis: String(item?.notes || item?.label || ''),
    };
  });
}

const CATEGORY_LABELS = {
  shell: 'Structure & Shell',
  mechanical: 'Mechanical Systems',
  finishes: 'Interior Finishes',
  millwork: 'Kitchen & Bath',
  site: 'Site & Foundation',
  softCosts: 'Soft Costs',
};

function buildCategoryTotals(categoryTotals = {}) {
  const order = ['shell', 'mechanical', 'finishes', 'millwork', 'site', 'softCosts'];
  return order
    .filter((key) => categoryTotals && Object.prototype.hasOwnProperty.call(categoryTotals, key))
    .map((key) => ({
      key,
      label: CATEGORY_LABELS[key] || key,
      low: Number(categoryTotals[key]?.low || 0),
      target: Number(categoryTotals[key]?.target || 0),
      high: Number(categoryTotals[key]?.high || 0),
    }));
}

function buildMaterialSelections(finishSpec = null, surveyData = {}) {
  if (!finishSpec || typeof finishSpec !== 'object') return [];

  const rows = [
    ['Style', finishSpec?.styleLabel || surveyData?.materials || ''],
    ['Primary Cladding', finishSpec?.exterior?.primaryCladding?.label || finishSpec?.exterior?.primaryCladding?.material || ''],
    ['Accent Cladding', finishSpec?.exterior?.accentCladding?.label || finishSpec?.exterior?.accentCladding?.material || ''],
    ['Roof Material', finishSpec?.roofing?.label || finishSpec?.roofing?.material || ''],
    ['Window Frame', finishSpec?.windows?.frameType || ''],
    ['Countertop', finishSpec?.interiorFinishes?.countertops?.label || finishSpec?.interiorFinishes?.countertops?.material || ''],
    ['Flooring (Public)', finishSpec?.interiorFinishes?.flooring?.public?.label || finishSpec?.interiorFinishes?.flooring?.public?.material || ''],
    ['Flooring (Wet)', finishSpec?.interiorFinishes?.flooring?.wet?.label || finishSpec?.interiorFinishes?.flooring?.wet?.material || ''],
    ['Flooring (Bedroom)', finishSpec?.interiorFinishes?.flooring?.bedroom?.label || finishSpec?.interiorFinishes?.flooring?.bedroom?.material || ''],
    ['Cabinet Grade', finishSpec?.interiorFinishes?.cabinets?.label || finishSpec?.interiorFinishes?.cabinets?.grade || ''],
    ['Fixture Grade', finishSpec?.interiorFinishes?.fixtures?.label || finishSpec?.interiorFinishes?.fixtures?.grade || ''],
  ];

  return rows
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
    .map(([label, value]) => ({ label, value: String(value) }));
}

function detailQuantityByKey(detailLineItems = [], key) {
  const row = detailLineItems.find((item) => String(item?.key || '') === key);
  return Number(row?.quantity || 0);
}

function pushAlternate(alternates, {
  scope,
  currentLabel,
  alternateLabel,
  quantity,
  unit,
  currentRate,
  alternateRate,
}) {
  const qty = Number(quantity || 0);
  const current = Number(currentRate || 0);
  const alternate = Number(alternateRate || 0);
  const savings = Math.round((current - alternate) * qty);
  if (!Number.isFinite(savings) || savings <= 0 || qty <= 0) return;

  alternates.push({
    scope,
    currentOption: currentLabel,
    alternateOption: alternateLabel,
    quantity: qty,
    unit: String(unit || ''),
    estimatedSavings: savings,
    notes: `Swap ${currentLabel} to ${alternateLabel}`,
  });
}

function buildValueEngineeringAlternates(finishSpec = null, brief = {}, detailLineItems = []) {
  if (!finishSpec || typeof finishSpec !== 'object') return [];

  const entrySpec = getDefaultSpec('ENTRY');
  const alternates = [];

  pushAlternate(alternates, {
    scope: 'Kitchen Countertops',
    currentLabel: finishSpec?.interiorFinishes?.countertops?.label || finishSpec?.interiorFinishes?.countertops?.material || 'Current',
    alternateLabel: entrySpec?.interiorFinishes?.countertops?.label || entrySpec?.interiorFinishes?.countertops?.material || 'Entry',
    quantity: detailQuantityByKey(detailLineItems, 'kitchen_countertops'),
    unit: 'sqft',
    currentRate: finishSpec?.interiorFinishes?.countertops?.costPerSqft,
    alternateRate: entrySpec?.interiorFinishes?.countertops?.costPerSqft,
  });

  pushAlternate(alternates, {
    scope: 'Kitchen Cabinets',
    currentLabel: finishSpec?.interiorFinishes?.cabinets?.label || finishSpec?.interiorFinishes?.cabinets?.grade || 'Current',
    alternateLabel: entrySpec?.interiorFinishes?.cabinets?.label || entrySpec?.interiorFinishes?.cabinets?.grade || 'Entry',
    quantity: detailQuantityByKey(detailLineItems, 'kitchen_cabinets'),
    unit: 'lin ft',
    currentRate: finishSpec?.interiorFinishes?.cabinets?.costPerLinFt,
    alternateRate: entrySpec?.interiorFinishes?.cabinets?.costPerLinFt,
  });

  pushAlternate(alternates, {
    scope: 'Public Flooring',
    currentLabel: finishSpec?.interiorFinishes?.flooring?.public?.label || finishSpec?.interiorFinishes?.flooring?.public?.material || 'Current',
    alternateLabel: entrySpec?.interiorFinishes?.flooring?.public?.label || entrySpec?.interiorFinishes?.flooring?.public?.material || 'Entry',
    quantity: detailQuantityByKey(detailLineItems, 'flooring_public'),
    unit: 'sqft',
    currentRate: finishSpec?.interiorFinishes?.flooring?.public?.costPerSqft,
    alternateRate: entrySpec?.interiorFinishes?.flooring?.public?.costPerSqft,
  });

  pushAlternate(alternates, {
    scope: 'Primary Cladding',
    currentLabel: finishSpec?.exterior?.primaryCladding?.label || finishSpec?.exterior?.primaryCladding?.material || 'Current',
    alternateLabel: entrySpec?.exterior?.primaryCladding?.label || entrySpec?.exterior?.primaryCladding?.material || 'Entry',
    quantity: detailQuantityByKey(detailLineItems, 'exterior_cladding_primary'),
    unit: 'sqft',
    currentRate: finishSpec?.exterior?.primaryCladding?.costPerSqft,
    alternateRate: entrySpec?.exterior?.primaryCladding?.costPerSqft,
  });

  if (String(brief?.budgetTier || '').toUpperCase() === 'ENTRY') return alternates.slice(0, 2);
  return alternates.slice(0, 6);
}

function normalizeWorkbookPayload({ surveyData = {}, planSpec, estimate, exportMeta = {} }) {
  if (!planSpec || typeof planSpec !== 'object') {
    throw new Error('planSpec is required for XLSX export');
  }

  const brief = normalizeBrief(surveyData || {});
  const resolvedEstimate =
    surveyData.estimateLocation ? buildEstimate(planSpec, { brief, surveyData }) :
    (planSpec?.estimate || estimate || buildEstimate(planSpec, { brief, surveyData }));

  if (!resolvedEstimate) {
    throw new Error('No estimate available to export');
  }

  const summary = resolvedEstimate.summary || {};
  const takeoff = resolvedEstimate.takeoff || {};
  const assumptions = resolvedEstimate.assumptions || {};
  const costRange = resolvedEstimate.costRange || {};
  const finishSpec = resolvedEstimate.finishSpec || brief?.finishSpec || null;
  const detailLineItems = Array.isArray(costRange?.detailLineItems) ? costRange.detailLineItems : [];
  const categoryTotals = buildCategoryTotals(costRange?.categoryTotals || {});
  const materialSelections = buildMaterialSelections(finishSpec, surveyData);
  const alternates = buildValueEngineeringAlternates(finishSpec, brief, detailLineItems);
  const generatedAt = isoStamp(exportMeta?.generatedAt);
  const projectName = chooseProjectName(exportMeta, surveyData, brief);

  return {
    meta: {
      brand: PRODUCT_NAME,
      projectName,
      generatedAt,
      currency: String(costRange?.currency || assumptions?.currency || 'USD'),
      estimateType: String(assumptions?.estimateType || 'concept'),
      budgetTier: String(summary?.budgetTier || assumptions?.budgetTier || brief?.budgetTier || 'MID'),
      rateFamily: String(summary?.rateFamily || costRange?.rateFamily || assumptions?.rateFamily || 'MID'),
      frontFacing: String(surveyData?.frontFacing || planSpec?.facade?.frontFacing || 'South'),
      lotContext: String(surveyData?.lotContext || brief?.lotContext || ''),
    },
    surveyHighlights: [...buildSurveyHighlights(surveyData, brief), ...(resolvedEstimate.location ? [{ label: 'Project location', value: `${resolvedEstimate.location.city}, ${resolvedEstimate.location.state} ${resolvedEstimate.location.zipCode}` }] : [])],
    summary: {
      conditionedAreaSqFt: Number(summary?.conditionedAreaSqFt || 0),
      garageAreaSqFt: Number(summary?.garageAreaSqFt || 0),
      totalAreaSqFt: Number(summary?.totalAreaSqFt || 0),
      bathCount: Number(summary?.bathCount || 0),
      roomCount: Number(summary?.roomCount || 0),
      roofPlanAreaSqFt: Number(summary?.roofPlanAreaSqFt || 0),
      estimatedRoofSurfaceAreaSqFt: Number(summary?.estimatedRoofSurfaceAreaSqFt || 0),
      windowCount: Number(summary?.windowCount || 0),
      roughGlazingAreaSqFt: Number(summary?.roughGlazingAreaSqFt || 0),
      exteriorDoorCount: Number(summary?.exteriorDoorCount || 0),
      interiorDoorCount: Number(summary?.interiorDoorCount || 0),
      garageDoorCount: Number(summary?.garageDoorCount || 0),
    },
    byLevel: Array.isArray(summary?.byLevel) ? summary.byLevel : [],
    roomSchedule: Array.isArray(takeoff?.rooms) ? takeoff.rooms : [],
    assemblies: Array.isArray(takeoff?.assemblies) ? takeoff.assemblies : [],
    detailLineItems: detailLineItems.map((item) => ({
      key: String(item?.key || ''),
      category: String(item?.category || ''),
      lineItem: String(item?.lineItem || ''),
      quantity: Number(item?.quantity || 0),
      unit: String(item?.unit || ''),
      materialCost: Number(item?.materialCost || 0),
      laborCost: Number(item?.laborCost || 0),
      total: Number(item?.total || 0),
    })),
    lineItems: addDerivedCostLineItems(Array.isArray(costRange?.lineItems) ? costRange.lineItems : []),
    categoryTotals,
    totals: {
      low: Number(costRange?.total?.low || 0),
      target: Number(costRange?.total?.target || 0),
      high: Number(costRange?.total?.high || 0),
    },
    materialSelections,
    alternates,
    assumptions: {
      currency: String(assumptions?.currency || costRange?.currency || 'USD'),
      budgetTier: String(assumptions?.budgetTier || brief?.budgetTier || ''),
      rateFamily: String(assumptions?.rateFamily || costRange?.rateFamily || ''),
      regionalMultiplier: Number(costRange?.regionalMultiplier || 1),
      roofKind: String(assumptions?.roofKind || summary?.roofKind || ''),
      roofAreaMultiplier: Number(assumptions?.roofAreaMultiplier || 0),
      ceilingHeightType: String(assumptions?.ceilingHeightType || surveyData?.ceilingHeight || ''),
      notes: [...(Array.isArray(assumptions?.notes) ? assumptions.notes : []), assumptions.regionalNote || ''],
      openingDefaults: assumptions?.openingDefaults || {},
      dataSources: [
        'Room schedule and assemblies',
        'Material Cost Engine v1 line-item model',
        'CSV unit prices: lib/estimate/data/unit-prices.csv; uncalibrated planning allowances',
        'Regional factors are heuristic adjustments; no ZIP-specific quotes available',
      ],
    },
  };
}

function pythonCandidates() {
  if (process.platform === 'win32') {
    return [
      { command: 'python', prefix: [] },
      { command: 'py', prefix: ['-3'] },
      { command: 'python3', prefix: [] },
    ];
  }
  return [
    { command: 'python3', prefix: [] },
    { command: 'python', prefix: [] },
  ];
}

function resolvePythonRunner() {
  const probeCode = 'import openpyxl';
  for (const candidate of pythonCandidates()) {
    try {
      const probe = spawnSync(candidate.command, [...candidate.prefix, '-c', probeCode], {
        encoding: 'utf8',
        timeout: 10000,
      });
      if (!probe.error && probe.status === 0) return candidate;
    } catch (_) {
      // Try next candidate.
    }
  }
  throw new Error('Python with openpyxl is not available in the backend runtime');
}

function buildEstimateWorkbook({ surveyData = {}, planSpec, estimate, exportMeta = {} }) {
  const payload = normalizeWorkbookPayload({ surveyData, planSpec, estimate, exportMeta });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-xlsx-'));
  const inputPath = path.join(tempDir, 'estimate.json');
  const outputPath = path.join(tempDir, 'estimate.xlsx');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'export', 'build_estimate_xlsx.py');

  fs.writeFileSync(inputPath, JSON.stringify(payload), 'utf8');

  const runner = resolvePythonRunner();
  const result = spawnSync(
    runner.command,
    [...runner.prefix, scriptPath, inputPath, outputPath],
    {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 4,
    }
  );

  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || 'Workbook generation failed').trim();
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(detail);
  }

  const buffer = fs.readFileSync(outputPath);
  fs.rmSync(tempDir, { recursive: true, force: true });

  const fileStem = sanitizeFileStem(payload.meta.projectName);
  return {
    buffer,
    filename: `${fileStem}.xlsx`,
    mimeType: XLSX_MIME,
  };
}

module.exports = {
  XLSX_MIME,
  buildEstimateWorkbook,
};
