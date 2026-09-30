'use strict';

// Read-only P04 readiness audit. Never writes assumed schedules into saved plans.
const fs = require('node:fs');
const path = require('node:path');
const { buildFloorPassageModel } = require('../../lib/geometry/floorPassageModel');
const { OPENING_ALLOWANCES } = require('../../lib/geometry/clearanceGeometry');
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/benchmark/floor-passage-audit.js <saved-response.json> [output-directory]');
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const body = data.body || data;
const plans = body.planSpec ? [body.planSpec, ...(body.alternatives || []).map(item => item.planSpec)] : [body.plan || body];
if (plans.some(plan => !Array.isArray(plan?.levels))) throw new Error('Input must contain a plan or API response with levels.');
const out = path.resolve(process.argv[3] || path.join(__dirname, '../../../tmp/universal-coverage',
  `${new Date().toISOString().replace(/[:.]/g, '-')}-floor-passage-audit`));
fs.mkdirSync(out, { recursive: true });
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const report = { source: path.resolve(input), generatedAt: new Date().toISOString(),
  scope: 'Read-only floor-plane diagnostic; assumptions are not product schedules, construction approval or route certification.', results: [] };
for (const [index, plan] of plans.entries()) for (const level of plan.levels) {
  const schedules = (level.doors || []).map(door => {
    if (door.garageDoor || door.sliding || door.slidingDoor || door.openThreshold || door.cased) return null;
    return { roughWidthFt: door.width + OPENING_ALLOWANCES.jambPerSideFt * 2,
      frameStartFt: OPENING_ALLOWANCES.jambPerSideFt, frameEndFt: OPENING_ALLOWANCES.jambPerSideFt,
      leafProjectionFt: OPENING_ALLOWANCES.doorStopAndLeafFt, leafSide: 'start',
      basis: 'DIAGNOSTIC ASSUMPTION: existing conventional allowances; leaf side chosen for illustration, not a verified product/hinge schedule' };
  });
  const missing = buildFloorPassageModel(level);
  const assumed = buildFloorPassageModel(level, schedules);
  const name = `option-${index + 1}-level-${level.level}`;
  report.results.push({ name, missingSchedules: missing, assumedSchedules: assumed });
  const parts = [...assumed.roomClear.flatMap(room => room.parts), ...assumed.wallSolids];
  const minX = Math.min(...parts.map(p => p.x)), minY = Math.min(...parts.map(p => p.y));
  const width = Math.max(...parts.map(p => p.x + p.w)) - minX;
  const height = Math.max(...parts.map(p => p.y + p.h)) - minY;
  const rectangles = (rects, color) => rects.map(p => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${color}"/>`).join('');
  const labels = assumed.openings.filter(o => o.status === 'scheduled_geometry').map(o => {
    const p = o.clear;
    return `<text x="${p.x + p.w / 2}" y="${p.y + p.h / 2}" font-size="0.52" text-anchor="middle" fill="#0b5130">${(o.clearWidthFt * 12).toFixed(2)} in</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" viewBox="${minX - 1} ${minY - 4} ${width + 2} ${height + 6}">
  <rect x="${minX - 1}" y="${minY - 4}" width="${width + 2}" height="${height + 6}" fill="#faf8f3"/>
  <text x="${minX}" y="${minY - 2.7}" font-family="sans-serif" font-size="0.8">${escape(name)} — ${escape(assumed.status)} — ASSUMED DIMENSIONS</text>
  <text x="${minX}" y="${minY - 1.3}" font-family="sans-serif" font-size="0.55">Dark: walls · Amber: frame/leaf reservation · Green: floor passage · Missing schedules retain wall</text>
  ${rectangles(assumed.roomClear.flatMap(room => room.parts), '#e9e5dc')}${rectangles(assumed.wallSolids, '#303b40')}
  ${rectangles(assumed.assemblyReservations, '#d69532')}${rectangles(assumed.passageParts, '#8ace9f')}${labels}</svg>`;
  fs.writeFileSync(path.join(out, name + '.svg'), svg);
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Floor passage readiness</title><style>body{font:16px system-ui;margin:24px;background:#faf8f3}img{width:100%;max-width:1300px}p{max-width:85ch}</style><h1>Floor passage readiness</h1><p>${escape(report.scope)} Green areas illustrate supplied assumptions only. Production plan geometry is unchanged. Read <a href="report.json">the report</a> for missing schedules, errors and partition totals.</p>${report.results.map(r => `<h2>${escape(r.name)}</h2><p>${r.assumedSchedules.errors.length} errors; ${r.assumedSchedules.incomplete.length} unscheduled openings.</p><img alt="${escape(r.name)} floor passage diagnostic" src="${r.name}.svg">`).join('')}</html>`);
console.log(JSON.stringify({ out, results: report.results.map(r => ({ name: r.name, status: r.assumedSchedules.status,
  errors: r.assumedSchedules.errors.length, missingSchedules: r.assumedSchedules.incomplete.length,
  partitionResidual: r.assumedSchedules.partition.residualSqFt })) }));
