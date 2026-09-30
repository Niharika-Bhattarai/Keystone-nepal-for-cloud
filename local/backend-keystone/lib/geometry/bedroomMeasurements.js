'use strict';

const Ajv = require('ajv');
const { isDeepStrictEqual } = require('node:util');
const { createBedroomArchitecturalCheck } = require('./bedroomArchitecture');
const validateBook = new Ajv({ strict: false, allErrors: true }).compile(require('./bedroomMeasurementBookSchema.json'));

// A valid binding is not a passing layout. Conflicting arrangements must remain
// repairable using their original measurements; acceptance is checked separately.
function resolveBedroomMeasurements(level) {
  if (!Object.hasOwn(level, 'bedroomMeasurementBook')) return { records: [], errors: [] };
  const book = level.bedroomMeasurementBook;
  if (!validateBook(book)) return { records: [], errors: [{ code: 'BEDROOM_MEASUREMENTS_INVALID',
    message: 'A complete version 1 measurement book with explicit provenance is required.' }] };
  const errors = [], seen = new Set();
  for (const record of book.records) {
    let reason;
    if (record.levelNumber !== level.level) reason = 'Record belongs to another floor; explicitly rebind after relocation.';
    else if (seen.has(record.bedroomId)) reason = 'Duplicate bedroom measurement records.';
    else if (!(level.rooms || []).some(r => r.id === record.bedroomId && ['bedroom','primary_bedroom','guest_bedroom'].includes(r.type))) reason = 'Bedroom identity or type changed.';
    else {
      try {
        const compiled = createBedroomArchitecturalCheck(level, record.bedroomId, record.bedId, record.policy);
        if (compiled.status !== 'ready') reason = compiled.reason;
      } catch (error) { reason = `Invalid bound geometry: ${error.message}`; }
    }
    seen.add(record.bedroomId);
    if (reason) errors.push({ code: 'BEDROOM_MEASUREMENTS_STALE', bedroomId: record.bedroomId, message: reason });
  }
  return { records: errors.length ? [] : structuredClone(book.records), errors };
}

function bindBedroomMeasurements(level, { bedroomId, bedId, source, policy }) {
  const copy = structuredClone(level);
  if (Object.hasOwn(copy,'bedroomMeasurementBook') && !validateBook(copy.bedroomMeasurementBook)) throw new Error('Cannot replace an invalid/unsupported measurement book.');
  const records = (copy.bedroomMeasurementBook?.records || []).filter(r => r.bedroomId !== bedroomId);
  records.push({ levelNumber: copy.level, bedroomId, bedId, source: structuredClone(source), policy: structuredClone(policy) });
  copy.bedroomMeasurementBook = { version: 1, records };
  const resolved = resolveBedroomMeasurements(copy);
  if (resolved.errors.length) throw new Error(resolved.errors.map(e => e.message).join(' '));
  return copy;
}

function selectBedroomArchitecturePolicy(level, bedroomId, bedId, explicitPolicy) {
  const resolved = resolveBedroomMeasurements(level);
  if (resolved.errors.length) return { errors: resolved.errors };
  const record = resolved.records.find(r => r.bedroomId === bedroomId);
  if (record && (record.bedId !== bedId || (explicitPolicy !== undefined && !isDeepStrictEqual(explicitPolicy, record.policy)))) {
    return { errors: [{ code: 'BEDROOM_MEASUREMENTS_OVERRIDE', message: 'Explicit policy differs from persisted measurements; rebind the specification before repair.' }] };
  }
  return { policy: record?.policy ?? explicitPolicy, source: record?.source ?? null, errors: [] };
}

module.exports = { bindBedroomMeasurements, resolveBedroomMeasurements, selectBedroomArchitecturePolicy };
