'use strict';

const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { proposeBedroomClosetRepair } = require('../../lib/geometry/repairBedroomCloset');
const { buildFloorPassageModel } = require('../../lib/geometry/floorPassageModel');
const { checkBedroomApproach } = require('../../lib/geometry/bedroomApproach');
const { boundingRectOf, partListOf } = require('../../lib/planGeometry');
const { closetLayout } = require('../../lib/closetGeometry');
const { renderPlanSvg } = require('../../lib/renderPlanSvg');
const { verifyBedroomClosetRepair, relocationOptions } = require('../../test/helpers/verifyBedroomClosetRepair');
const backend = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv[2] || path.join(backend, '../tmp/universal-coverage', new Date().toISOString().replace(/[:.]/g, '-') + '-bedroom-closet-repair-audit'));
fs.mkdirSync(out, { recursive: true });
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const report = { startedAt: new Date().toISOString(), backendHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: backend, encoding: 'utf8' }).trim(),
  scope: 'Four saved cases unresolved by bed/nightstand rotation. Explicit proposal only; assumed wall/opening dimensions, no construction certification or production activation.',
  sourceHashes: {}, fixtureHashes: {}, results: [] };
for (const file of execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'lib', 'api'], { cwd: backend, encoding: 'utf8' }).trim().split(/\r?\n/)) report.sourceHashes[file] = sha(path.join(backend, file));
for (const file of ['scripts/benchmark/bedroom-closet-repair-audit.js', 'test/helpers/verifyBedroomClosetRepair.js']) report.sourceHashes[file] = sha(path.join(backend, file));

function diagram(plan, request, title, access) {
  const level = plan.levels.find(l => l.level === 2), bed = level.furniture.find(f => f.id === request.bedId);
  const room = level.rooms.find(r => r.id === bed.roomId), closet = level.rooms.find(r => r.ownerBedroomId === room.id);
  const box = boundingRectOf({ parts: [...partListOf(room), ...partListOf(closet)] }), model = buildFloorPassageModel(level);
  const pad = 2, x = box.x - pad, y = box.y - pad, w = box.w + pad * 2, h = box.h + pad * 2;
  const rectangles = (items, fill, extra = '') => items.map(p => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${fill}" ${extra}/>`).join('');
  const approach = checkBedroomApproach(level, request);
  const routes = approach.sides.filter(s => s.status === 'clear').slice(0, 1).map(s => `<polyline points="${s.path.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#087a59" stroke-width="${request.clearWidthFt}" stroke-opacity="0.18" stroke-linecap="square" stroke-linejoin="miter"/><polyline points="${s.path.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#087a59" stroke-width="0.07"/>`).join('');
  const items = level.furniture.filter(f => [room.id, closet.id].includes(f.roomId));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" viewBox="${x} ${y - 2} ${w} ${h + 2}"><defs><clipPath id="crop"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs><rect x="${x}" y="${y - 2}" width="${w}" height="${h + 2}" fill="#faf8f3"/><g font-family="sans-serif"><text x="${x + .25}" y="${y - 1.3}" font-size=".34">${esc(title)}</text><text x="${x + .25}" y="${y - .6}" font-size=".27">Amber: closet access; green: ${request.clearWidthFt * 12}-inch approach. Assumed wall/schedule geometry.</text><g clip-path="url(#crop)">${rectangles(model.roomClear.flatMap(r => r.parts), '#eee9df')}${rectangles(model.wallSolids, '#303b40')}${rectangles(model.assemblyReservations, '#9e6440')}${rectangles(model.passageParts, '#8ace9f')}${rectangles([access || closetLayout(closet).access], '#d69532', 'fill-opacity=".3"')}${rectangles(level.furniture, '#b4aaa0')}${routes}${items.map(f => `<text x="${f.x + f.w / 2}" y="${f.y + f.h / 2}" text-anchor="middle" font-size=".26">${esc(f.kind)}</text>`).join('')}</g></g></svg>`;
}

for (const name of ['North-standard-1-option-4', 'East-wide-1-option-2', 'West-standard-1-option-3', 'West-standard-1-option-4']) {
  const file = `test/fixtures/bedroom-approach-repair/matrix-${name}-level-2-input.json`;
  report.fixtureHashes[file] = sha(path.join(backend, file));
  const input = JSON.parse(fs.readFileSync(path.join(backend, file)));
  input.options = relocationOptions(input);
  const snapshot = structuredClone(input), started = Date.now();
  const result = proposeBedroomClosetRepair(input.plan, input.survey, input.options);
  assert.deepEqual(input, snapshot);
  assert.ok(result.reservationCount <= 128 && result.furnitureCandidateCount <= 2000 && result.routeCheckCount <= 64);
  verifyBedroomClosetRepair(input, result);
  fs.writeFileSync(path.join(out, name + '-input.json'), JSON.stringify(input, null, 2));
  fs.writeFileSync(path.join(out, name + '-result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(out, name + '-before.svg'), diagram(input.plan, input.options.request, name + ' / before'));
  fs.writeFileSync(path.join(out, name + '-after.svg'), diagram(result.proposedPlan, input.options.request, name + ' / validated proposal', result.physicalClosetAccess));
  for (const style of ['normal', 'rendered']) fs.writeFileSync(path.join(out, `${name}-after-${style}.svg`), renderPlanSvg(structuredClone(result.proposedPlan), { style }));
  const summary = { name, status: result.status, reservationCount: result.reservationCount,
    furnitureCandidateCount: result.furnitureCandidateCount, routeCheckCount: result.routeCheckCount,
    rejections: result.rejections, closetBefore: result.closetBefore, closetAfter: result.closetAfter,
    independentVerification: 'original survey, exact permitted edits, unchanged external clear geometry, pair partition, storage/access, inventory, opening bindings and swept paths passed', durationMs: Date.now() - started };
  report.results.push(summary); console.log(JSON.stringify(summary));
}
report.finishedAt = new Date().toISOString();
report.sourceAndFixturesUnchanged = [...Object.entries(report.sourceHashes), ...Object.entries(report.fixtureHashes)].every(([file, hash]) => sha(path.join(backend, file)) === hash);
assert.equal(report.sourceAndFixturesUnchanged, true);
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Coordinated closet repair audit</title><style>body{font:16px system-ui;background:#faf8f3;margin:32px;line-height:1.5}p{max-width:100ch}.pair{display:flex;gap:16px;flex-wrap:wrap}.pair img{width:min(100%,650px)}a{color:#146442}</style><h1>Coordinated closet repair proposals</h1><p>${esc(report.scope)} These four repairs complement three earlier furniture-only repairs; this is not a universal survey coverage result. Derived metadata needs rebuilding before production adoption. <a href="report.json">Evidence</a>.</p>${report.results.map(r => `<h2>${esc(r.name)} — ${r.status}</h2><p>${r.reservationCount} reservations, ${r.furnitureCandidateCount} furniture candidates, ${r.routeCheckCount} approach evaluations. ${esc(r.independentVerification)}.</p><div class="pair"><img alt="Before" src="${r.name}-before.svg"><img alt="Proposal" src="${r.name}-after.svg"></div><p><a href="${r.name}-after-normal.svg">Normal sheet</a> / <a href="${r.name}-after-rendered.svg">Rendered sheet</a> / <a href="${r.name}-result.json">Proposed plan</a></p>`).join('')}</html>`);
console.log(out);
