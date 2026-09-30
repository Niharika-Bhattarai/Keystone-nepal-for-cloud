'use strict';

const { createHash } = require('node:crypto');
const kindOf = door => door.garageDoor ? 'garage' : door.openThreshold ? 'threshold' :
  door.sliding || door.slidingDoor ? 'sliding' : door.cased ? 'cased' : 'hinged';
const keyOf = (level, door) => JSON.stringify([level.level, [door.a, door.b].map(String).sort(), kindOf(door)]);
const bindingOf = door => ({ a: door.a, b: door.b, kind: kindOf(door),
  x: door.x, y: door.y, dir: door.dir, width: door.width });
const sameBinding = (a, b) => a && Object.keys(b).every(key => a[key] === b[key]);

// Connection identity survives regeneration, position/width changes and array
// reordering. Multiple openings on one room-pair require explicit identity
// resolution before a project schedule can be attached; never guess a match.
function assignOpeningIds(level) {
  const groups = new Map();
  for (const door of level.doors || []) {
    const key = keyOf(level, door);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(door);
  }
  for (const [key, doors] of groups) {
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
    doors.sort((a, b) => String(a.dir).localeCompare(String(b.dir)) || a.x - b.x || a.y - b.y);
    doors.forEach((door, index) => { door.id = `opening:${hash}:${index + 1}`; });
  }
  return level;
}

function bindOpeningSchedule(level, openingId, dimensions) {
  const copy = structuredClone(level);
  assignOpeningIds(copy);
  const door = copy.doors.find(item => item.id === openingId);
  if (!door) throw new Error('Opening identity is missing or stale.');
  if (copy.doors.filter(item => keyOf(copy, item) === keyOf(copy, door)).length !== 1) {
    throw new Error('Multiple openings on this connection require explicit identity resolution.');
  }
  if (copy.openingScheduleBook && copy.openingScheduleBook.version !== 1) throw new Error('Unsupported opening schedule version.');
  const book = copy.openingScheduleBook || { version: 1, records: [] };
  if (!Array.isArray(book.records)) throw new Error('Opening schedule records must be an array.');
  book.records = book.records.filter(record => record.openingId !== openingId);
  book.records.push({ openingId, binding: bindingOf(door), dimensions: structuredClone(dimensions) });
  copy.openingScheduleBook = book;
  return copy;
}

function resolveOpeningSchedules(level) {
  const errors = [], schedules = (level.doors || []).map(() => null);
  const book = level.openingScheduleBook;
  if (!Object.hasOwn(level, 'openingScheduleBook')) return { schedules, errors };
  if (!book || book.version !== 1 || !Array.isArray(book.records)) {
    return { schedules, errors: [{ code: 'OPENING_SCHEDULE_BOOK_INVALID', message: 'A version 1 opening schedule book with records is required.' }] };
  }
  const expected = assignOpeningIds({ level: level.level, doors: (level.doors || []).map(door => ({ ...door })) });
  const seen = new Set();
  for (const record of book.records) {
    const index = (level.doors || []).findIndex(door => door.id === record?.openingId);
    const door = level.doors?.[index];
    let message = null;
    if (!record || typeof record.openingId !== 'string' || seen.has(record.openingId)) message = 'Missing or duplicate schedule identity.';
    else if (!door || expected.doors[index].id !== record.openingId) message = 'Scheduled opening is missing or its identity changed.';
    else if (level.doors.filter(item => keyOf(level, item) === keyOf(level, door)).length !== 1) message = 'Scheduled connection has ambiguous multiple openings.';
    else if (!sameBinding(record.binding, bindingOf(door))) message = 'Opening moved, rotated, resized or changed hosts; rebind the project schedule after review.';
    else if (!record.dimensions || typeof record.dimensions !== 'object') message = 'Opening schedule dimensions are missing.';
    if (message) errors.push({ code: 'OPENING_SCHEDULE_STALE', openingId: record?.openingId, message });
    else schedules[index] = record.dimensions;
    if (record) seen.add(record.openingId);
  }
  // Duplicate records must not leave the first copy eligible to cut a passage.
  if (errors.length) schedules.fill(null);
  return { schedules, errors };
}

module.exports = { assignOpeningIds, bindOpeningSchedule, resolveOpeningSchedules };
