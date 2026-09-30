'use strict';

// Diagnostic only: attach explicitly labelled assumptions to a clone, never to
// the source response. Probe room-centre routes, not accessibility certification.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { assignOpeningIds, bindOpeningSchedule, resolveOpeningSchedules } = require('../../lib/geometry/openingIdentity');
const { buildFloorPassageModel } = require('../../lib/geometry/floorPassageModel');
const { checkLevelClearRoute } = require('../../lib/geometry/clearRoute');
const { OPENING_ALLOWANCES } = require('../../lib/geometry/clearanceGeometry');
const backend = path.resolve(__dirname, '../..');
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/benchmark/clear-route-audit.js <saved-response.json> [output-directory]');
const inputBytes = fs.readFileSync(input);
const data = JSON.parse(inputBytes), body = data.body || data;
const plans = body.planSpec ? [body.planSpec, ...(body.alternatives || []).map(item => item.planSpec)] : [body.plan || body];
if (plans.some(plan => !Array.isArray(plan?.levels))) throw new Error('Input must contain plans with levels.');
const out = path.resolve(process.argv[3] || path.join(backend, '../tmp/universal-coverage',
  `${new Date().toISOString().replace(/[:.]/g, '-')}-clear-route-audit`));
fs.mkdirSync(out, { recursive: true });
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = { source: path.resolve(input), sourceSha256: sha(inputBytes), generatedAt: new Date().toISOString(),
  backendHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: backend, encoding: 'utf8' }).trim(),
  sourceHashes: {},
  scope: 'Assumed assemblies; square floor footprint between largest clear-part centres. No stair, door-swing, wheelchair turning or code certification.',
  floors: [], routes: [] };
for (const rel of execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'lib', 'api'], { cwd: backend, encoding: 'utf8' }).trim().split(/\r?\n/)) {
  report.sourceHashes[rel] = sha(fs.readFileSync(path.join(backend, rel)));
}
function roomPath(level, start, goal) {
  const paths = [[start]], seen = new Set([start]);
  for (let i = 0; i < paths.length; i++) {
    const current = paths[i];
    if (current.at(-1) === goal) return current;
    for (const door of level.doors) {
      const next = door.a === current.at(-1) ? door.b : door.b === current.at(-1) ? door.a : null;
      const room = level.rooms.find(r => r.id === next);
      if (!room || seen.has(next) || (next !== goal && room.type !== 'hallway')) continue;
      seen.add(next); paths.push([...current, next]);
    }
  }
  return null;
}
function centre(model, id) {
  const part = [...model.roomClear.find(room => room.roomId === id).parts].sort((a,b) => b.w*b.h-a.w*a.h)[0];
  return { x: part.x + part.w/2, y: part.y + part.h/2 };
}
function draw(name, model, level, req, result) {
  const parts = model.roomClear.flatMap(r => r.parts);
  const minX = Math.min(...parts.map(p => p.x)), minY = Math.min(...parts.map(p => p.y));
  const w = Math.max(...parts.map(p => p.x+p.w)) - minX, h = Math.max(...parts.map(p => p.y+p.h)) - minY;
  const rects = (items, fill) => items.map(p => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${fill}"/>`).join('');
  const line = result.path?.length ? `<polyline points="${result.path.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#138156" stroke-width="${req.clearWidthFt}" stroke-opacity="0.25" stroke-linejoin="miter" stroke-linecap="square"/><polyline points="${result.path.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#096143" stroke-width="0.13"/>` : '';
  const marks = [req.from, req.to].map((p,i) => `<circle cx="${p.x}" cy="${p.y}" r="0.32" fill="#8e2855"/><text x="${p.x+0.5}" y="${p.y-0.5}" font-size="0.6">${i ? 'To' : 'From'}</text>`).join('');
  fs.writeFileSync(path.join(out, name+'.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1400" viewBox="${minX-1} ${minY-5} ${w+2} ${h+7}"><rect x="${minX-1}" y="${minY-5}" width="${w+2}" height="${h+7}" fill="#faf8f3"/><g font-family="sans-serif"><text x="${minX}" y="${minY-3.7}" font-size="0.8">${escape(name)}: ${escape(result.status)}</text><text x="${minX}" y="${minY-2.4}" font-size="0.52">${escape(report.scope)}</text><text x="${minX}" y="${minY-1.3}" font-size="0.55">Probe width ${(req.clearWidthFt*12).toFixed(0)} in; furniture included; route applies only to selected rooms</text>${rects(parts,'#e9e5dc')}${rects(model.wallSolids,'#303b40')}${rects(model.assemblyReservations,'#d69532')}${rects(model.passageParts,'#8ace9f')}${rects(level.furniture || [],'#b4aaa0')}${line}${marks}</g></svg>`);
}
for (const [index, plan] of plans.entries()) for (const original of plan.levels) {
  let level = assignOpeningIds(structuredClone(original));
  if (Object.hasOwn(level, 'openingScheduleBook')) throw new Error('Audit assumption binding requires an unscheduled input; do not overwrite project schedules.');
  for (const door of [...level.doors]) {
    if (door.garageDoor || door.sliding || door.slidingDoor || door.openThreshold || door.cased) continue;
    level = bindOpeningSchedule(level, door.id, {
      roughWidthFt: door.width + 2*OPENING_ALLOWANCES.jambPerSideFt,
      frameStartFt: OPENING_ALLOWANCES.jambPerSideFt, frameEndFt: OPENING_ALLOWANCES.jambPerSideFt,
      leafProjectionFt: OPENING_ALLOWANCES.doorStopAndLeafFt, leafSide: 'start',
      basis: 'DIAGNOSTIC ASSUMPTION: conventional allowances and illustrative leaf side; not product/hinge measurements',
    });
  }
  const model = buildFloorPassageModel(level), prefix = `option-${index+1}-level-${level.level}`;
  const restored = JSON.parse(JSON.stringify(level)); restored.doors.reverse();
  const changed = structuredClone(level), scheduledDoor = changed.doors.find(d => changed.openingScheduleBook?.records.some(r => r.openingId === d.id));
  if (scheduledDoor) scheduledDoor.width -= 0.25;
  report.floors.push({ name: prefix, physicalStatus: model.status, errors: model.errors, missingSchedules: model.incomplete.length,
    partitionResidual: model.partition.residualSqFt, restoreErrors: resolveOpeningSchedules(restored).errors,
    resizedScheduleRejected: scheduledDoor ? resolveOpeningSchedules(changed).errors.length > 0 : null });
  fs.writeFileSync(path.join(out, prefix+'-assumed-level.json'), JSON.stringify(level, null, 2));
  const halls = level.rooms.filter(r => r.type === 'hallway').sort((a,b) => b.w*b.h-a.w*a.h);
  if (!halls.length || model.errors.length) continue;
  for (const room of level.rooms.filter(r => ['bedroom','primary_bedroom'].includes(r.type))) {
    const allowedRoomIds = roomPath(level, halls[0].id, room.id);
    if (!allowedRoomIds) {
      report.routes.push({ floor: prefix, roomId: room.id, status: 'not_checked', reason: 'No hallway-only connection found.' });
      continue;
    }
    for (const clearWidthFt of [2.5,3,3.5,4]) {
      const req = { allowedRoomIds, clearWidthFt, from: centre(model, halls[0].id), to: centre(model, room.id) };
      const withFurniture = checkLevelClearRoute(level, req), shellOnly = checkLevelClearRoute(level, { ...req, includeFurniture: false });
      const name = `${prefix}-${room.id}-${clearWidthFt*12}in`;
      report.routes.push({ name, floor: prefix, roomId: room.id, request: req, withFurniture, shellOnly });
      if (clearWidthFt === 3) draw(name, model, level, req, withFurniture);
    }
  }
}
report.sourceUnchanged = sha(fs.readFileSync(input)) === report.sourceSha256;
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Finished route probes</title><style>body{font:16px system-ui;background:#faf8f3;margin:24px}img{width:100%;max-width:1300px}p{max-width:95ch}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #ccc;text-align:left}</style><h1>Finished route probes</h1><p>${escape(report.scope)} These are diagnostic width requests, not statutory minimums. A blocked room-centre probe does not prove the whole room inaccessible. Missing schedules remain unverified. <a href="report.json">Full evidence</a>.</p><table><tr><th>Floor / room</th><th>Width</th><th>With furniture</th><th>Shell only</th></tr>${report.routes.map(r=>`<tr><td>${escape(r.floor)} / ${escape(r.roomId)}</td><td>${r.request ? r.request.clearWidthFt*12+' in' : '-'}</td><td>${escape(r.withFurniture?.status || r.status)}</td><td>${escape(r.shellOnly?.status || '-')}</td></tr>`).join('')}</table>${report.routes.filter(r=>r.request?.clearWidthFt===3).map(r=>`<h2>${escape(r.name)}</h2><p>${escape(r.withFurniture.reason || 'Continuous square-footprint route found under the stated assumptions.')}</p><img alt="${escape(r.name)}" src="${r.name}.svg">`).join('')}</html>`);
const counts = property => report.routes.reduce((totals,r) => { const status = r[property]?.status || r.status; totals[status] = (totals[status]||0)+1; return totals; }, {});
console.log(JSON.stringify({ out, floors: report.floors.length, routes: report.routes.length,
  withFurniture: counts('withFurniture'), shellOnly: counts('shellOnly'), sourceUnchanged: report.sourceUnchanged }));
if (!report.sourceUnchanged || report.floors.some(f=>f.errors.length || f.restoreErrors.length || f.resizedScheduleRejected === false)) process.exitCode = 1;
