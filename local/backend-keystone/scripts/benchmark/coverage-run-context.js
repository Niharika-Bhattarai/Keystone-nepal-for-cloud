'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../../..');
function git(directory, args) {
  try { return execFileSync('git', ['-C', path.join(root, directory), ...args], { encoding: 'utf8' }).trim(); }
  catch { return null; }
}
function createRunContext(inputs, label) {
  const started = Date.now();
  const runId = `${new Date(started).toISOString().replace(/[:.]/g, '-')}-${label}`;
  const outputDirectory = path.join(root, 'tmp/universal-coverage', runId);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const metadata = { runId, startedAt: new Date(started).toISOString(), outputDirectory,
    backendCommit: git('backend', ['rev-parse', 'HEAD']), backendChanges: git('backend', ['status', '--short']),
    frontendCommit: git('frontend', ['rev-parse', 'HEAD']), frontendChanges: git('frontend', ['status', '--short']),
    node: process.version, command: [process.execPath, ...process.argv.slice(1)],
    inputSha256: createHash('sha256').update(JSON.stringify(inputs)).digest('hex') };
  return { metadata, finish(report) {
    const result = { ...report, provenance: { ...metadata, elapsedMs: Date.now() - started, completedAt: new Date().toISOString() } };
    const temporary = path.join(outputDirectory, 'report.json.pending');
    fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n');
    fs.renameSync(temporary, path.join(outputDirectory, 'report.json'));
    return result;
  } };
}
function assertExpectedBuild(build, expected = process.env.KEYSTONE_EXPECTED_BUILD_STAMP) {
  if (!expected) return;
  const actual = build?.buildStamp || build?.engine?.buildStamp;
  if (actual !== expected) throw new Error(`Refusing stale/unexpected server: expected build ${expected}, received ${actual || 'missing'}.`);
}
module.exports = { createRunContext, assertExpectedBuild };
