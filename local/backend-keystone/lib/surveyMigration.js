'use strict';

// Pure migration of intent only. It must not decide what the layout engine can
// fit, assign structural defaults, or rewrite the user's submitted bath budget.
function migrateSurvey(rawSurvey, sourceVersion = rawSurvey?.surveyVersion ?? null) {
  const original = structuredClone(rawSurvey);
  const survey = structuredClone(rawSurvey);
  const appliedMigrations = [];
  const ambiguities = [];
  const add = (field, code, message) => ambiguities.push({ field, code, message });
  if (!survey || typeof survey !== 'object' || Array.isArray(survey)) {
    return { original, survey, targetVersion: 2, sourceVersion, appliedMigrations,
      ambiguities: [{ field: 'surveyData', code: 'BRIEF_INVALID', message: 'A survey object is required.' }] };
  }
  if (![null, 1, 2, 'legacy-total-v1', 'legacy-secondary-v1'].includes(sourceVersion)) add('surveyVersion', 'BRIEF_INVALID', 'Unknown survey version.');
  const count = value => {
    const match = /^(\d+)(?:\s+(?:Beds?|Bedrooms?|Baths?|Bathrooms?|Story|Stories))?$/i.exec(String(value ?? '').trim());
    return match ? Number(match[1]) : null;
  };
  const bedrooms = count(survey.bedrooms) ?? (count(survey.stories) === 2 ? 3 : 2);
  const fullBaths = count(survey.bathrooms);
  const aggregate = count(survey.privateBaths);
  const configs = survey.bedroomProgram ?? survey.bedroomConfigs;
  let program;
  if (configs !== undefined && configs !== null && !Array.isArray(configs)) {
    add('bedroomConfigs', 'BRIEF_INVALID', 'Bedroom configurations must be an array.');
  } else if (Array.isArray(configs)) {
    if (configs.length !== bedrooms) add('bedroomConfigs', 'BRIEF_INVALID', `Provide one configuration for each of the ${bedrooms} bedrooms.`);
    program = configs.map((config, index) => {
      const id = index === 0 ? 'primary' : `bedroom_${index + 1}`;
      const bath = config?.privateBath;
      const closet = config?.closet;
      const legacyUnspecified = survey.bedroomProgramSource === 'legacy_aggregate';
      if (![true, false, 'Yes', 'No'].includes(bath) && !(legacyUnspecified && bath === null)) add(`bedroomConfigs.${index}.privateBath`, 'BRIEF_INVALID', 'Choose Yes or No for the private bathroom.');
      if (!['Walk-in', 'Standard', 'Small', 'walk_in', 'reach_in'].includes(closet) && !(legacyUnspecified && closet === null)) add(`bedroomConfigs.${index}.closet`, 'BRIEF_INVALID', 'Choose a walk-in or standard closet.');
      if (config?.programId && config.programId !== id) add(`bedroomProgram.${index}.programId`, 'BRIEF_INVALID', `Expected stable bedroom identity ${id}.`);
      return { programId: id, privateBath: bath === null ? null : bath === true || bath === 'Yes',
        closet: closet === null ? null : ['Walk-in', 'walk_in'].includes(closet) ? 'walk_in' : 'reach_in' };
    });
    const configured = program.filter(b => b.privateBath).length;
    const interpreted = sourceVersion === 'legacy-secondary-v1' && aggregate !== null ? aggregate + 1 : aggregate;
    if (interpreted !== null && interpreted !== configured) add('privateBaths', sourceVersion === null ? 'BRIEF_AMBIGUOUS' : 'PROGRAM_CONFLICT',
      `The bedroom selections request ${configured} attached bathrooms, but the aggregate requests ${interpreted}. Choose which count to use.`);
  } else {
    // Known total-count serialization includes primary; the named secondary
    // adapter is only applied when its source format is actually declared.
    const total = aggregate === null ? null : aggregate + (sourceVersion === 'legacy-secondary-v1' ? 1 : 0);
    program = Array.from({ length: bedrooms }, (_, index) => ({
      programId: index === 0 ? 'primary' : `bedroom_${index + 1}`,
      privateBath: total === null ? null : index < total,
      closet: null,
    }));
    if (total !== null && total > bedrooms) add('privateBaths', 'PROGRAM_CONFLICT', 'Attached household bathrooms exceed the household bedroom count.');
    if (sourceVersion !== 2) appliedMigrations.push('legacy-aggregate-to-bedroom-identities');
    survey.bedroomProgramSource = 'legacy_aggregate';
  }
  if (program) {
    const attached = program.some(b => b.privateBath === null) ? null : program.filter(b => b.privateBath).length;
    if (survey.privateBathCount !== undefined && count(survey.privateBathCount) !== attached) add('privateBathCount', 'PROGRAM_CONFLICT', 'The attached bathroom total conflicts with the per-bedroom selections.');
    if (fullBaths !== null && attached !== null && attached > fullBaths) add('bathrooms', 'PROGRAM_CONFLICT', 'The full bathroom total must include all selected attached bathrooms.');
    const shared = count(survey.sharedBathroomCount);
    if (fullBaths !== null && attached !== null && shared !== null && attached + shared !== fullBaths) add('sharedBathroomCount', 'PROGRAM_CONFLICT', 'Shared and attached bathrooms must add up to the total full bathroom count.');
    survey.bedroomProgram = program;
    if (attached !== null) {
      survey.privateBathCount = attached;
      // Canonical serialization uses a total, including primary. Keep the
      // source aggregate unchanged in original, not in this derived field.
      if (!ambiguities.length) survey.privateBaths = String(attached);
    }
  }
  const features = String(survey.features || '').split(',').map(s => s.trim()).filter(s => s && !/^(none|n\/a)$/i.test(s));
  if (sourceVersion === 1 && features.some(s => /^1 Study$/i.test(s)) && features.some(s => /^1 Home Office$/i.test(s))) {
    survey.features = features.filter(s => !/^1 Home Office$/i.test(s)).join(', ');
    appliedMigrations.push('vite-v1-study-office-picker-alias');
  }
  // Saved guest-room-only sessions retain their meaning. New v2 surveys ask
  // for a guest bedroom AND private bath within the submitted bath budget.
  const guestSuiteCount = features.reduce((sum, part) => {
    const match = /^(?:(\d+)\s+)?Guest Suite$/i.exec(part);
    return sum + (match ? Number(match[1] || 1) : 0);
  }, 0);
  survey.guestSuiteSemantics = survey.guestSuiteSemantics || (sourceVersion === 2 ? 'bedroom_and_private_bath' : 'legacy_guest_room_only');
  if (guestSuiteCount && survey.guestSuiteSemantics === 'bedroom_and_private_bath' && fullBaths !== null && (survey.privateBathCount || 0) + guestSuiteCount > fullBaths) add('bathrooms', 'PROGRAM_CONFLICT', 'The selected guest suite private bathroom must fit within the total full bathroom count.');
  survey.surveyVersion = 2;
  return { original, survey, targetVersion: 2, sourceVersion, appliedMigrations, ambiguities };
}
module.exports = { migrateSurvey };
