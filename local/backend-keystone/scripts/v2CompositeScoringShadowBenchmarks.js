'use strict';

const path = require('path');

const { normalizeBrief } = require(path.resolve(__dirname, '../lib/tile/normalizeBrief'));
const { resolveArchitectV2Support } = require(path.resolve(__dirname, '../lib/residential/v2/supportMatrix'));
const { interpretBriefV2 } = require(path.resolve(__dirname, '../lib/residential/v2/interpretBriefV2'));
const { buildCandidateFootprintsV2 } = require(path.resolve(__dirname, '../lib/residential/v2/candidateFootprintsV2'));
const {
  scoreArchitectV2Candidates,
  scoreCompositeV2,
} = require(path.resolve(__dirname, '../lib/residential/v2/scoring'));
const planHandler = require(path.resolve(__dirname, '../api/plan'));

const {
  tryGenerateArchitectV2Candidate,
  rankAcceptedCandidates,
} = require(path.resolve(__dirname, '../lib/residential/v2/candidateGeneration'));

const GATES = Object.freeze({
  changedWinnerRateMax: 0.35,
  changedWinnerMinCompositeGain: 2,
});

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(Array.isArray(argv) ? argv : []);
  return {
    json: args.has('--json'),
    strict: args.has('--strict'),
    includeMatrix: !args.has('--showcase-only'),
  };
}

function baseSurvey(overrides = {}) {
  return {
    location: '',
    totalArea: '2400',
    stories: '2 Stories',
    bedrooms: '2 Bed',
    bathrooms: '2 Bath',
    privateBaths: '1',
    bedroomConfigs: null,
    shape: 'Rectangular',
    garage: '1 Car Garage',
    materials: 'Craftsman (Wood & Stone)',
    openConcept: 'Open Concept (Combined)',
    masterLocation: 'Level 2 (Upper)',
    kitchenPlacement: 'Rear of House',
    features: '',
    frontFacing: 'South',
    lotContext: 'Suburban standard lot',
    laundryLocation: 'Level 1 (near garage/mud)',
    ceilingHeight: 'Standard (9 ft)',
    indoorOutdoor: 'Moderate (some connection)',
    naturalLight: 'Balanced windows',
    accessibilityNeeds: 'None',
    budgetTier: 'Mid ($200-300/sqft)',
    freeformWishes: '',
    ...overrides,
  };
}

function showcasePayloads() {
  return [
    { id: 'showcase_1800_2bed2bath_garage', surveyData: baseSurvey({ totalArea: '1800' }) },
    {
      id: 'showcase_1800_3bed3bath_garage',
      surveyData: baseSurvey({ totalArea: '1800', bedrooms: '3 Bed', bathrooms: '3 Bath' }),
    },
    { id: 'showcase_2399_2bed2bath_garage', surveyData: baseSurvey({ totalArea: '2399' }) },
    {
      id: 'showcase_2400_2bed2bath_study_garage',
      surveyData: baseSurvey({ totalArea: '2400', features: '1 Study' }),
    },
    {
      id: 'showcase_2400_3bed3bath_garage',
      surveyData: baseSurvey({ totalArea: '2400', bedrooms: '3 Bed', bathrooms: '3 Bath' }),
    },
  ];
}

function matrixPayloads() {
  const areas = ['1800', '2100', '2400', '3000', '3200'];
  const bedrooms = ['2 Bed', '3 Bed'];
  const bathrooms = ['2 Bath', '3 Bath'];
  const garages = ['1 Car Garage', 'No Garage'];
  const features = ['', '1 Study', '1 Gym'];
  const payloads = [];

  for (const area of areas) {
    for (const bed of bedrooms) {
      for (const bath of bathrooms) {
        for (const garage of garages) {
          for (const feature of features) {
            payloads.push({
              id: `matrix_${area}_${bed.replace(/\s+/g, '').toLowerCase()}_${bath.replace(/\s+/g, '').toLowerCase()}_${garage.includes('No') ? 'nogarage' : 'garage'}_${feature ? feature.replace(/\s+/g, '').toLowerCase() : 'nofeature'}`,
              surveyData: baseSurvey({
                totalArea: area,
                bedrooms: bed,
                bathrooms: bath,
                garage,
                features: feature,
              }),
            });
          }
        }
      }
    }
  }

  return payloads;
}

function planGeometrySignature(planSpec) {
  return (Array.isArray(planSpec?.levels) ? planSpec.levels : [])
    .map((level) => {
      const roomSig = (Array.isArray(level?.rooms) ? level.rooms : [])
        .map((room) => `${room?.type}:${room?.x},${room?.y},${room?.w},${room?.h}`)
        .sort()
        .join('|');
      return `L${level?.level}:${level?.width}x${level?.height}:${roomSig}`;
    })
    .join('||');
}

function runCandidateSetForMode(brief, surveyData, mode) {
  const support = resolveArchitectV2Support(brief);
  if (!support.supported) {
    return {
      fallbackUsed: true,
      reason: 'unsupported',
      supportReasons: support.reasons || [],
    };
  }

  const interpretation = interpretBriefV2(brief, support);
  const footprints = buildCandidateFootprintsV2(brief, interpretation);
  const accepted = [];

  for (const footprint of footprints) {
    const candidate = tryGenerateArchitectV2Candidate(brief, interpretation, footprint, surveyData, { skipElevation: true });
    if (candidate.ok) accepted.push(candidate.result);
  }

  if (!accepted.length) {
    return {
      fallbackUsed: true,
      reason: 'no_accepted_candidates',
      supportReasons: support.reasons || [],
    };
  }

  const scored = scoreArchitectV2Candidates(accepted, brief, {
    compositeEnabled: mode === 'composite',
  });
  const ranked = rankAcceptedCandidates(scored, { scoringMode: mode });
  const best = ranked[0];

  return {
    fallbackUsed: false,
    reason: null,
    best,
    ranked,
    score: num(best?.score),
    scoreBreakdown: best?.scoreBreakdown || null,
    winnerSignature: planGeometrySignature(best?.planSpec),
    alternativesCount: Math.max(0, ranked.length - 1),
  };
}

function evaluateDeterminism(payload, mode, repeats = 3) {
  const runs = [];
  for (let index = 0; index < repeats; index++) {
    const brief = normalizeBrief(payload.surveyData);
    runs.push(runCandidateSetForMode(brief, payload.surveyData, mode));
  }
  const first = runs[0];
  const deterministic = runs.every((run) => {
    if (Boolean(run?.fallbackUsed) !== Boolean(first?.fallbackUsed)) return false;
    if (run?.fallbackUsed) return String(run?.reason || '') === String(first?.reason || '');
    return (
      String(run?.winnerSignature || '') === String(first?.winnerSignature || '') &&
      num(run?.score) === num(first?.score)
    );
  });
  return {
    deterministic,
    runs,
    chosen: first,
  };
}

function evaluatePayload(payload) {
  const basicEval = evaluateDeterminism(payload, 'basic', 3);
  const compositeEval = evaluateDeterminism(payload, 'composite', 3);
  const basic = basicEval.chosen;
  const composite = compositeEval.chosen;

  const winnerChanged = !basic?.fallbackUsed &&
    !composite?.fallbackUsed &&
    String(basic?.winnerSignature || '') !== String(composite?.winnerSignature || '');

  let compositeGain = 0;
  if (!basic?.fallbackUsed && !composite?.fallbackUsed) {
    const brief = normalizeBrief(payload.surveyData);
    const basicWinnerComposite = scoreCompositeV2({
      planSpec: basic?.best?.planSpec,
      brief,
      graph: basic?.best?.graph || null,
    });
    compositeGain = num(composite?.scoreBreakdown?.total) - num(basicWinnerComposite?.total);
  }

  return {
    id: payload.id,
    deterministicBasic: basicEval.deterministic,
    deterministicComposite: compositeEval.deterministic,
    basic,
    composite,
    winnerChanged,
    compositeGain,
  };
}

function buildReport(options) {
  const payloads = [
    ...showcasePayloads(),
    ...(options.includeMatrix ? matrixPayloads() : []),
  ];
  const results = payloads.map((payload) => evaluatePayload(payload));

  const compared = results.filter((result) => !result.basic?.fallbackUsed && !result.composite?.fallbackUsed);
  const changedWinners = compared.filter((result) => result.winnerChanged);
  const alternativeDrops = compared.filter((result) => num(result.composite?.alternativesCount) < num(result.basic?.alternativesCount));
  const gainFailures = changedWinners.filter((result) => num(result.compositeGain) < GATES.changedWinnerMinCompositeGain);
  const deterministicFailures = results.filter((result) => !result.deterministicBasic || !result.deterministicComposite);
  const basicFallbacks = results.filter((result) => result.basic?.fallbackUsed).length;
  const compositeFallbacks = results.filter((result) => result.composite?.fallbackUsed).length;
  const changedWinnerRate = compared.length ? changedWinners.length / compared.length : 0;

  const gates = {
    deterministicPass: deterministicFailures.length === 0,
    fallbackPass: compositeFallbacks <= basicFallbacks,
    alternativesPass: alternativeDrops.length === 0,
    changedWinnerGainPass: gainFailures.length === 0,
    changedWinnerRatePass: changedWinnerRate <= GATES.changedWinnerRateMax,
  };
  const canFlipDefault = Object.values(gates).every(Boolean);

  return {
    timestamp: new Date().toISOString(),
    payloadCount: payloads.length,
    comparedCount: compared.length,
    changedWinners: changedWinners.length,
    changedWinnerRate: Number(changedWinnerRate.toFixed(4)),
    basicFallbacks,
    compositeFallbacks,
    gates,
    canFlipDefault,
    gateThresholds: GATES,
    failures: {
      deterministic: deterministicFailures.map((item) => item.id),
      alternativesDropped: alternativeDrops.map((item) => item.id),
      changedWinnerCompositeGain: gainFailures.map((item) => ({
        id: item.id,
        compositeGain: Number(num(item.compositeGain).toFixed(3)),
      })),
    },
    results: results.map((item) => ({
      id: item.id,
      deterministicBasic: item.deterministicBasic,
      deterministicComposite: item.deterministicComposite,
      basicFallbackUsed: Boolean(item.basic?.fallbackUsed),
      compositeFallbackUsed: Boolean(item.composite?.fallbackUsed),
      basicWinnerScore: num(item.basic?.score),
      compositeWinnerScore: num(item.composite?.score),
      basicAlternatives: num(item.basic?.alternativesCount),
      compositeAlternatives: num(item.composite?.alternativesCount),
      winnerChanged: Boolean(item.winnerChanged),
      compositeGain: Number(num(item.compositeGain).toFixed(3)),
    })),
  };
}

function printHuman(report) {
  console.log('\nPhase 7 Composite Scoring Shadow Benchmarks');
  console.log('===========================================');
  console.log(`Payloads: ${report.payloadCount}`);
  console.log(`Compared: ${report.comparedCount}`);
  console.log(`Changed winners: ${report.changedWinners} (${(report.changedWinnerRate * 100).toFixed(1)}%)`);
  console.log(`Fallbacks (basic -> composite): ${report.basicFallbacks} -> ${report.compositeFallbacks}`);
  console.log(`Gate deterministic: ${report.gates.deterministicPass ? 'PASS' : 'FAIL'}`);
  console.log(`Gate fallback: ${report.gates.fallbackPass ? 'PASS' : 'FAIL'}`);
  console.log(`Gate alternatives: ${report.gates.alternativesPass ? 'PASS' : 'FAIL'}`);
  console.log(`Gate changed-winner gain >= ${report.gateThresholds.changedWinnerMinCompositeGain}: ${report.gates.changedWinnerGainPass ? 'PASS' : 'FAIL'}`);
  console.log(`Gate changed-winner rate <= ${(report.gateThresholds.changedWinnerRateMax * 100).toFixed(0)}%: ${report.gates.changedWinnerRatePass ? 'PASS' : 'FAIL'}`);
  console.log(`Default flip recommendation: ${report.canFlipDefault ? 'ALLOW' : 'HOLD'}`);
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = buildReport(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }

  if (options.strict && !report.canFlipDefault) {
    process.exit(1);
  }
}

if (require.main === module) {
  run(process.argv.slice(2));
}

module.exports = {
  run,
  evaluatePayload,
  buildReport,
};

