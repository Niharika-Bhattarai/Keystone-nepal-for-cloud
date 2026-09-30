'use strict';

const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { proposeBedroomApproachRepair } = require('../../lib/geometry/repairBedroomApproach');
const { proposeBedroomClosetRepair } = require('../../lib/geometry/repairBedroomCloset');
const { createBedroomArchitecturalCheck } = require('../../lib/geometry/bedroomArchitecture');
const { checkBedroomApproach } = require('../../lib/geometry/bedroomApproach');
const { buildFloorPassageModel } = require('../../lib/geometry/floorPassageModel');
const { containsRect, subtract } = require('../../lib/geometry/rectBoolean');
const { validateEditedPlan } = require('../../lib/validateEditedPlan');
const { renderPlanSvg } = require('../../lib/renderPlanSvg');
const { boundingRectOf, partListOf } = require('../../lib/planGeometry');
const { relocationOptions, verifyBedroomClosetRepair } = require('../../test/helpers/verifyBedroomClosetRepair');
const { bedroomArchitecturePolicy } = require('../../test/helpers/bedroomArchitecturePolicy');
const { verifyBedroomFurnitureRepair } = require('../../test/helpers/verifyBedroomFurnitureRepair');
const { bindBedroomMeasurements } = require('../../lib/geometry/bedroomMeasurements');
const { rebuildRepairedPlan } = require('../../lib/geometry/rebuildRepairedPlan');
const backend = path.resolve(__dirname, '../..');
const args = process.argv.slice(2), coordinateDresser = args.includes('--coordinate-dresser'), persistRebuild = args.includes('--persist-rebuild');
const out = path.resolve(args.find(arg => !arg.startsWith('--')) || path.join(backend, '../tmp/universal-coverage', new Date().toISOString().replace(/[:.]/g, '-') + (persistRebuild ? '-bedroom-rebuild-audit' : coordinateDresser ? '-bedroom-dresser-audit' : '-bedroom-architecture-audit')));
fs.mkdirSync(out, { recursive: true });
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(backend, f))).digest('hex');
const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const report = { startedAt: new Date().toISOString(), backendHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: backend, encoding: 'utf8' }).trim(),
  scope: 'Explicit proposal search for seven saved cases under labelled furniture/window assumptions. Not production generation, universal coverage or construction/egress certification.',
  coordinateDresser, persistRebuild, sourceHashes: {}, fixtureHashes: {}, results: [] };
for (const file of execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'lib', 'api'], { cwd: backend, encoding: 'utf8' }).trim().split(/\r?\n/)) report.sourceHashes[file] = sha(file);
for (const file of ['scripts/benchmark/bedroom-architecture-audit.js', 'test/helpers/bedroomArchitecturePolicy.js', 'test/helpers/verifyBedroomClosetRepair.js', 'test/helpers/verifyBedroomFurnitureRepair.js']) report.sourceHashes[file] = sha(file);

function assess(plan, input) {
  const level = plan.levels.find(l => l.level === input.options.levelNumber), bed = level.furniture.find(f => f.id === input.options.request.bedId);
  const compiled = createBedroomArchitecturalCheck(level, bed.roomId, bed.id, input.options.architecturePolicy);
  assert.equal(compiled.status, 'ready', compiled.reason);
  return { compiled, assessment: compiled.check(level.furniture.filter(f => f.roomId === bed.roomId)) };
}

function diagram(plan, input, title) {
  const level = plan.levels.find(l => l.level === input.options.levelNumber), bed = level.furniture.find(f => f.id === input.options.request.bedId);
  const room = level.rooms.find(r => r.id === bed.roomId), closet = level.rooms.find(r => r.ownerBedroomId === room.id);
  const box = boundingRectOf({ parts: [...partListOf(room), ...partListOf(closet)] });
  const x = box.x - 2, y = box.y - 2, w = box.w + 4, h = box.h + 4;
  const { compiled, assessment } = assess(plan, input), model = buildFloorPassageModel(level), approach = checkBedroomApproach(level, input.options.request);
  const rects = (rs, color, extra = '') => rs.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${color}" ${extra}/>`).join('');
  const support = assessment.headboardSupport;
  const supported = support ? `<line x1="${support.dir === 'horizontal' ? support.startFt : support.finishedAxisFt}" y1="${support.dir === 'horizontal' ? support.finishedAxisFt : support.startFt}" x2="${support.dir === 'horizontal' ? support.endFt : support.finishedAxisFt}" y2="${support.dir === 'horizontal' ? support.finishedAxisFt : support.endFt}" stroke="#1467b0" stroke-width=".12"/>` : '';
  const route = approach.sides.filter(s => s.status === 'clear').slice(0, 1).map(s => `<polyline points="${s.path.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#087a59" stroke-opacity=".2" stroke-width="${input.options.request.clearWidthFt}" stroke-linecap="square" stroke-linejoin="miter"/>`).join('');
  const items = level.furniture.filter(f => [room.id, closet.id].includes(f.roomId));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" viewBox="${x} ${y - 2} ${w} ${h + 2}"><defs><clipPath id="crop"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs><rect x="${x}" y="${y - 2}" width="${w}" height="${h + 2}" fill="#faf8f3"/><g font-family="sans-serif"><text x="${x + .25}" y="${y - 1.3}" font-size=".32">${esc(title)}</text><text x="${x + .25}" y="${y - .6}" font-size=".25">Blue: head support. Orange: window clearance. Green: 30-inch route. Assumed dimensions.</text><g clip-path="url(#crop)">${rects(model.roomClear.flatMap(r => r.parts), '#eee9df')}${rects(model.wallSolids, '#303b40')}${rects(model.assemblyReservations, '#9e6440')}${rects(model.passageParts, '#8ace9f')}${rects(compiled.windowZones, '#ef9a34', 'fill-opacity=".5"')}${rects(level.furniture, '#b4aaa0')}${route}${supported}${items.map(f => `<text x="${f.x + f.w / 2}" y="${f.y + f.h / 2}" text-anchor="middle" font-size=".26">${esc(f.kind)}</text>`).join('')}</g></g></svg>`;
}

const dir = 'test/fixtures/bedroom-approach-repair';
for (const file of fs.readdirSync(path.join(backend, dir)).filter(f => f.endsWith('-input.json'))) {
  report.fixtureHashes[`${dir}/${file}`] = sha(`${dir}/${file}`);
  const input = JSON.parse(fs.readFileSync(path.join(backend, dir, file)));
  input.options = { ...relocationOptions(input), architecturePolicy: bedroomArchitecturePolicy(input),
    allowQuarterTurns: true, nightstandPlacement: 'head_sides', maxCandidates: 4000, maxRouteChecks: 64 };
  const sourceLevel = input.plan.levels.find(l => l.level === input.options.levelNumber);
  const sourceBed = sourceLevel.furniture.find(f => f.id === input.options.request.bedId);
  input.options.coordinateDresser = coordinateDresser && sourceLevel.furniture.filter(f => f.roomId === sourceBed.roomId && f.kind === 'dresser').length === 1;
  if (persistRebuild) {
    input.plan.levels[input.plan.levels.indexOf(sourceLevel)] = bindBedroomMeasurements(sourceLevel, {
      bedroomId:sourceBed.roomId,bedId:sourceBed.id,source:{kind:'assumed',reference:'Saved-case audit; illustrative furniture/window measurements only'},
      policy:input.options.architecturePolicy });
    input.plan = JSON.parse(JSON.stringify(input.plan));
  }
  const repairOptions = {...input.options};
  if (persistRebuild) delete repairOptions.architecturePolicy; // Exercise the persisted path.
  const snapshot = structuredClone(input), started = Date.now();
  const furniture = proposeBedroomApproachRepair(input.plan, input.survey, {...repairOptions,coordinateDresser:false});
  const accepted = r => r && ['repaired','unchanged'].includes(r.status);
  const closet = !accepted(furniture) ? proposeBedroomClosetRepair(input.plan,input.survey,{...repairOptions,coordinateDresser:false}) : null;
  const dresser = !accepted(furniture) && !accepted(closet) && input.options.coordinateDresser ? proposeBedroomApproachRepair(input.plan,input.survey,repairOptions) : null;
  const result = accepted(furniture) ? furniture : accepted(closet) ? closet : dresser || closet;
  assert.deepEqual(input, snapshot);
  const summary = { name: input.name, status: result.status, strategy: result.strategy, reason: result.reason,
    sourceArchitecture: assess(input.plan, input).assessment,
    furnitureAttempt: { status: furniture.status, candidates: furniture.candidateCount, routes: furniture.routeCheckCount, rejections: furniture.rejections },
    dresserAttempt: dresser ? {status: dresser.status, candidates: dresser.candidateCount, slots: dresser.dresserSlotCount, routes: dresser.routeCheckCount, rejections: dresser.rejections} : null,
    closetAttempt: closet ? {status:closet.status,reservations:closet.reservationCount,candidates:closet.furnitureCandidateCount,routes:closet.routeCheckCount,rejections:closet.rejections,bedroomRejections:closet.bedroomRejections} : null,
    reservationCount: result.reservationCount, furnitureCandidateCount: result.furnitureCandidateCount,
    routeCheckCount: result.routeCheckCount, rejections: result.rejections, bedroomRejections: result.bedroomRejections };
  fs.writeFileSync(path.join(out, input.name + '-input.json'), JSON.stringify(input, null, 2));
  fs.writeFileSync(path.join(out, input.name + '-result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(out, input.name + '-before.svg'), diagram(input.plan, input, input.name + ' / original'));
  if (result.status === 'repaired') {
    if (result.strategy === 'coordinated_bedroom_closet') verifyBedroomClosetRepair(input, result);
    else verifyBedroomFurnitureRepair(input, result);
    assert.deepEqual(validateEditedPlan(result.proposedPlan, input.survey), []);
    const { assessment } = assess(result.proposedPlan, input);
    assert.equal(assessment.status, 'clear'); assert.deepEqual(assessment, result.architecturalValidation);
    const level = result.proposedPlan.levels.find(l => l.level === input.options.levelNumber), approach = checkBedroomApproach(level, input.options.request);
    assert.equal(approach.status, 'clear'); assert.deepEqual(approach, result.after);
    const model = buildFloorPassageModel(level), allowed = new Set(approach.allowedRoomIds);
    const free = subtract([...model.roomClear.filter(r => allowed.has(r.roomId)).flatMap(r => r.parts),
      ...model.openings.filter(o => o.rooms.every(id => allowed.has(id))).map(o => o.clear)], level.furniture.filter(f => allowed.has(f.roomId)));
    for (const side of approach.sides.filter(s => s.status === 'clear')) for (let i = 1; i < side.path.length; i++) {
      const a = side.path[i - 1], b = side.path[i], radius = input.options.request.clearWidthFt / 2;
      assert.ok(a.x === b.x || a.y === b.y);
      assert.ok(containsRect(free, { x: Math.min(a.x, b.x) - radius, y: Math.min(a.y, b.y) - radius, w: Math.abs(a.x - b.x) + radius * 2, h: Math.abs(a.y - b.y) + radius * 2 }));
    }
    summary.verified = true; summary.architecturalValidation = assessment;
    fs.writeFileSync(path.join(out, input.name + '-after.svg'), diagram(result.proposedPlan, input, input.name + ' / verified proposal'));
    for (const style of ['normal', 'rendered']) fs.writeFileSync(path.join(out, `${input.name}-after-${style}.svg`), renderPlanSvg(structuredClone(result.proposedPlan), { style }));
    if (persistRebuild) {
      const restored=JSON.parse(JSON.stringify(result.proposedPlan)), beforeRebuild=structuredClone(restored);
      const rebuilt=rebuildRepairedPlan(restored,input.survey,repairOptions);
      assert.deepEqual(restored,beforeRebuild);assert.equal(rebuilt.status,'rebuilt',rebuilt.reason);
      assert.deepEqual(validateEditedPlan(rebuilt.proposedPlan,input.survey),[]);
      for(const [index,level] of rebuilt.proposedPlan.levels.entries()) {
        const old=restored.levels[index];
        assert.deepEqual(buildFloorPassageModel(level),buildFloorPassageModel(old));
        for(const key of ['furniture','doors','windows','stairCore','verticalProfile','bedroomMeasurementBook','openingScheduleBook'])assert.deepEqual(level[key],old[key]);
      }
      const expected=structuredClone(restored), actual=rebuilt.proposedPlan;
      for(const key of rebuilt.rebuiltFields)expected[key]=structuredClone(actual[key]);
      for(const level of expected.levels) {
        const target=actual.levels.find(l=>l.level===level.level);
        for(const key of ['zones','facade','verticalProfile'])level[key]=structuredClone(target[key]);
        for(const room of level.rooms)for(const key of ['zone','openingIntent','adjacencyIntent','heightMeta'])room[key]=structuredClone(target.rooms.find(r=>r.id===room.id)[key]);
      }
      assert.deepEqual(actual,expected);
      assert.equal(assess(actual,input).assessment.status,'clear');
      assert.deepEqual(rebuilt.approach,result.after);
      summary.rebuild={status:rebuilt.status,geometryPreserved:true,measurementSource:result.measurementSource,rebuiltFields:rebuilt.rebuiltFields};
      fs.writeFileSync(path.join(out,input.name+'-rebuilt.json'),JSON.stringify(rebuilt,null,2));
      fs.writeFileSync(path.join(out,input.name+'-after-normal.svg'),rebuilt.sheets.normalSvg);
      fs.writeFileSync(path.join(out,input.name+'-after-rendered.svg'),rebuilt.sheets.renderedSvg);
      for(const view of ['front','rear','left','right'])fs.writeFileSync(path.join(out,`${input.name}-${view}-elevation.svg`),actual.elevations[view+'Svg']);
    }
  } else assert.equal(result.proposedPlan, undefined);
  summary.durationMs = Date.now() - started;
  report.results.push(summary);
  console.log(JSON.stringify({ name: summary.name, status: summary.status, strategy: summary.strategy, durationMs: summary.durationMs }));
}
report.finishedAt = new Date().toISOString();
report.sourceAndFixturesUnchanged = [...Object.entries(report.sourceHashes), ...Object.entries(report.fixtureHashes)].every(([file, hash]) => sha(file) === hash);
assert.equal(report.sourceAndFixturesUnchanged, true);
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Bedroom architectural constraints</title><style>body{font:16px system-ui;background:#faf8f3;margin:32px;line-height:1.5}p{max-width:100ch}.pair{display:flex;gap:16px;flex-wrap:wrap}.pair img{width:min(100%,650px)}a{color:#146442}</style><h1>Bedroom architectural checks</h1><p>${esc(report.scope)} Full-headboard wall support and declared window operating volumes are additional to the unchanged local approach request. Search limits are not proof of infeasibility. <a href="report.json">Full evidence</a>.</p>${report.results.map(r => `<h2>${esc(r.name)} — ${r.status}</h2><p>${esc(r.reason)}</p><div class="pair"><img alt="Original" src="${r.name}-before.svg">${r.verified ? `<img alt="Verified proposal" src="${r.name}-after.svg">` : ''}</div><p><a href="${r.name}-result.json">Result</a>${r.verified ? ` / <a href="${r.name}-after-normal.svg">Normal sheet</a> / <a href="${r.name}-after-rendered.svg">Rendered sheet</a>` : ''}${r.rebuild ? ` / <a href="${r.name}-rebuilt.json">Rebuilt plan and checks</a> / ${['front','rear','left','right'].map(view => `<a href="${r.name}-${view}-elevation.svg">${view} elevation</a>`).join(' / ')}` : ''}</p>`).join('')}</html>`);
console.log(out);
