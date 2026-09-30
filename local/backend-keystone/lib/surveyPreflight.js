'use strict';

const { normalizeBrief, parseFeatureRequests } = require('./tile/normalizeBrief');
const { validateSurveyInput, inputFailurePayload } = require('./briefContract');
const {capabilityFailurePayload}=require('./surveyCapabilities');
const { resolveArchitectV2Support } = require('./residential/v2/supportMatrix');
const { interpretBriefV2 } = require('./residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('./residential/v2/candidateFootprintsV2');

const FEATURE_CHOICES = Object.freeze([
  ['Study', 'Study / home office'], ['Home Theater', 'Home Theater'],
  ['Gym', 'Gym'], ['Gaming Room', 'Gaming Room'], ['Library', 'Library'],
  ['Wine Cellar', 'Wine Cellar'], ['Music Room', 'Music Room'],
  ['Guest Suite', 'Guest Suite'], ['Playroom', 'Playroom'],
]);

// Use the production support rules for the *resulting combination*, including
// area, stories and bedroom count. A fixed number-of-chips cap drifts as layout
// families gain support and wrongly rejects the supported two-room families.
function featureChoices(surveyData) {
  const parts = String(surveyData.features || '').split(',').map(s => s.trim())
    .filter(s => s && !/^(none|n\/a)$/i.test(s));
  const requested = normalizeBrief(surveyData).requestedFeatureItems;
  return FEATURE_CHOICES.map(([value, label]) => {
    const type = parseFeatureRequests(value)[0]?.canonicalType;
    const selected = requested.some(item => item.canonicalType === type);
    if (selected) return { value, label, selected: true, allowed: true, blockers: [] };
    const candidate = normalizeBrief({ ...surveyData, features: [...parts, `1 ${value}`].join(', ') });
    const support = resolveArchitectV2Support(candidate);
    return { value, label, selected: false, allowed: support.supported,
      blockers: support.reasons.filter(code => code !== 'house_pattern_not_supported').map(explainReason) };
  });
}

const REASONS = {
  primary_without_ensuite_topology_not_supported: ['bedroomConfigs', 'A primary bedroom with no ensuite is currently supported in single-storey homes where every bathroom is shared. Two-storey homes, and plans where another bedroom still has its own ensuite, need a bathroom-access layout the generator cannot build yet. Your selections have been kept.'],
  area_too_small_for_v2: ['totalArea', 'Choose at least 1,000 sq ft.'],
  stories_out_of_range: ['stories', 'The generator currently supports one or two storeys.'],
  bedrooms_out_of_range: ['bedrooms', 'The generator currently supports two to five bedrooms.'],
  bathrooms_out_of_range: ['bathrooms', 'This number of bathrooms is not available yet together with special rooms, extra en-suites or a main-floor primary suite in a two-storey home. Change the number of bathrooms or those choices.'],
  shape_not_supported: ['shape', 'Keystone cannot generate this footprint shape yet. Choose Standard Rectangle, Wide Rectangle, or Deep Rectangle before generating.'],
  outdoor_structure_not_supported: ['outdoorLiving', 'Decks, patios, and porches do not yet have validated placement in this generator. Outdoor door connections are supported; the separate outdoor structure is not yet supported.'],
  lot_context_not_supported: ['lotContext', 'This site setting does not yet have a supported layout family.'],
  garage_type_not_supported: ['garage', 'Choose no garage, a one-car garage, or a two-car garage.'],
  feature_type_not_supported: ['features', 'One or more requested special rooms could not be recognised. Choose a named room from the survey.'],
  multiple_feature_rooms_not_supported: ['features', 'This special-room combination is not yet supported. Supported two-room briefs need two storeys, three bedrooms and three bathrooms, including a study, library, or guest bedroom, from 2,600 sq ft. Study and gym need 3,000 sq ft; library and gym need 3,200 sq ft. Gaming room plus playroom needs at least 3,200 sq ft, a rectangular layout, one-car garage and an upstairs primary bedroom.'],
  feature_rooms_not_supported: ['features', 'This house does not yet have a layout for the requested special rooms.'],
  study_gym_combo_out_of_scope: ['features', 'Study and gym together need a supported two-storey brief: three bedrooms/three bathrooms from 3,000 sq ft, or four bedrooms/four bathrooms with a garage from 3,200 sq ft.'],
  library_gym_combo_out_of_scope: ['features', 'Library and gym together currently need two storeys, three bedrooms, three bathrooms, and at least 3,200 sq ft.'],
  one_story_garage_feature_rooms_not_supported: ['features', 'Special rooms in single-storey garage layouts are not yet supported.'],
  one_story_large_feature_rooms_not_supported: ['features', 'Special rooms in single-storey four- or five-bedroom layouts are not yet supported.'],
  private_bath_count_not_supported: ['privateBaths', 'This layout family cannot yet provide the selected number of private bathrooms.'],
  two_story_primary_level_not_supported: ['masterLocation', 'This main-floor primary suite combination is not supported yet. A two-storey home with the primary suite on the main floor needs two to five bedrooms, the primary en-suite as its only private bathroom, standard ceilings and doorways, a rectangular shape and no extra feature rooms. Choose an upstairs primary suite, or change the home to one storey.'],
  two_story_bedroom_count_not_supported: ['bedrooms', 'This two-storey bedroom count is not yet supported.'],
  one_story_bedroom_count_not_supported: ['bedrooms', 'This single-storey bedroom count is not yet supported.'],
  five_bed_feature_rooms_not_supported: ['features', 'The five-bedroom two-storey family uses its ground-floor room as the fifth bedroom; additional special rooms are not yet supported.'],
  front_facing_not_supported: ['frontFacing', 'Choose north, south, east, or west for the front direction.'],
  house_pattern_not_supported: ['stories', 'No current layout family matches all of these choices.'],
};

function explainReason(code) {
  if (REASONS[code]) return { code, field: REASONS[code][0], message: REASONS[code][1] };
  const measured = code.match(/^measured_area_ranges_(.+)$/);
  if (measured) {
    const sqft = n => Number(n).toLocaleString('en-US');
    const ranges = measured[1].split('_').map(r => r.split('-')).map(([a, b]) => a === b ? `${sqft(a)} sq ft` : `${sqft(a)} to ${sqft(b)} sq ft`);
    return { code, field: 'totalArea', message: `This home is available from ${ranges.join(', or ')}. Change the size, or the number of bedrooms, bathrooms or garage spaces.` };
  }
  const closets = code.match(/^closet_area_ranges_(.+)$/);
  if (closets?.[1] === 'none') return { code, field: 'bedroomConfigs', message: 'A walk-in closet does not fit this home at any size yet. Choose standard closets instead of a walk-in.' };
  if (closets) {
    const sqft = n => Number(n).toLocaleString('en-US');
    const ranges = closets[1].split('_').map(r => r.split('-')).map(([a, b]) => a === b ? `${sqft(a)} sq ft` : `${sqft(a)} to ${sqft(b)} sq ft`);
    return { code, field: 'bedroomConfigs', message: `The closets chosen need more room at this size: with them, this home is available from ${ranges.join(', or ')}. Choose standard closets instead of a walk-in, or a larger home.` };
  }
  if (code === 'home_type_not_available') return { code, field: 'bedrooms', message: 'There is no layout yet for this combination of bedrooms, bathrooms and garage. Try another bathroom count or garage size.' };
  const area = code.match(/requires_min_(\d+)_sqft$/);
  if (area) return { code, field:'totalArea', message:`This room and garage combination currently needs at least ${Number(area[1]).toLocaleString('en-US')} sq ft in the generator.` };
  return { code, field:'features', message:'The current generator cannot yet combine these choices.' };
}

function preflightSurvey(surveyData) {
  const contract = validateSurveyInput(surveyData);
  if (!contract.valid) {
    const failure = inputFailurePayload(contract);
    return { supported: false, code: failure.code, classification: failure.diagnostics.classification,
      blockers: contract.errors, featureBlockers: [], featureOptions: [], featureItems: [],
      v2Support: { supported: false, reasons: contract.errors.map(e => e.code) }, familyId: null,
      legacyFallbackEnabled: String(process.env.V2_DISABLE_LEGACY_FALLBACK).toLowerCase() !== 'true', message: failure.message };
  }
  const brief = normalizeBrief(surveyData);
  const capabilityFailure=capabilityFailurePayload(surveyData);
  if(capabilityFailure) return {supported:false,code:capabilityFailure.code,classification:'implementation_gap',
    blockers:capabilityFailure.diagnostics.blockers,featureBlockers:[],featureOptions:featureChoices(surveyData),featureItems:[],
    v2Support:{supported:false,reasons:capabilityFailure.diagnostics.blockers.map(b=>`${b.field}_not_implemented`)},familyId:null,
    legacyFallbackEnabled:String(process.env.V2_DISABLE_LEGACY_FALLBACK).toLowerCase()!=='true',message:capabilityFailure.message};
  const support = resolveArchitectV2Support(brief);
  const withoutFeatures = resolveArchitectV2Support(normalizeBrief({ ...surveyData, features: '' }));
  const featureBlockers = support.reasons.filter(code => code !== 'house_pattern_not_supported' && !withoutFeatures.reasons.includes(code)).map(explainReason);
  const blockers = support.reasons.filter(code => code !== 'house_pattern_not_supported' || support.reasons.length === 1).map(explainReason);
  if (support.supported && !buildCandidateFootprintsV2(brief, interpretBriefV2(brief, support)).length) {
    blockers.push({ code:'LOT_DOES_NOT_FIT', field:'lotWidth', message:'No candidate footprint fits the specified lot width and depth. Increase the lot dimensions or revise the house size and layout.' });
  }
  return { supported: support.supported && blockers.length === 0, v2Support: support,
    familyId: support.familyId, featureItems: brief.requestedFeatureItems.map(({ canonicalType, displayLabel }) => ({ canonicalType, displayLabel })),
    blockers, featureBlockers, featureOptions: featureChoices(surveyData),
    legacyFallbackEnabled: String(process.env.V2_DISABLE_LEGACY_FALLBACK).toLowerCase() !== 'true',
    message: blockers.length ? blockers[0].message : 'Initial requirements checked. Room fit, openings, and distinct options are checked during generation.' };
}
module.exports = { preflightSurvey, explainReason };
