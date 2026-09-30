// api/plan.js (CommonJS)
//
// Phase 1 rewrite:
// - keep the existing generation pipeline
// - add hard architectural quality gates during candidate selection
// - reject bad plans instead of merely warning about them
// - return richer diagnostics so failed generations are debuggable

'use strict';

const { renderPlanSvg }              = require('../lib/renderPlanSvg');
const { renderElevations }           = require('../lib/renderElevationSvg');
const { validatePlanSpec }           = require('../lib/validatePlan');
const { validatePlanSpecSchema }     = require('../lib/validateSchema');
const { placeOpenings }              = require('../lib/placeOpenings');
const { validateConnectivity }       = require('../lib/validateConnectivity');
const { enrichPlanSpec }             = require('../lib/buildingModel');
const { buildEstimate }              = require('../lib/estimate/buildEstimate');
const { getBuildInfo }               = require('../lib/buildInfo');
const {
  boundingRectOf,
  pointOnBoundaryOfRoom: pointOnBoundary,
  roomArea,
  shareWall: shareWallParts,
} = require('../lib/planGeometry');
const { buildHallwayAnalysis, computePlanQualityMetrics } = require('../lib/planQualityMetrics');
const { refineOrthogonalRooms }      = require('../lib/orthogonalRoomRefinement');
const { normalizeBrief }             = require('../lib/tile/normalizeBrief');
const { validateSurveyInput, inputFailurePayload } = require('../lib/briefContract');
const {capabilityFailurePayload}=require('../lib/surveyCapabilities');
const { computeFootprintCandidates } = require('../lib/tile/computeFootprint');
const { buildProgramFromBrief }      = require('../lib/tile/buildProgramFromBrief');
const { generateTilePlan }           = require('../lib/tile/generateTilePlan');
const { tilesToPlanSpec }            = require('../lib/tile/tilesToPlanSpec');
const { scoreCandidate, assessStrictConnectivityFeasibility } = require('../lib/tile/scoreFootprint');
const { addPlan }                    = require('../lib/gallery');
const { mergeFillerRooms }           = require('../lib/tile/mergeFillerRooms');
const { resolveArchitectV2Support }  = require('../lib/residential/v2/supportMatrix');
const { interpretBriefV2 }           = require('../lib/residential/v2/interpretBriefV2');
const { isSocialFeaturePair } = require('../lib/residential/v2/featurePairPolicy');
const { METRIC_VERSION: CORRECTED_DIVERSITY_VERSION, validateVariationDiversityV2 } = require('../lib/residential/v2/diversityMetricV2');
const { buildCandidateFootprintsV2 } = require('../lib/residential/v2/candidateFootprintsV2');
const { buildProgramV2 }             = require('../lib/residential/v2/programBuilderV2');
const { planRealmsV2 }               = require('../lib/residential/v2/realmPlannerV2');
const { assemblePlanSpecV2 }         = require('../lib/residential/v2/assemblePlanSpecV2');
const { validateArchitectPlanV2 }    = require('../lib/residential/v2/validateArchitectPlanV2');
const { checkSurveyRequirements, validateSurveyRequirements } = require('../lib/surveyRequirements');
const { isNepalSurvey, preflightNepal } = require('../lib/nepal/preflight');
const { explainReason } = require('../lib/surveyPreflight');
const {
  validateVariationDiversity,
} = require('../lib/residential/v2/variationDiversityValidator');
const {
  BASIC_MODEL_ID,
  COMPOSITE_MODEL_ID,
  isCompositeScoringEnabled,
  scoreArchitectV2Candidates,
} = require('../lib/residential/v2/scoring');
const {
  applyDiff: refineApplyDiff,
  parseExactInstruction: refineParseExact,
  sanitizeChangesDetailed: refineSanitizeDetailed,
} = require('./refine').__test;
const { resizeCandidates } = require('../lib/refinementResize');

/* Candidate generation moved to lib/ in P05 item 1. The handler calls these
   directly; the __ml escape hatch it replaced is gone. */
const candidateGeneration = require('../lib/residential/v2/candidateGeneration');
const {
  stripPlanSpecForValidation,
  collectStructuralErrors,
  collectArchitecturalHardErrors,
  collectWarnings,
  buildCandidateDiagnostic,
  tryGenerateCandidate,
  tryGenerateArchitectV2Candidate,
  rankAcceptedCandidates,
  getFootprintAspectRatio,
  num,
  normalizeType,
  isStrictDimensionRoomType,
  roomDisplayName,
  planAreaStats,
  buildArchitectV2Diagnostic,
  getAreaDeltaHardGateError,
  calibrateCandidateScore,
  pointOnBoundaryOfRoom,
  rectOf,
  isBathroomType,
  isRelaxedHallConnector,
  isHabitableRoom,
  getMinRulesForRoom,
  candidateVariationId,
  splitArchitectV2Failures,
  getHardAreaDeltaLimitSqFt,
  getStrictFootprintAspectBounds,
  hasUpperHallGalleryPattern,
  summarizeCandidateFailure,
  postProcessPlanSpec,
  isArchitectTopologyFailure,
  uniqueStrings,
  tryApplyFreeformWishes,
  shareWall,
} = candidateGeneration;

const NUM_CANDIDATES = 100;
const MAX_RETURNED_ALTERNATIVES = 9;


// Zone layout depth variants to try per footprint (beam search analog).
// Each value is added to publicDepthBias in generateTilePlan:
//   0    = standard depth ratio (baseline)
//  +0.14 = deeper public zone (more exterior wall area for living/dining/kitchen)
//  -0.12 = shallower public zone (more private/service depth — suits urban/privacy)
// The scoring system picks the best variant, so this adds layout diversity
// without bloating footprint count. At ~5ms/plan, 3x candidates ≈ +1s total.
const ZONE_VARIANTS = [0, 0.14, -0.12];

function attachEstimate(planSpec, brief, surveyData) {
  if (!planSpec || typeof planSpec !== 'object') return null;
  const finishSpec = brief?.finishSpec || null;
  const estimate = buildEstimate(planSpec, { brief, surveyData, finishSpec });
  planSpec.estimate = estimate;
  if (finishSpec) planSpec.finishSpec = finishSpec;
  return estimate;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

function safeJsonParse(value) {
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}





function edgeForFacing(frontFacing) {
  const facing = String(frontFacing || 'South').toLowerCase();
  if (facing.includes('north')) return 'top';
  if (facing.includes('south')) return 'bottom';
  if (facing.includes('east')) return 'right';
  if (facing.includes('west')) return 'left';
  return 'bottom';
}

function openingEdge(opening, levelWidth, levelHeight) {
  if (!opening) return null;
  if (String(opening?.dir) === 'horizontal') {
    if (num(opening?.y) === 0) return 'top';
    if (num(opening?.y) === num(levelHeight)) return 'bottom';
  } else if (String(opening?.dir) === 'vertical') {
    if (num(opening?.x) === 0) return 'left';
    if (num(opening?.x) === num(levelWidth)) return 'right';
  }
  return null;
}

function resolveOpeningProfile(brief, surveyData = {}) {
  const fromBrief = String(brief?.naturalLight || '').toUpperCase();
  if (fromBrief === 'MAXIMUM') return 'maximum_glazing';
  if (fromBrief === 'MINIMAL') return 'privacy_first';

  const raw = String(surveyData?.naturalLight || '').toLowerCase();
  if (raw.includes('maximum') || raw.includes('glazing')) return 'maximum_glazing';
  if (raw.includes('privacy') || raw.includes('fewer') || raw.includes('minimal')) return 'privacy_first';
  return 'balanced';
}

function resolveIndoorOutdoorProfile(brief, surveyData = {}) {
  const fromBrief = String(brief?.indoorOutdoor || '').toUpperCase();
  if (fromBrief === 'MAXIMUM') return 'maximum_outdoor';
  if (fromBrief === 'MINIMAL') return 'enclosed';

  const raw = String(surveyData?.indoorOutdoor || '').toLowerCase();
  if (raw.includes('maximum') || raw.includes('open')) return 'maximum_outdoor';
  if (raw.includes('minimal') || raw.includes('enclosed')) return 'enclosed';
  return 'moderate';
}

function resolveDoorwayProfile(brief, surveyData = {}) {
  const fromBriefWide = Boolean(brief?.accessibility?.wideDoors || brief?.accessibility?.wheelchair);
  if (fromBriefWide) return 'wide';
  const raw = String(surveyData?.accessibilityNeeds || '').toLowerCase();
  return (raw.includes('wide') || raw.includes('wheelchair')) ? 'wide' : 'standard';
}

function computeOpeningDiagnostics(planSpec, brief, surveyData = {}) {
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  const frontFacing = String(brief?.frontFacing || surveyData?.frontFacing || 'South');
  const frontEdge = edgeForFacing(frontFacing);
  const openingProfile = resolveOpeningProfile(brief, surveyData);
  const indoorOutdoorProfile = resolveIndoorOutdoorProfile(brief, surveyData);
  const doorwayProfile = resolveDoorwayProfile(brief, surveyData);

  const levelSummaries = levels.map((level) => {
    const windows = Array.isArray(level?.windows) ? level.windows : [];
    const doors = Array.isArray(level?.doors) ? level.doors : [];
    const exteriorDoors = doors.filter((door) => String(door?.b) === '__exterior__');
    const garageDoors = exteriorDoors.filter((door) => Boolean(door?.garageDoor));
    const wideDoors = doors.filter((door) => !door?.garageDoor && num(door?.width) >= 4);
    const frontEdgeWindowCount = windows.filter((window) =>
      openingEdge(window, level?.width, level?.height) === frontEdge
    ).length;

    return {
      level: num(level?.level),
      widthFt: num(level?.width),
      heightFt: num(level?.height),
      windowCount: windows.length,
      frontEdgeWindowCount,
      interiorDoorCount: Math.max(0, doors.length - exteriorDoors.length),
      exteriorDoorCount: exteriorDoors.length,
      garageDoorCount: garageDoors.length,
      wideDoorCount: wideDoors.length,
    };
  });

  const totals = levelSummaries.reduce((sum, level) => ({
    windowCount: sum.windowCount + num(level?.windowCount),
    frontEdgeWindowCount: sum.frontEdgeWindowCount + num(level?.frontEdgeWindowCount),
    interiorDoorCount: sum.interiorDoorCount + num(level?.interiorDoorCount),
    exteriorDoorCount: sum.exteriorDoorCount + num(level?.exteriorDoorCount),
    garageDoorCount: sum.garageDoorCount + num(level?.garageDoorCount),
    wideDoorCount: sum.wideDoorCount + num(level?.wideDoorCount),
  }), {
    windowCount: 0,
    frontEdgeWindowCount: 0,
    interiorDoorCount: 0,
    exteriorDoorCount: 0,
    garageDoorCount: 0,
    wideDoorCount: 0,
  });

  return {
    profiles: {
      openingProfile,
      indoorOutdoorProfile,
      doorwayProfile,
      frontFacing,
      frontEdge,
    },
    levels: levelSummaries,
    totals,
  };
}

function attachOpeningDiagnostics(planSpec, brief, surveyData = {}) {
  if (!planSpec || typeof planSpec !== 'object') return null;
  const openingDiagnostics = computeOpeningDiagnostics(planSpec, brief, surveyData);
  planSpec.openingDiagnostics = openingDiagnostics;
  planSpec.openingProfile = openingDiagnostics?.profiles?.openingProfile || 'balanced';
  planSpec.indoorOutdoorProfile = openingDiagnostics?.profiles?.indoorOutdoorProfile || 'moderate';
  planSpec.doorwayProfile = openingDiagnostics?.profiles?.doorwayProfile || 'standard';
  return openingDiagnostics;
}


function attachPlanDiagnostics(res, planSpec, brief = null, footprint = null) {
  const buildInfo = getBuildInfo();
  const area = planAreaStats(planSpec, brief, footprint);
  res.setHeader('X-Keystone-App-Version', buildInfo.appVersion);
  res.setHeader('X-Keystone-Plan-Engine', buildInfo.planEngineVersion);
  res.setHeader('X-Keystone-Runtime-Revision', buildInfo.runtimeRevision);
  res.setHeader('X-Keystone-Requested-Area', String(area.requestedAreaSqFt));
  res.setHeader('X-Keystone-Delivered-Area', String(area.deliveredAreaSqFt));
  res.setHeader('X-Keystone-Delivered-Non-Garage-Area', String(area.deliveredNonGarageAreaSqFt));
  res.setHeader('X-Keystone-Effective-Requested-Area', String(area.effectiveRequestedAreaSqFt));
  res.setHeader('X-Keystone-Effective-Delivered-Area', String(area.effectiveDeliveredAreaSqFt));
  return {
    buildInfo,
    area,
  };
}

function buildEnginePayload(buildInfo, area, generatorMeta = {}) {
  return {
    ...buildInfo,
    ...area,
    generatorId: generatorMeta.generatorId || 'legacy',
    fallbackUsed: Boolean(generatorMeta.fallbackUsed),
    supportTier: generatorMeta.supportTier || 'legacy_only',
    housePattern: generatorMeta.housePattern || null,
    graphBuildStatus: generatorMeta.graphBuildStatus || null,
    assemblyStatus: generatorMeta.assemblyStatus || null,
    topologyFailures: Array.isArray(generatorMeta.topologyFailures) ? generatorMeta.topologyFailures : [],
    geometryFailures: Array.isArray(generatorMeta.geometryFailures) ? generatorMeta.geometryFailures : [],
    openingProfile: generatorMeta.openingProfile || null,
    indoorOutdoorProfile: generatorMeta.indoorOutdoorProfile || null,
    doorwayProfile: generatorMeta.doorwayProfile || null,
    scoringModelId: generatorMeta.scoringModelId || null,
    scoringMode: generatorMeta.scoringMode || null,
  };
}





function summarizeArchitectV2Diagnostics(rejectedCandidates) {
  const diagnostics = Array.isArray(rejectedCandidates) ? rejectedCandidates : [];
  const graphStatuses = diagnostics.map((item) => String(item?.graphBuildStatus || '')).filter(Boolean);
  const assemblyStatuses = diagnostics.map((item) => String(item?.assemblyStatus || '')).filter(Boolean);
  return {
    graphBuildStatus: graphStatuses.includes('failed') ? 'failed' : (graphStatuses.includes('ok') ? 'ok' : null),
    assemblyStatus: assemblyStatuses.includes('failed') ? 'failed' : (assemblyStatuses.includes('ok') ? 'ok' : null),
    topologyFailures: uniqueStrings(diagnostics.flatMap((item) => item?.topologyFailures || [])),
    geometryFailures: uniqueStrings(diagnostics.flatMap((item) => item?.geometryFailures || [])),
  };
}






function overlapLen(a1, a2, b1, b2) {
  const lo = Math.max(a1, b1);
  const hi = Math.min(a2, b2);
  return Math.max(0, hi - lo);
}




















function candidateFunctionalId(candidate) {
  return String(
    candidate?.footprint?.functionalId ||
    candidate?.planSpec?.functionalId ||
    'front_core_compact'
  );
}

function candidateIdentityKey(candidate) {
  return [
    candidateFunctionalId(candidate),
    candidateVariationId(candidate),
    `${num(candidate?.footprint?.widthFt)}x${num(candidate?.footprint?.heightFt)}`,
    num(candidate?.score).toFixed(4),
  ].join(':');
}

/**
 * Compute a lightweight topology signature for collapse detection.
 * Encodes level count, major room types, and relative positions (left/right/center)
 * so that plans with identical spatial organization are flagged as near-duplicates.
 */
function computeTopologySignature(candidate) {
  const planSpec = candidate?.planSpec;
  if (!planSpec?.levels) return 'unknown';
  const sigs = [];
  for (const level of planSpec.levels) {
    const width = num(level?.width, 40);
    const height = num(level?.height, 30);
    const rooms = (level?.rooms || [])
      .filter((r) => r && r.type)
      .map((r) => {
        // Use 4-quadrant positioning for finer-grained topology detection
        const cx = num(r.x) + num(r.w) / 2;
        const cy = num(r.y) + num(r.h) / 2;
        const xZone = cx < width * 0.5 ? 'L' : 'R';
        const yZone = cy < height * 0.5 ? 'T' : 'B';
        return `${r.type}:${xZone}${yZone}`;
      })
      .sort();
    sigs.push(`L${level.level}:${rooms.join(',')}`);
  }
  return sigs.join('||');
}

function computeGeometrySignature(candidate) {
  const levels = candidate?.planSpec?.levels || [];
  return levels
    .map((level) => {
      const rooms = (level?.rooms || [])
        .map((room) => (
          `${room?.type || 'room'}:${num(room?.x)},${num(room?.y)},${num(room?.w)},${num(room?.h)}`
        ))
        .sort()
        .join('|');
      return `L${num(level?.level, 1)}:${num(level?.width)}x${num(level?.height)}:${rooms}`;
    })
    .join('||');
}

function selectArchitectV2Alternatives(ranked, bestCandidate, maxCount) {
  const selected = [];
  const selectedSet = new Set();
  const seenFunctionalIds = new Set([candidateFunctionalId(bestCandidate)]);
  const seenVariations = new Set([candidateVariationId(bestCandidate)]);
  const seenTopologies = new Set([computeTopologySignature(bestCandidate)]);

  // Pass 1: pick one winner per distinct functionalId (profile identity)
  for (const candidate of ranked.slice(1)) {
    const functionalId = candidateFunctionalId(candidate);
    const variationId = candidateVariationId(candidate);
    const candidateKey = `${candidate?.footprint?.widthFt}x${candidate?.footprint?.heightFt}:${variationId}:${candidate?.score}`;
    if (selectedSet.has(candidateKey)) continue;
    if (seenFunctionalIds.has(functionalId)) continue;

    // Topology collapse check: reject if spatial organization is near-identical
    const topo = computeTopologySignature(candidate);
    if (seenTopologies.has(topo)) continue;

    selected.push(candidate);
    selectedSet.add(candidateKey);
    seenFunctionalIds.add(functionalId);
    seenVariations.add(variationId);
    seenTopologies.add(topo);
    if (selected.length >= maxCount) return selected;
  }

  // Pass 2: pick one per variationId if we still need more
  for (const candidate of ranked.slice(1)) {
    const variationId = candidateVariationId(candidate);
    const candidateKey = `${candidate?.footprint?.widthFt}x${candidate?.footprint?.heightFt}:${variationId}:${candidate?.score}`;
    if (selectedSet.has(candidateKey)) continue;
    if (seenVariations.has(variationId)) continue;

    const topo = computeTopologySignature(candidate);
    if (seenTopologies.has(topo)) continue;

    selected.push(candidate);
    selectedSet.add(candidateKey);
    seenVariations.add(variationId);
    seenTopologies.add(topo);
    if (selected.length >= maxCount) return selected;
  }

  // Pass 3: fill remaining slots from non-duplicate candidates
  for (const candidate of ranked.slice(1)) {
    const variationId = candidateVariationId(candidate);
    const candidateKey = `${candidate?.footprint?.widthFt}x${candidate?.footprint?.heightFt}:${variationId}:${candidate?.score}`;
    if (selectedSet.has(candidateKey)) continue;
    selected.push(candidate);
    selectedSet.add(candidateKey);
    if (selected.length >= maxCount) break;
  }

  return selected;
}

function prioritizeCandidatePoolForDiversity(bestCandidate, candidatePool) {
  const pool = Array.isArray(candidatePool) ? candidatePool : [];
  if (!pool.length) return [];

  const ordered = [];
  const seenCandidates = new Set();
  const seenFunctionalIds = new Set([candidateFunctionalId(bestCandidate)]);
  const seenVariations = new Set([candidateVariationId(bestCandidate)]);

  const tryPush = (candidate) => {
    const key = candidateIdentityKey(candidate);
    if (seenCandidates.has(key)) return false;
    seenCandidates.add(key);
    ordered.push(candidate);
    seenFunctionalIds.add(candidateFunctionalId(candidate));
    seenVariations.add(candidateVariationId(candidate));
    return true;
  };

  // Pass 1: ensure we evaluate one candidate per unseen functional profile first.
  for (const candidate of pool) {
    const functionalId = candidateFunctionalId(candidate);
    if (seenFunctionalIds.has(functionalId)) continue;
    tryPush(candidate);
  }

  // Pass 2: then prioritize unseen variation families.
  for (const candidate of pool) {
    const variationId = candidateVariationId(candidate);
    if (seenVariations.has(variationId)) continue;
    tryPush(candidate);
  }

  // Pass 3: fill remaining in deterministic ranked order.
  for (const candidate of pool) {
    tryPush(candidate);
  }

  return ordered;
}

function buildVariationKeyedAlternativePool(ranked, bestCandidate, maxCount) {
  const basePool = ranked.slice(1, 1 + Math.max(maxCount * 12, 60));
  if (!basePool.length) return [];

  const functionalSeedCount = Math.max(maxCount * 3, maxCount);
  const seeded = selectArchitectV2Alternatives(ranked, bestCandidate, functionalSeedCount);
  const prioritized = prioritizeCandidatePoolForDiversity(bestCandidate, [...seeded, ...basePool]);
  return prioritized;
}

async function handler(req, res) {
  setCors(res);
  const buildInfo = getBuildInfo();
  res.setHeader('X-Keystone-App-Version', buildInfo.appVersion);
  res.setHeader('X-Keystone-Plan-Engine', buildInfo.planEngineVersion);
  res.setHeader('X-Keystone-Runtime-Revision', buildInfo.runtimeRevision);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed', engine: buildInfo });
  }

  try {
    const body = safeJsonParse(req.body);
    const surveyData = body?.surveyData || body || {};
    const chatHistory = Array.isArray(body?.chatHistory) ? body.chatHistory : [];

    if (isNepalSurvey(surveyData)) {
      const preflight = preflightNepal(surveyData);
      return res.status(422).json({ success: false, complete: false, ...preflight,
        diagnostics: { classification: preflight.classification, blockers: preflight.blockers,
          triedCandidateCount: 0 }, engine: buildInfo });
    }

    const inputContract = validateSurveyInput(surveyData);
    if (!inputContract.valid) return res.status(422).json({ ...inputFailurePayload(inputContract), engine: buildInfo });
    const capabilityFailure=capabilityFailurePayload(surveyData);
    if(capabilityFailure) return res.status(422).json({...capabilityFailure,engine:buildInfo});

    const brief = normalizeBrief(surveyData);

    // Small homes (from 600 sq ft) have layouts where the support gates say
    // so, such as one-bedroom cottages; the legacy engine cannot draw them.
    if (brief.totalAreaSqFt < 1000 && !resolveArchitectV2Support(brief).supported) {
      return res.status(422).json({
        success: false,
        message: `Total area ${brief.totalAreaSqFt} sq ft is below the 1,000 sq ft minimum for these choices. Please choose a larger floor plan size.`,
        engine: buildEnginePayload(buildInfo, {}, {
          generatorId: 'legacy',
          fallbackUsed: false,
          supportTier: 'legacy_only',
          housePattern: null,
        }),
        code: 'AREA_TOO_SMALL',
      });
    }

    const v2Support = resolveArchitectV2Support(brief);
    const disableLegacyFallback =
      String(process.env.V2_DISABLE_LEGACY_FALLBACK || '').trim().toLowerCase() === 'true';
    const compositeScoringEnabled = isCompositeScoringEnabled();
    const scoringMode = compositeScoringEnabled ? 'composite' : 'basic';
    const scoringModelId = compositeScoringEnabled ? COMPOSITE_MODEL_ID : BASIC_MODEL_ID;
    let engineMeta = {
      generatorId: 'legacy',
      fallbackUsed: false,
      supportTier: v2Support.supportTier,
      housePattern: v2Support.housePattern || null,
      graphBuildStatus: v2Support.supported ? 'pending' : 'not_attempted',
      assemblyStatus: v2Support.supported ? 'pending' : 'not_attempted',
      topologyFailures: [],
      geometryFailures: [],
      scoringMode,
      scoringModelId,
    };
    let v2RejectedCandidates = [];
    let v2TriedCandidateCount = 0;

    if (v2Support.supported) {
      const interpretation = interpretBriefV2(brief, v2Support);
      const v2Candidates = buildCandidateFootprintsV2(brief, interpretation);
      const v2Accepted = [];

      for (const footprint of v2Candidates) {
        const candidate = tryGenerateArchitectV2Candidate(brief, interpretation, footprint, surveyData);
        v2TriedCandidateCount += 1;
        if (candidate.ok) v2Accepted.push(candidate.result);
        else v2RejectedCandidates.push(...candidate.diagnostics);
      }

      if (v2Accepted.length) {
        const scoredV2Accepted = scoreArchitectV2Candidates(v2Accepted, brief, {
          compositeEnabled: compositeScoringEnabled,
        });
        const ranked = rankAcceptedCandidates(scoredV2Accepted, { scoringMode });
        // Use stable room identities for every family. The old metric counted
        // moving a room twice (centroid and coordinate-keyed adjacency), which
        // let cosmetic alternatives satisfy the architectural diversity target.
        const correctedDiversity = true;
        const diverseSet = require('../lib/residential/v2/selectDiversePlans').selectDiversePlans(ranked, 4,
          { metricVersion: correctedDiversity ? CORRECTED_DIVERSITY_VERSION : 'legacy' });
        // Keep the established public-floor office as the lead recommendation;
        // a quiet upstairs office remains available as a distinct alternative.
        if (brief.bedrooms === 2 && brief.requestedFeatureItems?.some(f=>f.canonicalType==='study')) {
          const mainFloorOffice = diverseSet.selected.findIndex(c=>c.planSpec.levels.some(l=>l.level===1 && l.rooms.some(r=>r.type==='study')));
          if (mainFloorOffice > 0) diverseSet.selected.unshift(...diverseSet.selected.splice(mainFloorOffice,1));
        }
        const best = diverseSet.selected[0];
        const successDiagnostics = attachPlanDiagnostics(res, best.planSpec, brief, best.footprint);
        const alternativePool = buildVariationKeyedAlternativePool(
          ranked,
          best,
          MAX_RETURNED_ALTERNATIVES
        );
        const diversitySelection = { selected:diverseSet.selected.slice(1), rejected:[], recoveryUsed:false };
        const alternatives = diversitySelection.selected;
        const rankedFunctionalIds = [...new Set(ranked.map((candidate) => candidateFunctionalId(candidate)))];
        const rankedVariationIds = [...new Set(ranked.map((candidate) => candidateVariationId(candidate)))];
        const poolFunctionalIds = [...new Set(alternativePool.map((candidate) => candidateFunctionalId(candidate)))];
        const poolVariationIds = [...new Set(alternativePool.map((candidate) => candidateVariationId(candidate)))];
        const selectedAlternativeFunctionalIds = [...new Set(alternatives.map((candidate) => candidateFunctionalId(candidate)))];
        const selectedAlternativeVariationIds = [...new Set(alternatives.map((candidate) => candidateVariationId(candidate)))];
        const bestEstimate = attachEstimate(best.planSpec, brief, surveyData);
        const bestOpeningDiagnostics = attachOpeningDiagnostics(best.planSpec, brief, surveyData);
        alternatives.forEach((alt) => {
          attachEstimate(alt.planSpec, brief, surveyData);
          attachOpeningDiagnostics(alt.planSpec, brief, surveyData);
        });

        const svg = renderPlanSvg(best.planSpec);
        const galleryId = await addPlan(surveyData, best.planSpec, svg);
        const generatorPayload = {
          generatorId: 'architect_v2',
          fallbackUsed: false,
          supportTier: interpretation.supportTier,
          housePattern: interpretation.housePattern,
          scoringMode,
          scoringModelId,
          openingProfile: bestOpeningDiagnostics?.profiles?.openingProfile || null,
          indoorOutdoorProfile: bestOpeningDiagnostics?.profiles?.indoorOutdoorProfile || null,
          doorwayProfile: bestOpeningDiagnostics?.profiles?.doorwayProfile || null,
          ...(best.graphDiagnostics || {
            graphBuildStatus: 'ok',
            assemblyStatus: 'ok',
            topologyFailures: [],
            geometryFailures: [],
          }),
        };

        const alternativePayload = alternatives.map((alt) => {
          let altSvg = '';
          try {
            altSvg = renderPlanSvg(alt.planSpec);
          } catch (_err) {
            altSvg = '';
          }

          return {
            planSpec: alt.planSpec,
            estimate: alt.planSpec?.estimate || null,
            svg: altSvg,
            elevations: alt.planSpec?.elevations || {},
            archetype: alt.planSpec?.archetype || null,
            score: alt.score,
            scoreIssues: alt.scoreIssues,
            warnings: alt.warnings,
            scoreBreakdown: alt.scoreBreakdown || null,
            footprintInfo: {
              widthFt: num(alt.footprint?.widthFt),
              heightFt: num(alt.footprint?.heightFt),
              aspectRatio: num(alt.footprint?.aspectRatio || getFootprintAspectRatio(alt.footprint)),
              totalAreaSqFt: num(alt.footprint?.totalAreaSqFt),
              variationId: String(alt.footprint?.variationId || alt.planSpec?.variationId || 'variant_a_compact_core'),
              variationLabel: String(alt.footprint?.variationLabel || alt.planSpec?.variationLabel || 'Compact Core'),
              variationTheme: String(alt.footprint?.variationTheme || alt.planSpec?.variationTheme || 'balanced_compact'),
              functionalId: String(alt.footprint?.functionalId || alt.planSpec?.functionalId || 'front_core_compact'),
              functionalLabel: String(alt.footprint?.functionalLabel || alt.planSpec?.functionalLabel || 'Front Core — Compact'),
            },
            metadata: {
              archetype: alt.planSpec?.archetype || null,
              stairCore: alt.planSpec?.stairCore || [],
              zones: alt.planSpec?.zones || [],
              facade: alt.planSpec?.facade || null,
            },
            openingDiagnostics: alt.planSpec?.openingDiagnostics || computeOpeningDiagnostics(alt.planSpec, brief, surveyData),
            engine: buildEnginePayload(
              successDiagnostics.buildInfo,
              planAreaStats(alt.planSpec, brief, alt.footprint),
              {
                ...generatorPayload,
                ...(alt.graphDiagnostics || {}),
              }
            ),
          };
        });

        // Phase 3.3: compute variation diversity metrics
        let diversityMetrics = null;
        try {
          const allPlanSpecs = [best, ...alternatives].map((c) => ({
            levels: c.planSpec?.levels || [],
            rooms: c.planSpec?.rooms || [],
            footprint: c.footprint || {},
            metadata: {
              variationId: c.footprint?.variationId || c.planSpec?.variationId,
              functionalId: c.footprint?.functionalId || c.planSpec?.functionalId,
            },
          }));
          diversityMetrics = correctedDiversity ? validateVariationDiversityV2(allPlanSpecs) : validateVariationDiversity(allPlanSpecs);
          diversityMetrics.rejectedNearDuplicates = diversitySelection.rejected || [];
          diversityMetrics.recoveryUsed = Boolean(diversitySelection.recoveryUsed);
          diversityMetrics.requestedOptionCount = 3;
          diversityMetrics.deliveredOptionCount = 1 + alternatives.length;
          diversityMetrics.targetMet = alternatives.length >= 2 && diversityMetrics.valid;
          if (!diversityMetrics.valid && String(process.env.V2_LOG_DIVERSITY_WARNINGS || '').trim().toLowerCase() === 'true') {
            console.warn('[architect_v2] variation diversity check failed:', JSON.stringify({
              failedPairs: diversityMetrics.failedPairs,
              diversityScore: diversityMetrics.diversityScore,
              survivingProfiles: [...new Set([best, ...alternatives].map((c) => c.footprint?.variationId))],
              survivingFunctionalIds: [...new Set([best, ...alternatives].map((c) => c.footprint?.functionalId))],
            }));
          }
        } catch (_) {
          // Diversity check is advisory — never block response
        }

        return res.status(200).json({
          success: true,
          phase: 'architect_v2_selection',
          fulfillmentSummary:best.planSpec?.surveyFulfillment?.summary||null,
          fallbackUsed: false,
          planSpec: best.planSpec,
          estimate: bestEstimate,
          finishSpec: brief?.finishSpec || null,
          svg,
          elevations: best.planSpec?.elevations || {},
          archetype: best.planSpec?.archetype || null,
          galleryId,
          warnings: best.warnings,
          score: best.score,
          scoreIssues: best.scoreIssues,
          scoreBreakdown: best.scoreBreakdown || null,
          footprintInfo: {
            widthFt: num(best.footprint?.widthFt),
            heightFt: num(best.footprint?.heightFt),
            aspectRatio: num(best.footprint?.aspectRatio || getFootprintAspectRatio(best.footprint)),
            totalAreaSqFt: num(best.footprint?.totalAreaSqFt),
            variationId: String(best.footprint?.variationId || best.planSpec?.variationId || 'variant_a_compact_core'),
            variationLabel: String(best.footprint?.variationLabel || best.planSpec?.variationLabel || 'Compact Core'),
            variationTheme: String(best.footprint?.variationTheme || best.planSpec?.variationTheme || 'balanced_compact'),
            functionalId: String(best.footprint?.functionalId || best.planSpec?.functionalId || 'front_core_compact'),
            functionalLabel: String(best.footprint?.functionalLabel || best.planSpec?.functionalLabel || 'Front Core — Compact'),
          },
          metadata: {
            archetype: best.planSpec?.archetype || null,
            stairCore: best.planSpec?.stairCore || [],
            zones: best.planSpec?.zones || [],
            facade: best.planSpec?.facade || null,
          },
          openingDiagnostics: bestOpeningDiagnostics,
          engine: buildEnginePayload(successDiagnostics.buildInfo, successDiagnostics.area, generatorPayload),
          diagnostics: {
            triedCandidateCount: v2Candidates.length,
            acceptedCandidateCount: v2Accepted.length,
            rejectedCandidateCount: v2RejectedCandidates.length,
            rejectedCandidates: v2RejectedCandidates,
            diversityRejectedCandidateCount: diversitySelection.rejected.length,
            diversityRejectedCandidates: diversitySelection.rejected,
            diversityRecoveryUsed: Boolean(diversitySelection.recoveryUsed),
            rankedCandidateFunctionalIds: rankedFunctionalIds,
            rankedCandidateVariationIds: rankedVariationIds,
            alternativePoolFunctionalIds: poolFunctionalIds,
            alternativePoolVariationIds: poolVariationIds,
            selectedAlternativeFunctionalIds,
            selectedAlternativeVariationIds,
          },
          diversityMetrics,
          alternatives: alternativePayload,
          chatHistory: [
            { role: 'system', parts: [{ text: 'architect_v2' }] },
            { role: 'model', parts: [{ text: JSON.stringify(best.planSpec) }] },
            ...chatHistory,
          ],
        });
      }

      engineMeta = {
        generatorId: 'legacy',
        fallbackUsed: true,
        supportTier: interpretation.supportTier,
        housePattern: interpretation.housePattern,
        scoringMode,
        scoringModelId,
        ...summarizeArchitectV2Diagnostics(v2RejectedCandidates),
      };
    }

    if (disableLegacyFallback) {
      console.warn(JSON.stringify({ event: 'plan_generation_rejected', runtimeRevision: buildInfo.runtimeRevision,
        stories: brief.stories, bedrooms: brief.bedrooms, bathrooms: brief.bathrooms, area: brief.totalAreaSqFt,
        garage: brief.garageType, features: brief.requestedFeatureItems.map(item => item.canonicalType),
        v2Support, triedCandidateCount: v2TriedCandidateCount, legacyFallbackBlocked: true }));
      const failedMeta = {
        generatorId: 'architect_v2',
        fallbackUsed: false,
        supportTier: engineMeta.supportTier || v2Support.supportTier,
        housePattern: engineMeta.housePattern || v2Support.housePattern || null,
        scoringMode,
        scoringModelId,
        graphBuildStatus: engineMeta.graphBuildStatus || 'failed',
        assemblyStatus: engineMeta.assemblyStatus || 'failed',
        topologyFailures: Array.isArray(engineMeta.topologyFailures) ? engineMeta.topologyFailures : [],
        geometryFailures: Array.isArray(engineMeta.geometryFailures) ? engineMeta.geometryFailures : [],
      };
      return res.status(422).json({
        success: false,
        code: 'V2_FALLBACK_DISABLED',
        message: v2Support.supported
          ? 'No layout met the architectural checks for this brief. Your requirements have been preserved; please review the layout diagnostics.'
          : 'This combination is not yet supported by the current generator. Please review the affected survey choices.',
        engine: buildEnginePayload(buildInfo, {}, failedMeta),
        diagnostics: {
          fallbackBlocked: true,
          v2Support,
          blockers: v2Support.reasons.map(explainReason),
          triedCandidateCount: v2TriedCandidateCount,
          rejectedCandidateCount: v2RejectedCandidates.length,
          rejectedCandidates: v2RejectedCandidates,
          familyId: v2Support.familyId || null,
          familyCluster: v2Support.familyCluster || null,
          blockedReasons: Array.isArray(v2Support.reasons) ? v2Support.reasons : [],
        },
      });
    }

    const candidates = computeFootprintCandidates(brief, 2, NUM_CANDIDATES);

    if (!Array.isArray(candidates) || !candidates.length) {
      return res.status(422).json({
        success: false,
        message: 'No footprint candidates could be generated for this request.',
        engine: buildEnginePayload(buildInfo, {}, engineMeta),
      });
    }

    const accepted = [];
    const softRejected = [];
    const rejected = [];

    for (const footprint of candidates) {
      for (const zoneBias of ZONE_VARIANTS) {
        // Build a brief variant with the zone depth bias for this iteration.
        // zoneBias=0 uses the standard layout; non-zero values explore different
        // public/private zone depth ratios for the same footprint.
        const briefVariant = zoneBias !== 0
          ? { ...brief, layoutVariantBias: zoneBias }
          : brief;
        const candidate = tryGenerateCandidate(briefVariant, footprint, surveyData);
        if (candidate.ok) {
          accepted.push(candidate.result);
        } else {
          rejected.push(...candidate.diagnostics);
          if (candidate.fallbackResult) softRejected.push(candidate.fallbackResult);
        }
      }
    }

    if (!accepted.length) {
      // A rejected architectural candidate is not a usable fallback. Preserve
      // its diagnostics, but never publish it as a successful plan or export.
      console.warn(JSON.stringify({ event: 'plan_generation_rejected', runtimeRevision: buildInfo.runtimeRevision,
        stories: brief.stories, bedrooms: brief.bedrooms, bathrooms: brief.bathrooms, area: brief.totalAreaSqFt,
        garage: brief.garageType, features: brief.requestedFeatureItems.map(item => item.canonicalType),
        v2Support, triedCandidateCount: v2TriedCandidateCount, legacyRejectedCount: rejected.length }));
      return res.status(422).json({
        success: false,
        message: 'No layout met all structural and architectural checks for this survey. Try more area or fewer rooms, or revise the floor and garage requirements.',
        code: 'NO_VALID_LAYOUT',
        validation: { status: 'rejected', acceptedCandidateCount: 0 },
        engine: buildEnginePayload(buildInfo, {}, engineMeta),
        diagnostics: {
          triedCandidateCount: candidates.length,
          rejectedCandidateCount: rejected.length,
          rejectedCandidates: rejected,
          architectV2TriedCandidateCount: v2TriedCandidateCount,
          architectV2RejectedCandidates: v2RejectedCandidates,
          v2Support,
          blockers: v2Support.reasons.map(explainReason),
        },
        chatHistory,
      });
    }

    const ranked = rankAcceptedCandidates(accepted);
    const best = ranked[0];
    const successDiagnostics = attachPlanDiagnostics(res, best.planSpec, brief, best.footprint);
    const alternatives = ranked.slice(1, 1 + MAX_RETURNED_ALTERNATIVES);
    const bestEstimate = attachEstimate(best.planSpec, brief, surveyData);
    const bestOpeningDiagnostics = attachOpeningDiagnostics(best.planSpec, brief, surveyData);
    alternatives.forEach((alt) => {
      attachEstimate(alt.planSpec, brief, surveyData);
      attachOpeningDiagnostics(alt.planSpec, brief, surveyData);
    });

    const svg = renderPlanSvg(best.planSpec);
    const galleryId = await addPlan(surveyData, best.planSpec, svg);

    const alternativePayload = alternatives.map((alt) => {
      let altSvg = '';
      try {
        altSvg = renderPlanSvg(alt.planSpec);
      } catch (_err) {
        altSvg = '';
      }

      return {
        planSpec: alt.planSpec,
        estimate: alt.planSpec?.estimate || null,
        svg: altSvg,
        elevations: alt.planSpec?.elevations || {},
        archetype: alt.planSpec?.archetype || null,
        score: alt.score,
        scoreIssues: alt.scoreIssues,
        warnings: alt.warnings,
        footprintInfo: {
          widthFt: num(alt.footprint?.widthFt),
          heightFt: num(alt.footprint?.heightFt),
          aspectRatio: num(alt.footprint?.aspectRatio || getFootprintAspectRatio(alt.footprint)),
          totalAreaSqFt: num(alt.footprint?.totalAreaSqFt),
        },
        metadata: {
          archetype: alt.planSpec?.archetype || null,
          stairCore: alt.planSpec?.stairCore || [],
          zones: alt.planSpec?.zones || [],
          facade: alt.planSpec?.facade || null,
        },
        openingDiagnostics: alt.planSpec?.openingDiagnostics || computeOpeningDiagnostics(alt.planSpec, brief, surveyData),
        engine: {
          ...buildEnginePayload(
            successDiagnostics.buildInfo,
            planAreaStats(alt.planSpec, brief, alt.footprint),
            {
              ...engineMeta,
              openingProfile: bestOpeningDiagnostics?.profiles?.openingProfile || null,
              indoorOutdoorProfile: bestOpeningDiagnostics?.profiles?.indoorOutdoorProfile || null,
              doorwayProfile: bestOpeningDiagnostics?.profiles?.doorwayProfile || null,
            }
          ),
        },
      };
    });

    return res.status(200).json({
      success: true,
      phase: 'phase_1_quality_gated_selection',
      fulfillmentSummary:best.planSpec?.surveyFulfillment?.summary||null,
      fallbackUsed: engineMeta.fallbackUsed,
      planSpec: best.planSpec,
      estimate: bestEstimate,
      finishSpec: brief?.finishSpec || null,
      svg,
      elevations: best.planSpec?.elevations || {},
      archetype: best.planSpec?.archetype || null,
      galleryId,
      warnings: [
        ...(engineMeta.fallbackUsed ? ['Architect v2 fallback: using legacy generator after v2 candidate rejection.'] : []),
        ...(Array.isArray(best.warnings) ? best.warnings : []),
      ],
      score: best.score,
      scoreIssues: best.scoreIssues,
      footprintInfo: {
        widthFt: num(best.footprint?.widthFt),
        heightFt: num(best.footprint?.heightFt),
        aspectRatio: num(best.footprint?.aspectRatio || getFootprintAspectRatio(best.footprint)),
        totalAreaSqFt: num(best.footprint?.totalAreaSqFt),
      },
      metadata: {
        archetype: best.planSpec?.archetype || null,
        stairCore: best.planSpec?.stairCore || [],
        zones: best.planSpec?.zones || [],
        facade: best.planSpec?.facade || null,
      },
      openingDiagnostics: bestOpeningDiagnostics,
      engine: buildEnginePayload(
        successDiagnostics.buildInfo,
        successDiagnostics.area,
        {
          ...engineMeta,
          openingProfile: bestOpeningDiagnostics?.profiles?.openingProfile || null,
          indoorOutdoorProfile: bestOpeningDiagnostics?.profiles?.indoorOutdoorProfile || null,
          doorwayProfile: bestOpeningDiagnostics?.profiles?.doorwayProfile || null,
        }
      ),
      diagnostics: {
        triedCandidateCount: candidates.length,
        acceptedCandidateCount: accepted.length,
        rejectedCandidateCount: rejected.length,
        rejectedCandidates: rejected,
        architectV2TriedCandidateCount: v2TriedCandidateCount,
        architectV2RejectedCandidates: v2RejectedCandidates,
      },
      alternatives: alternativePayload,
      chatHistory: [
        { role: 'system', parts: [{ text: engineMeta.fallbackUsed ? 'architect_v2_legacy_fallback' : 'deterministic_tile_generator' }] },
        { role: 'model', parts: [{ text: JSON.stringify(best.planSpec) }] },
        ...chatHistory,
      ],
    });
  } catch (err) {
    console.error('PLAN error:', err);
    return res.status(500).json({
      success: false,
      message: String(err?.message || 'Server error'),
      engine: buildEnginePayload(buildInfo, {}, {
        generatorId: 'legacy',
        fallbackUsed: false,
        supportTier: 'legacy_only',
        housePattern: null,
      }),
    });
  }
}

module.exports = handler;
/* The `__ml` escape hatch is gone: candidate generation lives in
   lib/residential/v2/candidateGeneration.js and every consumer imports it
   directly. Nothing should reach into this handler's internals again. */
