'use strict';

const { buildWallModel } = require('./wallModel');
const { hostWallFor } = require('./clearanceGeometry');
const { validateOpeningGeometry } = require('../openingGeometry');
const { intersection, subtract, union, unionArea } = require('./rectBoolean');
const { resolveOpeningSchedules } = require('./openingIdentity');

const EPS = 1e-7;
const clip = (rects, envelope) => union(rects.flatMap(rect => envelope.map(part => intersection(rect, part)).filter(Boolean)));
const wallRect = wall => wall.orientation === 'vertical'
  ? { x: wall.axisFt - wall.assembly.thicknessFt / 2, y: wall.startFt, w: wall.assembly.thicknessFt, h: wall.lengthFt }
  : { x: wall.startFt, y: wall.axisFt - wall.assembly.thicknessFt / 2, w: wall.lengthFt, h: wall.assembly.thicknessFt };
const spanRect = (door, start, width, thickness) => door.dir === 'vertical'
  ? { x: door.x - thickness / 2, y: start, w: thickness, h: width }
  : { x: start, y: door.y - thickness / 2, w: width, h: thickness };

// P04 floor-plane accounting only. Default schedules resolve the versioned book
// by opening identity and an exact geometry binding. Explicit indexed arrays are
// supported for read-only diagnostics only; never persist that association.
// No defaults turn a nominal width into a measured aperture. Reservations for
// frames and an open leaf conservatively span the entire reveal depth. This is
// not a 3D frame model, a door-swing test, or a continuous-route certification.
function buildFloorPassageModel(level, schedules) {
  const base = buildWallModel(level);
  const errors = base.errors.map(error => ({ ...error }));
  if (schedules === undefined) {
    const resolved = resolveOpeningSchedules(level);
    schedules = resolved.schedules;
    errors.push(...resolved.errors);
  }
  const incomplete = [], openings = [], accepted = [];
  const envelope = union([...base.roomClear.flatMap(room => room.parts), ...base.wallSolids]);
  const doors = level?.doors || [];
  const nominalErrors = validateOpeningGeometry(level);
  errors.push(...nominalErrors.map(message => ({ code: 'OPENING_GEOMETRY_INVALID', message })));
  if (!Array.isArray(schedules)) {
    errors.push({ code: 'OPENING_SCHEDULE_INVALID', message: 'Schedules must be an array indexed by the current door list.' });
    schedules = [];
  }
  if (schedules.length > doors.length) errors.push({ code: 'ORPHAN_OPENING_SCHEDULE', message: 'A schedule has no corresponding opening.' });
  for (const [index, door] of doors.entries()) {
    const entry = { index, openingId: door.id ?? null, rooms: [door.a, door.b], status: 'incomplete' };
    openings.push(entry);
    const schedule = schedules[index];
    if (!schedule) {
      incomplete.push({ code: 'OPENING_SCHEDULE_REQUIRED', openingIndex: index });
      continue;
    }
    const fail = (code, message) => { entry.status = 'invalid'; errors.push({ code, openingIndex: index, message }); };
    const fields = ['roughWidthFt', 'frameStartFt', 'frameEndFt', 'leafProjectionFt'];
    if (fields.some(key => !Number.isFinite(schedule[key]) || schedule[key] < 0) ||
        !['start', 'end', 'none'].includes(schedule.leafSide) ||
        typeof schedule.basis !== 'string' || !schedule.basis.trim() ||
        (schedule.leafSide === 'none' && schedule.leafProjectionFt !== 0)) {
      fail('OPENING_SCHEDULE_INVALID', 'Finite nonnegative dimensions, leaf side and a stated schedule basis are required.');
      continue;
    }
    const nominal = door.width;
    const clearWidthFt = schedule.roughWidthFt - schedule.frameStartFt - schedule.frameEndFt - schedule.leafProjectionFt;
    if (!['vertical', 'horizontal'].includes(door.dir) || !Number.isFinite(door.x) || !Number.isFinite(door.y) ||
        !Number.isFinite(nominal) || nominal <= 0 || schedule.roughWidthFt < nominal - EPS ||
        clearWidthFt <= EPS || clearWidthFt > nominal + EPS) {
      fail('OPENING_DIMENSIONS_INVALID', 'Rough width must contain the nominal opening and a positive clear aperture no larger than nominal.');
      continue;
    }
    const host = hostWallFor({ ...door, width: schedule.roughWidthFt }, base.walls);
    const axis = door.dir === 'vertical' ? door.x : door.y;
    if (!host || Math.abs(host.axisFt - axis) > EPS) {
      fail('ROUGH_OPENING_OUTSIDE_HOST', 'The entire rough opening must lie on its actual host wall and room pair.');
      continue;
    }
    const center = door.dir === 'vertical' ? door.y : door.x;
    const start = center - schedule.roughWidthFt / 2;
    const clearStart = start + schedule.frameStartFt + (schedule.leafSide === 'start' ? schedule.leafProjectionFt : 0);
    const rough = spanRect(door, start, schedule.roughWidthFt, host.assembly.thicknessFt);
    const clear = spanRect(door, clearStart, clearWidthFt, host.assembly.thicknessFt);
    const hostIds = new Set(host.hostWallIds);
    const others = base.walls.filter(wall => !hostIds.has(wall.id)).map(wallRect);
    if (others.some(rect => intersection(rough, rect))) {
      fail('ROUGH_OPENING_WALL_CONFLICT', 'The rough opening intersects another wall or junction.');
      continue;
    }
    if (accepted.some(other => intersection(rough, other.rough))) {
      fail('ROUGH_OPENINGS_OVERLAP', 'Two framed openings consume the same wall space.');
      continue;
    }
    Object.assign(entry, { status: 'scheduled_geometry', basis: schedule.basis,
      hostWallIds: [...hostIds], nominalWidthFt: nominal, roughWidthFt: schedule.roughWidthFt,
      clearWidthFt, rough, clear, frameStartFt: schedule.frameStartFt,
      frameEndFt: schedule.frameEndFt, leafProjectionFt: schedule.leafProjectionFt, leafSide: schedule.leafSide });
    accepted.push({ rough, clear });
  }
  // Fail closed for malformed nominal openings; never cut a misleading passage
  // based on a malformed wall/opening model. Missing schedules retain solid wall.
  const useCuts = base.errors.length === 0 && nominalErrors.length === 0;
  const roughVoids = useCuts ? clip(accepted.map(item => item.rough), base.wallSolids) : [];
  const passageParts = useCuts ? clip(accepted.map(item => item.clear), roughVoids) : [];
  const wallSolids = subtract(base.wallSolids, roughVoids);
  const assemblyReservations = subtract(roughVoids, passageParts);
  const partition = { nominalAreaSqFt: unionArea(envelope), roomClearAreaSqFt: unionArea(base.roomClear.flatMap(room => room.parts)),
    wallSolidAreaSqFt: unionArea(wallSolids), assemblyReservationAreaSqFt: unionArea(assemblyReservations),
    passageAreaSqFt: unionArea(passageParts) };
  partition.residualSqFt = partition.nominalAreaSqFt - partition.roomClearAreaSqFt - partition.wallSolidAreaSqFt -
    partition.assemblyReservationAreaSqFt - partition.passageAreaSqFt;
  return { version: 'floor-passages-v1', level: level?.level, status: errors.length ? 'invalid' : incomplete.length ? 'incomplete' : 'scheduled_geometry',
    coordinateBasis: base.coordinateBasis, constructionVerified: false, continuousRoutesChecked: false,
    openingVoidsIncluded: useCuts && accepted.length > 0, openings, errors, incomplete, roomClear: base.roomClear,
    wallSolids, roughVoids, assemblyReservations, passageParts, partition,
    limitations: ['Wall assemblies retain stated measurement assumptions.', 'Exterior wall halves outside the nominal envelope are excluded.',
      'Windows retain wall below their sill; this model does not infer floor passage from glazing.',
      'Frames and open leaves reserve full-depth bands; swing, headroom, thresholds and continuous routes require separate checks.'] };
}

module.exports = { buildFloorPassageModel };
