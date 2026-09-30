'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { buildEstimateWorkbook } = require('../lib/estimate/exportEstimateXlsx');
const { getMaterialSpec } = require('../lib/estimate/materialSpecLibrary');

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
  for (const candidate of pythonCandidates()) {
    const probe = spawnSync(candidate.command, [...candidate.prefix, '-c', 'import openpyxl'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

function inspectWorkbook(runner, xlsxPath) {
  const inspectCode = `
import json, sys
from openpyxl import load_workbook

wb = load_workbook(sys.argv[1], data_only=True)
alt = wb["Alternates"]

payload = {
  "sheetnames": wb.sheetnames,
  "coverTitle": wb["Cover"]["A1"].value,
  "summaryHeader": wb["Summary"]["A3"].value,
  "detailHeader": wb["Detail"]["A3"].value,
  "firstDetailItem": wb["Detail"]["B4"].value,
  "alternatesFirstScope": alt["A4"].value,
  "alternatesFirstSavings": alt["F4"].value,
}
print(json.dumps(payload))
`.trim();

  const result = spawnSync(
    runner.command,
    [...runner.prefix, '-c', inspectCode, xlsxPath],
    { encoding: 'utf8', timeout: 15_000 }
  );

  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || 'Workbook inspect failed').trim();
    throw new Error(detail);
  }

  return JSON.parse(result.stdout);
}

function buildMockEstimate() {
  const finishSpec = getMaterialSpec('craftsman');
  return {
    summary: {
      conditionedAreaSqFt: 2400,
      garageAreaSqFt: 420,
      totalAreaSqFt: 2820,
      bathCount: 3,
      roomCount: 11,
      roofPlanAreaSqFt: 1280,
      estimatedRoofSurfaceAreaSqFt: 1480,
      roofKind: 'gabled',
      windowCount: 24,
      roughGlazingAreaSqFt: 290,
      exteriorDoorCount: 3,
      interiorDoorCount: 16,
      garageDoorCount: 1,
      budgetTier: 'MID',
      rateFamily: 'MID',
    },
    takeoff: {
      rooms: [
        { level: 1, label: 'Living Room', requestedLabel: 'Living Room', canonicalType: 'living_room', conditioned: true, areaSqFt: 380, ceilingHeightFt: 9, finishClass: 'public' },
        { level: 1, label: 'Kitchen', requestedLabel: 'Kitchen', canonicalType: 'kitchen', conditioned: true, areaSqFt: 190, ceilingHeightFt: 9, finishClass: 'public' },
        { level: 2, label: 'Primary Bedroom', requestedLabel: 'Primary Bedroom', canonicalType: 'primary_bedroom', conditioned: true, areaSqFt: 240, ceilingHeightFt: 9, finishClass: 'sleep' },
      ],
      assemblies: [
        { label: 'Exterior Wall Area', unit: 'sqft', quantity: 1720, notes: 'Derived from plan perimeter and wall height' },
        { label: 'Roof Surface Area', unit: 'sqft', quantity: 1480, notes: 'Roof profile multiplier applied' },
      ],
    },
    costRange: {
      currency: 'USD',
      rateFamily: 'MID',
      regionalMultiplier: 1.18,
      lineItems: [
        { key: 'framing', label: 'Framing (Walls + Floors + Roof)', unit: 'sqft', quantity: 2400, low: 62000, target: 73000, high: 86000, notes: 'Structural frame package', category: 'shell' },
      ],
      detailLineItems: [
        { key: 'exterior_cladding_primary', lineItem: 'Exterior Cladding - Primary', category: 'Shell & Envelope', quantity: 1376, unit: 'sqft', materialCost: 11696, laborCost: 5504, total: 17200 },
        { key: 'kitchen_cabinets', lineItem: 'Kitchen Cabinets', category: 'Kitchen & Bath', quantity: 62, unit: 'lin ft', materialCost: 17360, laborCost: 5420, total: 22780 },
        { key: 'kitchen_countertops', lineItem: 'Kitchen Countertops', category: 'Kitchen & Bath', quantity: 124, unit: 'sqft', materialCost: 8060, laborCost: 2232, total: 10292 },
        { key: 'flooring_public', lineItem: 'Flooring - Public Areas', category: 'Interior Finishes', quantity: 860, unit: 'sqft', materialCost: 6880, laborCost: 3360, total: 10240 },
      ],
      categoryTotals: {
        shell: { low: 120000, target: 145000, high: 170000 },
        mechanical: { low: 42000, target: 52000, high: 61000 },
        finishes: { low: 48000, target: 61000, high: 73000 },
        millwork: { low: 54000, target: 67000, high: 81000 },
        site: { low: 27000, target: 34000, high: 41000 },
        softCosts: { low: 18000, target: 23000, high: 29000 },
      },
      total: { low: 309000, target: 382000, high: 455000 },
    },
    assumptions: {
      estimateType: 'concept',
      currency: 'USD',
      budgetTier: 'MID',
      rateFamily: 'MID',
      roofKind: 'gabled',
      roofAreaMultiplier: 1.16,
      ceilingHeightType: 'STANDARD',
      openingDefaults: {
        interiorDoorWidthFt: 2.67,
        exteriorDoorWidthFt: 3,
      },
      notes: ['Planning-grade concept estimate only.'],
    },
    finishSpec,
  };
}

test('estimate XLSX export writes new multi-sheet workbook contract', (t) => {
  const runner = resolvePythonRunner();
  if (!runner) {
    t.skip('Python with openpyxl is not available');
    return;
  }

  const mockEstimate = buildMockEstimate();
  const workbook = buildEstimateWorkbook({
    surveyData: {
      stories: '2 Stories',
      bedrooms: '3 Bed',
      bathrooms: '3 Bath',
      budgetTier: 'Mid ($200-300/sqft)',
      materials: 'Craftsman (Wood & Stone)',
      frontFacing: 'South',
      lotContext: 'Suburban standard lot',
    },
    planSpec: {
      facade: { frontFacing: 'South' },
      estimate: mockEstimate,
    },
    exportMeta: {
      projectName: 'Keystone XLSX Multi-Sheet Regression',
      generatedAt: '2026-04-04T18:00:00.000Z',
    },
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-xlsx-test-'));
  try {
    const xlsxPath = path.join(tempDir, 'estimate.xlsx');
    fs.writeFileSync(xlsxPath, workbook.buffer);
    const inspected = inspectWorkbook(runner, xlsxPath);

    assert.deepEqual(
      inspected.sheetnames,
      ['Cover', 'Summary', 'Detail', 'Takeoff', 'Assumptions', 'Alternates']
    );
    assert.match(String(inspected.coverTitle || ''), /Planning Estimate/i);
    assert.equal(inspected.summaryHeader, 'Category');
    assert.equal(inspected.detailHeader, 'Category');
    assert.equal(inspected.firstDetailItem, 'Exterior Cladding - Primary');
    assert.equal(inspected.alternatesFirstScope, 'Kitchen Countertops');
    assert.ok(Number(inspected.alternatesFirstSavings) > 0, 'Expected positive savings in alternates sheet');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
