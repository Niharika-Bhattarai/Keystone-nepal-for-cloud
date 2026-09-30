const { normalizeRoomType } = require('./canonicalRoomTypes');
const { selectArchetype } = require('./selectArchetype');
const { parseSurveyNumber } = require('../briefContract');
const { SURVEY_FIELDS } = require('../surveyFieldRegistry');
const { migrateSurvey } = require('../surveyMigration');

function surveyNumber(survey, field, fallback) {
  const value = survey[field];
  const spec = SURVEY_FIELDS[field];
  if (value === undefined || (spec.optionalBlank && (value === '' || value === null))) return fallback;
  const parsed = parseSurveyNumber(value, spec);
  if (parsed === null) {
    const error = new Error(`Invalid survey number: ${field}`);
    error.code = 'BRIEF_INVALID';
    error.field = field;
    throw error;
  }
  return parsed;
}
const {
  getMaterialSpec,
  getDefaultSpec,
  applyFinishOverrides,
} = require('../estimate/materialSpecLibrary');

function parseCount(value, fallback = 0) {
  const match = String(value || '').match(/\d+/);
  return match ? parseInt(match[0], 10) : fallback;
}

function parseGarage(garage) {
  const g = String(garage || 'None').toLowerCase();
  if (g.includes('2')) return 'TWO_CAR';
  if (g.includes('1')) return 'ONE_CAR';
  // Legacy / fallback
  if (g.includes('3')) return 'TWO_CAR'; // cap at two-car
  return 'NONE';
}

function garageAreaTargetSqFt(garageType) {
  if (garageType === 'ONE_CAR') return 280;
  if (garageType === 'TWO_CAR') return 440;
  return 0;
}

function parseShape(shape) {
  const s = String(shape || 'Rectangular').toLowerCase();
  if (s.includes('l-shape') || s.includes('l shape') || s.includes('l-shaped')) return 'L_SHAPE';
  if (s.includes('t-shape') || s.includes('t shape') || s.includes('t-shaped')) return 'T_SHAPE';
  if (s.includes('square')) return 'SQUARE';
  if (s.includes('wide') || s.includes('u-shape') || s.includes('u shape') || s.includes('h-shape') || s.includes('h shape') || s.includes('c-shape') || s.includes('c shape') || s.includes('i-shape') || s.includes('i shape')) return 'WIDE';
  if (s.includes('deep') || s.includes('plus')) return 'DEEP';
  return 'RECTANGULAR';
}

// Lot context → planning hint for footprint bias and feature placement
function parseLotContext(lotContext) {
  const s = String(lotContext || '').toLowerCase();
  if (s.includes('corner')) return 'CORNER';
  // Order matters: "suburban" contains the substring "urban".
  if (s.includes('suburban')) return 'SUBURBAN';
  if ((/\burban\b/.test(s) || s.includes('tight')) && !s.includes('suburban')) return 'URBAN';
  if (s.includes('rural') || s.includes('acreage')) return 'RURAL';
  if (s.includes('view') || s.includes('hillside') || s.includes('focused')) return 'VIEW';
  if (s.includes('waterfront') || s.includes('lake') || s.includes('ocean') || s.includes('beach')) return 'WATERFRONT';
  return 'SUBURBAN'; // default
}

// Ceiling height → multiplier applied to room area targets
function parseCeilingHeight(ceilingHeight) {
  const s = String(ceilingHeight || '').toLowerCase();
  if (s.includes('cathedral') || s.includes('vaulted')) return 'CATHEDRAL';
  if (s.includes('tall') || s.includes('10')) return 'TALL';
  return 'STANDARD'; // 9 ft
}

// Accessibility needs
function parseAccessibility(accessibilityNeeds) {
  const s = String(accessibilityNeeds || '').toLowerCase();
  const wheelchair  = s.includes('wheelchair');
  const wideDoors   = s.includes('wide') || wheelchair;
  const singleLevel = s.includes('single') || s.includes('no stair');
  return { wheelchair, wideDoors, singleLevel };
}

// Indoor/outdoor flow → affects living zone sizing
function parseIndoorOutdoor(indoorOutdoor) {
  const s = String(indoorOutdoor || '').toLowerCase();
  if (s.includes('maximum') || s.includes('open to')) return 'MAXIMUM';
  if (s.includes('minimal') || s.includes('enclosed')) return 'MINIMAL';
  return 'MODERATE';
}

// Natural light priority → hints for layout engine
function parseNaturalLight(naturalLight) {
  const s = String(naturalLight || '').toLowerCase();
  if (s.includes('maximum') || s.includes('glazing')) return 'MAXIMUM';
  if (s.includes('privacy') || s.includes('fewer')) return 'MINIMAL';
  return 'BALANCED';
}

// Budget tier → affects room size ambition
function parseBudgetTier(budgetTier) {
  const s = String(budgetTier || '').toLowerCase();
  if (s.includes('luxury') || s.includes('350')) return 'LUXURY';
  if (s.includes('entry') || s.includes('120')) return 'ENTRY';
  return 'MID';
}

function parseFinishSelections(surveyData = {}, parsedBudgetTier = null) {
  const budgetTier = parsedBudgetTier || parseBudgetTier(surveyData?.budgetTier);
  const styleInput = String(surveyData?.materials || '').trim();
  const baseSpec = styleInput ? getMaterialSpec(styleInput) : getDefaultSpec(budgetTier);
  const finishOverrides = (surveyData?.finishOverrides && typeof surveyData.finishOverrides === 'object')
    ? surveyData.finishOverrides
    : {};
  return applyFinishOverrides(baseSpec, finishOverrides);
}

function parseFoundation(foundationType) {
  const s = String(foundationType || '').toLowerCase();
  if (s.includes('crawl')) return 'CRAWL';
  if (s.includes('basement')) return 'BASEMENT';
  return 'SLAB';
}

function parseMechanical(hvacSystem) {
  const s = String(hvacSystem || '').toLowerCase();
  if (s.includes('mini') && s.includes('split')) return 'MINI_SPLIT';
  if (s.includes('heat') && s.includes('pump')) return 'HEAT_PUMP';
  return 'FORCED_AIR';
}

function parseOutdoorLiving(outdoorLiving, outdoorAreaRaw) {
  const s = String(outdoorLiving || '').toLowerCase();
  let outdoorType = 'NONE';
  if (s.includes('covered') && s.includes('porch')) outdoorType = 'COVERED_PORCH';
  else if (s.includes('screened') && s.includes('porch')) outdoorType = 'SCREENED_PORCH';
  else if (s.includes('deck')) outdoorType = 'OPEN_DECK';
  else if (s.includes('patio')) outdoorType = 'PATIO';
  else if (s && !s.includes('none')) outdoorType = 'PATIO';

  let outdoorArea = surveyNumber({ outdoorArea: outdoorAreaRaw }, 'outdoorArea', 0);
  if (outdoorType === 'NONE') outdoorArea = 0;

  return { outdoorType, outdoorArea };
}

// Front facing direction
function parseFrontFacing(frontFacing) {
  const s = String(frontFacing || 'South').trim();
  if (['North','South','East','West'].includes(s)) return s;
  const u = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (['North','South','East','West'].includes(u)) return u;
  return 'South';
}

function parseStories(stories) {
  return String(stories || '1 Story').includes('2') ? 2 : 1;
}

function normalizeFeaturePhrase(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[&]/g, ' and ')
    .replace(/[.\-_]/g, ' ')
    .replace(/\broom\b/g, ' room ')
    .replace(/\b1\s*,\s*/g, '1 ')
    .replace(/[;]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

const FEATURE_REQUEST_ALIASES = [
  {
    kind: 'home_office',
    canonicalType: 'study',
    displayLabel: 'Home Office',
    patterns: ['home office', 'office', 'work room'],
  },
  {
    kind: 'study',
    canonicalType: 'study',
    displayLabel: 'Study',
    patterns: ['study'],
  },
  {
    kind: 'gaming_room',
    canonicalType: 'gaming_room',
    displayLabel: 'Gaming Room',
    patterns: ['gaming room', 'game room', 'gaming'],
  },
  {
    kind: 'playroom',
    canonicalType: 'playroom',
    displayLabel: 'Playroom',
    patterns: ['play room', 'playroom'],
  },
  {
    kind: 'gym',
    canonicalType: 'gym',
    displayLabel: 'Gym',
    patterns: ['gym', 'home gym', 'exercise room', 'workout room', 'fitness room'],
  },
  {
    kind: 'library',
    canonicalType: 'library',
    displayLabel: 'Library',
    patterns: ['library', 'library room', 'reading room', 'book room'],
  },
  {
    kind: 'movie_room',
    canonicalType: 'movie_room',
    displayLabel: 'Movie Room',
    patterns: ['movie room', 'media room', 'home theater', 'theater room', 'cinema room'],
  },
  {
    kind: 'wine_cellar',
    canonicalType: 'wine_cellar',
    displayLabel: 'Wine Cellar',
    patterns: ['wine cellar', 'wine room', 'cellar'],
  },
  {
    kind: 'music_room',
    canonicalType: 'music_room',
    displayLabel: 'Music Room',
    patterns: ['music room', 'music studio', 'recording room', 'music'],
  },
  {
    kind: 'guest_bedroom',
    canonicalType: 'guest_bedroom',
    displayLabel: 'Guest Bedroom',
    patterns: ['guest bedroom', 'guest room', 'guest suite'],
  },
];

function featureAliasEntry(rawFeature) {
  const s = normalizeFeaturePhrase(rawFeature)
    .replace(/\bstudies\b/g, 'study').replace(/\blibraries\b/g, 'library')
    .replace(/\b(rooms|offices|gyms|suites|cellars|theaters|theatres|studios|games)\b/g, word => word.slice(0, -1));
  if (!s) return null;

  for (const entry of FEATURE_REQUEST_ALIASES) {
    for (const pattern of entry.patterns) {
      if (s === pattern) return entry;
    }
  }

  return null;
}

function featureAliasToCanonical(rawFeature) {
  return featureAliasEntry(rawFeature)?.canonicalType || null;
}

function parseFeatureRequests(features) {
  const normalized = String(features || '');
  if (!normalized.trim()) return [];

  const items = [];
  const chunks = normalized
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const match = chunk.match(/^(\d+)\s+(.*)$/);
    const count = match ? parseInt(match[1], 10) : 1;
    const label = match ? match[2] : chunk;
    const entry = featureAliasEntry(label);
    if (!entry || !Number.isSafeInteger(count) || count > 32) continue;

    for (let i = 0; i < count; i++) {
      items.push({
        kind: entry.kind,
        canonicalType: entry.canonicalType,
        displayLabel: entry.displayLabel,
        rawLabel: label,
        source: 'requested',
      });
    }
  }

  const counts = new Map();
  return items.map(item => {
    const index = (counts.get(item.kind) || 0) + 1;
    counts.set(item.kind, index);
    return { ...item, programId: `feature_${item.kind}_${index}` };
  });
}

function unrecognizedFeatureRequests(features) {
  return String(features || '').split(/[,;]/).map(chunk => chunk.trim())
    .filter(chunk => chunk && !/^(none|n\/a)$/i.test(chunk))
    .filter(chunk => {
      const match = /^(\d+)\s+(.*)$/.exec(chunk);
      const count = match ? Number(match[1]) : 1;
      return !Number.isSafeInteger(count) || count < 1 || count > 32 || !featureAliasEntry(match ? match[2] : chunk);
    });
}

function parseFeatureCounts(features) {
  const requestedItems = parseFeatureRequests(features);

  const featureCounts = {
    study: 0,
    gaming_room: 0,
    playroom: 0,
    guest_bedroom: 0,
    gym: 0,
    library: 0,
    movie_room: 0,
    wine_cellar: 0,
    music_room: 0,
  };

  for (const item of requestedItems) {
    if (item?.canonicalType && Object.prototype.hasOwnProperty.call(featureCounts, item.canonicalType)) {
      featureCounts[item.canonicalType] += 1;
    }
  }

  return featureCounts;
}

function normalizeBrief(surveyData = {}) {
  const totalAreaSqFt = surveyNumber(surveyData, 'totalArea', 2000);
  const stories = surveyNumber(surveyData, 'stories', 1);
  const bedrooms = surveyNumber(surveyData, 'bedrooms', stories === 2 ? 3 : 2);
  const bathrooms = surveyNumber(surveyData, 'bathrooms', stories === 2 ? 3 : 2);
  const garageType = parseGarage(surveyData.garage);
  const garageAreaSqFtTarget = garageAreaTargetSqFt(garageType);
  const conditionedAreaSqFt = totalAreaSqFt;
  const shape = parseShape(surveyData.shape);
  const lotWidth = surveyNumber(surveyData, 'lotWidth', null);
  const lotDepth = surveyNumber(surveyData, 'lotDepth', null);
  const openConcept = String(surveyData.openConcept || '').toLowerCase().includes('open');
  const primaryOnMain = String(surveyData.masterLocation || '').toLowerCase().includes('level 1');
  const kitchenRear = String(surveyData.kitchenPlacement || '').toLowerCase().includes('rear');
  const laundryText = String(surveyData.laundry || surveyData.laundryLocation || '').toLowerCase();
  const laundryLevel = (laundryText.includes('level 2') || laundryText.includes('upstairs') || laundryText.includes('second')) ? 2 : 1;
  const migratedSurvey = migrateSurvey(surveyData).survey;
  const requestedFeatureItems = parseFeatureRequests(migratedSurvey.features);
  const features = parseFeatureCounts(migratedSurvey.features);

  // ── New survey fields ──────────────────────────────────────────────────────
  const lotContext    = parseLotContext(surveyData.lotContext);
  const ceilingHeight = parseCeilingHeight(surveyData.ceilingHeight);
  const accessibility = parseAccessibility(surveyData.accessibilityNeeds);
  const indoorOutdoor = parseIndoorOutdoor(surveyData.indoorOutdoor);
  const naturalLight  = parseNaturalLight(surveyData.naturalLight);
  const budgetTier    = parseBudgetTier(surveyData.budgetTier);
  const finishSpec    = parseFinishSelections(surveyData, budgetTier);
  const frontFacing   = parseFrontFacing(surveyData.frontFacing);
  const foundationType = parseFoundation(surveyData.foundationType || surveyData.foundation);
  const hvacType = parseMechanical(surveyData.hvacSystem || surveyData.hvac || surveyData.mechanicalSystem);
  const outdoor = parseOutdoorLiving(surveyData.outdoorLiving || surveyData.outdoorType, surveyData.outdoorArea);

  // ── Per-bedroom configs (new survey format) ────────────────────────────────
  // New survey sends: bedroomConfigs = [{ privateBath: 'Yes'|'No', closet: 'Walk-in'|'Small' }, ...]
  // Index 0 = primary bedroom, index 1+ = secondary bedrooms.
  // Legacy survey sends: privateBaths (count string) — both formats supported.
  const bedroomConfigsRaw = Array.isArray(surveyData.bedroomConfigs) ? surveyData.bedroomConfigs : null;
  const bedroomProgram = migratedSurvey.bedroomProgram;
  const primaryEnsuiteRequested = bedroomProgram?.[0]?.privateBath ?? true;
  const privateBathCount = bedroomProgram?.some(b => b.privateBath === null)
    ? null : bedroomProgram?.filter(b => b.privateBath).length;

  // bedroomClosets: per-bedroom closet type ('walk_in' or 'reach_in'), index matches bedroom order
  const bedroomClosets = bedroomConfigsRaw
    ? bedroomConfigsRaw.map((cfg) => {
        const val = String(cfg?.closet || '').toLowerCase();
        return val.includes('walk') ? 'walk_in' : 'reach_in';
      })
    : null;

  // privateBaths: how many secondary bedrooms should get their own en-suite bath.
  // From the new per-bedroom config or the legacy 'privateBaths' field.
  // Falls back to null (auto-calculate in buildProgram).
  let privateBathsExplicit = null;
  let derivedBathrooms = bathrooms; // may be overridden by new survey format
  const explicitBathroomsProvided =
    surveyData.bathrooms !== undefined &&
    surveyData.bathrooms !== null &&
    String(surveyData.bathrooms).trim() !== '';
  const explicitBathroomCount = explicitBathroomsProvided ? Math.max(1, parseCount(surveyData.bathrooms, bathrooms)) : null;

  if (bedroomConfigsRaw) {
    // Count secondary bedrooms (index 1+) with privateBath: 'Yes'
    const secondaryConfigs = bedroomConfigsRaw.slice(1);
    const privateCount = secondaryConfigs.filter((cfg) => cfg?.privateBath === true || String(cfg?.privateBath || '').toLowerCase() === 'yes').length;
    privateBathsExplicit = privateCount;

    // Derive total bathroom count from configs: 1 primary + private secondaries + shared baths
    const sharedCount = Math.max(0, parseCount(surveyData.sharedBathroomCount, 1));
    derivedBathrooms = explicitBathroomCount !== null
      ? explicitBathroomCount
      : Math.max(1, Number(primaryEnsuiteRequested) + privateCount + sharedCount);
  } else {
    const privateBathsRaw = surveyData.privateBaths;
    if (privateBathsRaw !== undefined && privateBathsRaw !== null && privateBathsRaw !== '') {
      // The legacy 'privateBaths' survey field counts total bedrooms with a private bath,
      // including the primary bedroom (which always gets one). Subtract 1 so that
      // privateBathsExplicit represents secondary-bedroom private bath count only —
      // matching the bedroomConfigs path semantics. This fixes the C2 bug where
      // privateBaths: '1' (primary only) was incorrectly adding 1 secondary private bath.
      const totalRequested = Math.max(0, parseCount(privateBathsRaw, 0));
      privateBathsExplicit = Math.max(0, totalRequested - 1);
    } else {
      privateBathsExplicit = null; // null = use legacy auto-calculation
    }
  }

  const effectiveBathrooms = Math.max(1, derivedBathrooms);
  // Preserve explicit intent. Layout search/validation must report a failure
  // when it cannot fit the program, never silently reduce the bathroom count.
  const privateBathsRequested = privateBathsExplicit;

  // ── Room area scale factor based on ceiling height ─────────────────────────
  // Taller ceilings feel larger — compensate by slightly expanding room targets
  // so proportions read correctly in plan view.
  const ceilingAreaScale =
    ceilingHeight === 'CATHEDRAL' ? 1.12 :
    ceilingHeight === 'TALL'      ? 1.06 : 1.0;

  // ── Force single-story when accessibility requires it ─────────────────────
  // "Single-level preferred" is a preference, not permission to erase a
  // separately selected second storey.
  const effectiveStories = stories;
  // This is the combined gross area across levels. Footprint search divides
  // it by the story count; dividing the garage here as well undersizes homes.
  const footprintAreaSqFtTarget = totalAreaSqFt + garageAreaSqFtTarget;

  const brief = {
    raw: surveyData,
    location: String(surveyData.location || '').trim(),
    totalAreaSqFt,
    conditionedAreaSqFt,
    garageAreaSqFtTarget,
    footprintAreaSqFtTarget,
    stories: effectiveStories,
    bedrooms,
    bathrooms: effectiveBathrooms,
    shape,
    footprintShape: String(surveyData.shape || 'Rectangular'),
    lotWidth,
    lotDepth,
    garageType,
    materials: String(surveyData.materials || '').trim(),
    openConcept,
    primaryOnMain,
    kitchenRear,
    laundryLevel,
    featureCounts: features,
    requestedFeatureItems,
    requestedFeaturesText: String(surveyData.features || ''),
    primaryLevel: primaryOnMain ? 1 : (effectiveStories === 2 ? 2 : 1),
    hasGarage: garageType !== 'NONE',
    canonicalBedroomType: normalizeRoomType(primaryOnMain ? 'primary bedroom' : 'bedroom'),
    // Secondary ensuite count retained for legacy consumers (null = auto).
    privateBathsRequested,
    privateBathCount,
    primaryEnsuiteRequested,
    bedroomProgram,
    // Per-bedroom closet types: ['walk_in'|'reach_in', ...], index 0 = primary. Null = use defaults.
    bedroomClosets,
    // New fields
    lotContext,
    ceilingHeight,
    ceilingAreaScale,
    accessibility,
    indoorOutdoor,
    naturalLight,
    budgetTier,
    finishSpec,
    foundationType,
    hvacType,
    outdoorType: outdoor.outdoorType,
    outdoorArea: outdoor.outdoorArea,
    frontFacing,
  };

  brief.archetype = selectArchetype(brief);
  return brief;
}

module.exports = {
  unrecognizedFeatureRequests,
  parseFeatureRequests,
  normalizeBrief,
  parseCount,
  parseFinishSelections,
  parseFoundation,
  parseMechanical,
  parseOutdoorLiving,
};
