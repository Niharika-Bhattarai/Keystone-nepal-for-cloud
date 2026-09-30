'use strict';
const { SURVEY_FIELDS } = require('./surveyFieldRegistry');
const { migrateSurvey } = require('./surveyMigration');

function parseSurveyNumber(value, spec) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const suffix = spec.suffix ? `(?:\\s*${spec.suffix})?` : '';
  const match = String(value).trim().match(new RegExp(`^(\\d+(?:\\.\\d+)?)${suffix}$`, 'i'));
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || (spec.integer && !Number.isInteger(parsed))) return null;
  if ((spec.exclusiveMin ? parsed <= spec.min : parsed < spec.min) || parsed > spec.max) return null;
  return parsed;
}

// Validate before legacy normalization. Missing fields remain compatible with
// historical defaults; explicitly malformed values must never become defaults.
function validateSurveyInput(raw) {
  const errors = [];
  const values = {};
  const add = (field, code, message) => errors.push({ field, code, message });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, values, errors: [{ field: 'surveyData', code: 'BRIEF_INVALID', message: 'A survey object is required.' }] };
  }
  for (const [field, spec] of Object.entries(SURVEY_FIELDS)) {
    const value = raw[field];
    if (value === undefined) continue;
    if (spec.type === 'number') {
      if (spec.optionalBlank && (value === null || value === '')) continue;
      const parsed = parseSurveyNumber(value, spec);
      if (parsed === null) add(field, 'BRIEF_INVALID', `${field} must be a finite ${spec.integer ? 'whole ' : ''}number ${spec.exclusiveMin ? 'greater than' : 'at least'} ${spec.min}${Number.isFinite(spec.max) ? ` and at most ${spec.max}` : ''} (${spec.units}).`);
      else values[field] = parsed;
    } else if (spec.type === 'text' && typeof value !== 'string') {
      add(field, 'BRIEF_INVALID', `${field} must be text.`);
    } else if (spec.type === 'choice' && (typeof value !== 'string' || !value.trim())) {
      add(field, 'BRIEF_INVALID', `${field} must be a named survey choice.`);
    } else if (spec.type === 'choice' && raw.surveyVersion === 2 && ![...spec.values, ...Object.keys(spec.aliases || {})].some(v => v.toLowerCase() === value.trim().toLowerCase())) {
      add(field, 'BRIEF_INVALID', `Unrecognized ${field}: choose one of ${spec.values.join(', ')}.`);
    } else if (spec.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) {
      add(field, 'BRIEF_INVALID', `${field} must be an object.`);
    } else if (spec.type === 'bedrooms' && value !== null && !Array.isArray(value)) {
      add(field, 'BRIEF_INVALID', `${field} must be an array of bedroom configurations.`);
    }
  }
  if (raw.surveyVersion !== undefined && ![1, 2, 'legacy-total-v1', 'legacy-secondary-v1'].includes(raw.surveyVersion)) add('surveyVersion', 'BRIEF_INVALID', 'Unknown survey version; the original survey has been retained.');
  if (typeof raw.features !== 'undefined' && typeof raw.features !== 'string') add('features', 'BRIEF_INVALID', 'Features must be a comma-separated list of named rooms.');
  else for (const chunk of require('./tile/normalizeBrief').unrecognizedFeatureRequests(raw.features)) {
    add('features', 'BRIEF_INVALID', `Unrecognized feature selection: ${chunk}. Choose a named room with a whole count from 1 to 32; layout support is checked separately.`);
  }
  if (values.privateBaths !== undefined && values.bathrooms !== undefined && values.privateBaths > values.bathrooms && raw.surveyVersion !== 'legacy-secondary-v1') add('privateBaths', 'PROGRAM_CONFLICT', 'Private bathrooms cannot exceed the total full bathroom count.');
  if (values.privateBaths !== undefined && values.bedrooms !== undefined && values.privateBaths > values.bedrooms && raw.surveyVersion !== 'legacy-secondary-v1') add('privateBaths', 'PROGRAM_CONFLICT', 'Attached household bathrooms cannot exceed the household bedroom count.');
  // A bedroom without its own bathroom needs a shared one. With every
  // bathroom attached to a bedroom, the rest would have to walk through
  // someone else's room (for example two bedrooms, one bathroom, and that
  // bathroom set as the primary ensuite).
  const attached = Array.isArray(raw.bedroomConfigs)
    ? raw.bedroomConfigs.filter(c => c?.privateBath === true || String(c?.privateBath || '').toLowerCase() === 'yes').length
    : values.privateBaths;
  if (attached !== undefined && values.bathrooms !== undefined && values.bedrooms !== undefined && raw.surveyVersion !== 'legacy-secondary-v1' &&
      attached < values.bedrooms && values.bathrooms - attached < 1) {
    add('privateBaths', 'PROGRAM_CONFLICT', 'Every bedroom without its own bathroom needs a shared one. Add a bathroom, or turn off an en-suite so that bathroom is shared.');
  }
  if (values.outdoorArea === 0 && raw.outdoorLiving && !/^none$/i.test(raw.outdoorLiving)) add('outdoorArea', 'PROGRAM_CONFLICT', 'Choose a positive area for the selected outdoor structure.');
  if (!errors.length) errors.push(...migrateSurvey(raw).ambiguities);
  // Do not accept a new serialization while downstream templates still read
  // legacy counts. Enable these versions only with bedroom-ID propagation.
  if (!errors.length && (raw.surveyVersion === 2 || raw.surveyVersion === 'legacy-secondary-v1' || raw.bedroomProgram !== undefined)) {
    add('surveyVersion', 'SURVEY_VERSION_NOT_IMPLEMENTED', 'This survey format is not yet supported by the layout engine. Its original selections have been retained.');
  }
  return { valid: errors.length === 0, values, errors };
}

function inputFailurePayload(contract) {
  const code = contract.errors.some(e => e.code === 'BRIEF_INVALID') ? 'BRIEF_INVALID' : contract.errors[0]?.code || 'BRIEF_INVALID';
  const classification = { BRIEF_INVALID: 'invalid_input', BRIEF_AMBIGUOUS: 'ambiguous_input',
    PROGRAM_CONFLICT: 'program_conflict', SURVEY_VERSION_NOT_IMPLEMENTED: 'implementation_gap' }[code] || 'unresolved';
  return { success: false, code, message: contract.errors[0]?.message || 'Check the survey values.',
    diagnostics: { classification, blockers: contract.errors } };
}
module.exports = { parseSurveyNumber, validateSurveyInput, inputFailurePayload };
