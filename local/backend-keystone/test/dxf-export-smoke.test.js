'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runDxfSmokeCheck } = require('../scripts/smoke/dxf_export_smoke_check');

test('DXF export smoke check: deterministic AC1015 + lineweights + clean ezdxf audit', () => {
  const summary = runDxfSmokeCheck();

  assert.equal(summary.deterministic, true, 'DXF output should be deterministic for a fixed smoke payload');
  assert.equal(summary.markers.hasAc1015, true, 'DXF should advertise AC1015 in header');
  assert.equal(summary.markers.hasLineweightCodes, true, 'DXF should emit 370 lineweight codes');
  assert.equal(summary.markers.hasObjectsSection, true, 'DXF should include OBJECTS section');
  assert.equal(summary.markers.hasVisualStyleDictionary, true, 'DXF should include ACAD_VISUALSTYLE dictionary entry');

  assert.equal(summary.audit.ok, true, `Python ezdxf audit failed: ${summary.audit?.stderr || 'unknown error'}`);
  assert.equal(summary.audit.dxfversion, 'AC1015', 'ezdxf should parse the file as AC1015');
  assert.equal(summary.audit.errors, 0, 'ezdxf audit should report zero errors');
  assert.equal(summary.audit.fixes, 0, 'ezdxf audit should report zero auto-fixes');

  assert.equal(summary.pass, true, JSON.stringify(summary, null, 2));
});


test('the DXF writer runs python3 on Linux (the service container has no `python`), python on Windows', () => {
  const { pythonCommand } = require('../lib/cad/buildDxf');
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const saved = process.env.PYTHON;
  try {
    delete process.env.PYTHON;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    assert.equal(pythonCommand(), 'python3');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    assert.equal(pythonCommand(), 'python');
    process.env.PYTHON = '/opt/py/bin/python3.12';
    assert.equal(pythonCommand(), '/opt/py/bin/python3.12');
  } finally {
    Object.defineProperty(process, 'platform', platform);
    if (saved === undefined) delete process.env.PYTHON; else process.env.PYTHON = saved;
  }
});
