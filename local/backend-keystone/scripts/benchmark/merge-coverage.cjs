'use strict';
// Merge sharded studio-full-coverage runs into one report directory.
// Usage: node merge-coverage.cjs <out-dir> <shard-dir> [<shard-dir> ...]
// Rows are ordered as makeCases() orders them, so a merged run reads like a
// sequential one; a missing case is reported rather than silently dropped.
const fs = require('node:fs');
const path = require('node:path');
const { makeCases, writeSummary, columns } = require('./studio-full-coverage.cjs');

function csvCell(value) { const s = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value); return `"${s.replace(/"/g, '""')}"`; }

function main() {
  const [outArg, ...shardArgs] = process.argv.slice(2);
  if (!outArg || !shardArgs.length) throw new Error('Usage: merge-coverage.cjs <out-dir> <shard-dir> [...]');
  const out = path.resolve(outArg);
  fs.mkdirSync(out, { recursive: true });
  const rows = new Map();
  let baselineHash = '';
  for (const dir of shardArgs) {
    const text = fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8').trim();
    for (const line of text ? text.split(/\r?\n/) : []) {
      const row = JSON.parse(line);
      rows.set(`${row.suite}\u0000${row.case_id}`, row);
    }
    try { baselineHash ||= JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')).baselineGeometryHash; } catch { /* shard without summary */ }
  }
  const order = makeCases().map((c) => `${c.suite}\u0000${c.id}`);
  const ordered = order.filter((key) => rows.has(key)).map((key) => rows.get(key));
  const missing = order.filter((key) => !rows.has(key)).length;
  fs.writeFileSync(path.join(out, 'results.jsonl'), ordered.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'results.csv'), `${columns.join(',')}\n` + ordered.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\n') + '\n');
  writeSummary(out, order.length, baselineHash);
  console.log(`merged ${ordered.length} rows from ${shardArgs.length} shards; ${missing} cases missing`);
}
main();
