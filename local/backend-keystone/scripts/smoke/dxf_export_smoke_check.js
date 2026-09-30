'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const DEFAULT_FRONTEND_APP_PATH = path.resolve(__dirname, '../../../frontend/app.jsx');

const SMOKE_PLAN_SPEC = Object.freeze({
  levels: [
    {
      level: 1,
      width: 46,
      height: 28,
      rooms: [
        { name: 'ENTRY', x: 0, y: 0, width: 12, height: 8 },
        { name: 'LIVING ROOM', x: 12, y: 0, width: 20, height: 14 },
        { name: 'KITCHEN', x: 0, y: 8, width: 16, height: 10 },
        { name: 'DINING ROOM', x: 16, y: 8, width: 10, height: 10 },
        { name: 'GARAGE', x: 32, y: 0, width: 14, height: 18 },
        { name: 'STAIR 1', x: 16, y: 8, width: 6, height: 12, staircase: true },
      ],
    },
    {
      level: 2,
      width: 46,
      height: 28,
      rooms: [
        { name: 'PRIMARY BEDROOM', x: 24, y: 0, width: 22, height: 14 },
        { name: 'BEDROOM 2', x: 0, y: 0, width: 14, height: 12 },
        { name: 'BATHROOM', x: 14, y: 0, width: 10, height: 8 },
        { name: 'HALLWAY 1', x: 14, y: 10, width: 10, height: 4 },
        { name: 'STAIR 2', x: 16, y: 8, width: 6, height: 12, staircase: true },
      ],
    },
  ],
  elevations: {
    frontSvg: '',
    rearSvg: '',
    leftSvg: '',
    rightSvg: '',
    meta: { frontEdge: 'bottom' },
  },
  style: 'craftsman',
  roofStyle: 'craftsman gable',
  houseWidth: 46,
  houseDepth: 28,
});

function loadBuildPresentationDxf(frontendAppPath = DEFAULT_FRONTEND_APP_PATH) {
  const source = fs.readFileSync(frontendAppPath, 'utf8');
  const blockStart = source.indexOf('const rotateEdgeForView');
  const blockEnd = source.indexOf('const RENDER_REFINEMENTS');
  if (blockStart < 0 || blockEnd < 0 || blockEnd <= blockStart) {
    throw new Error('Could not locate DXF builder block in frontend/app.jsx');
  }

  let block = source.slice(blockStart, blockEnd);
  block = block.replace(/const\s+([A-Za-z0-9_]+)\s*=\s*/g, 'globalThis.$1 = ');

  const sandbox = {
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    Set,
    Map,
    parseInt,
    parseFloat,
    isFinite,
    Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox, { timeout: 15_000 });

  if (typeof sandbox.buildPresentationDxf !== 'function') {
    throw new Error('buildPresentationDxf function was not loaded from frontend/app.jsx');
  }
  return sandbox.buildPresentationDxf;
}

function generateSmokeDxf(options = {}) {
  const builder = typeof options.builder === 'function'
    ? options.builder
    : loadBuildPresentationDxf(options.frontendAppPath);
  const planSpec = options.planSpec || SMOKE_PLAN_SPEC;
  return builder(planSpec);
}

function createTempDxfFile(dxfString) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-dxf-smoke-'));
  const dxfPath = path.join(tempDir, 'smoke.dxf');
  fs.writeFileSync(dxfPath, dxfString, 'utf8');
  return { tempDir, dxfPath };
}

function runPythonEzdxfAudit(dxfPath, options = {}) {
  const pythonBin = options.pythonBin || require('../../lib/cad/buildDxf').pythonCommand();
  const pythonScript = [
    'import json, sys',
    'from ezdxf import recover',
    'doc, auditor = recover.readfile(sys.argv[1])',
    'print(json.dumps({"dxfversion": doc.dxfversion, "errors": len(auditor.errors), "fixes": len(auditor.fixes)}))',
  ].join('\n');

  const child = spawnSync(pythonBin, ['-c', pythonScript, dxfPath], {
    encoding: 'utf8',
    timeout: 30_000,
  });

  if (child.status !== 0) {
    const stderr = `${child.stderr || ''}${child.stdout || ''}`.trim();
    return {
      ok: false,
      error: 'Python ezdxf audit failed',
      pythonBin,
      status: child.status,
      stderr,
    };
  }

  let payload = null;
  try {
    payload = JSON.parse(String(child.stdout || '{}'));
  } catch (error) {
    return {
      ok: false,
      error: 'Python ezdxf audit returned non-JSON output',
      pythonBin,
      status: child.status,
      stderr: String(child.stdout || '').trim(),
    };
  }

  return {
    ok: true,
    pythonBin,
    status: child.status,
    ...payload,
  };
}

function evaluateDxfMarkers(dxfString) {
  return {
    hasAc1015: dxfString.includes('9\n$ACADVER\n1\nAC1015'),
    hasLineweightCodes: dxfString.includes('\n370\n'),
    hasObjectsSection: dxfString.includes('0\nSECTION\n2\nOBJECTS'),
    hasVisualStyleDictionary: dxfString.includes('3\nACAD_VISUALSTYLE'),
  };
}

function runDxfSmokeCheck(options = {}) {
  const dxfA = generateSmokeDxf(options);
  const dxfB = generateSmokeDxf(options);
  const deterministic = dxfA === dxfB;
  const markers = evaluateDxfMarkers(dxfA);
  const sha256 = crypto.createHash('sha256').update(dxfA).digest('hex');
  const { tempDir, dxfPath } = createTempDxfFile(dxfA);
  const audit = runPythonEzdxfAudit(dxfPath, options);

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
    // no-op: smoke check should not fail just because temp cleanup failed
  }

  const markerPass = Object.values(markers).every(Boolean);
  const auditPass = audit.ok && audit.dxfversion === 'AC1015' && Number(audit.errors || 0) === 0 && Number(audit.fixes || 0) === 0;
  const pass = Boolean(deterministic && markerPass && auditPass);

  return {
    pass,
    deterministic,
    markers,
    audit,
    sha256,
    bytes: Buffer.byteLength(dxfA, 'utf8'),
  };
}

function printSummary(summary) {
  console.log('\nDXF smoke check summary');
  console.log('=======================');
  console.log(`pass: ${summary.pass}`);
  console.log(`deterministic: ${summary.deterministic}`);
  console.log(`sha256: ${summary.sha256}`);
  console.log(`bytes: ${summary.bytes}`);
  console.log(`markers: ${JSON.stringify(summary.markers)}`);
  console.log(`audit: ${JSON.stringify(summary.audit)}`);
}

function main() {
  const summary = runDxfSmokeCheck();
  printSummary(summary);
  process.exitCode = summary.pass ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_FRONTEND_APP_PATH,
  SMOKE_PLAN_SPEC,
  loadBuildPresentationDxf,
  generateSmokeDxf,
  runPythonEzdxfAudit,
  evaluateDxfMarkers,
  runDxfSmokeCheck,
};

