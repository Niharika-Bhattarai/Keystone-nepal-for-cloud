'use strict';

const fs = require('fs');
const path = require('path');

const { normalizeBrief } = require('../../lib/tile/normalizeBrief');
const { computeFootprintCandidates } = require('../../lib/tile/computeFootprint');
const { renderPlanSvg } = require('../../lib/renderPlanSvg');
const planHandler = require('../../api/plan');
const { SIZE_BAND_MATRIX } = require('./sizeBandMatrix');

const {
  tryGenerateCandidate,
  rankAcceptedCandidates,
} = require('../../lib/residential/v2/candidateGeneration');

const ZONE_VARIANTS = [0, 0.14, -0.12];
const NUM_CANDIDATES = 100;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toFileSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function collectCandidates(surveyData) {
  const brief = normalizeBrief(surveyData);
  const footprints = computeFootprintCandidates(brief, 2, NUM_CANDIDATES);
  const accepted = [];
  const softRejected = [];
  const rejectedDiagnostics = [];

  for (const footprint of footprints) {
    for (const zoneBias of ZONE_VARIANTS) {
      const briefVariant = zoneBias !== 0
        ? { ...brief, layoutVariantBias: zoneBias }
        : brief;
      const candidate = tryGenerateCandidate(briefVariant, footprint, surveyData);
      if (candidate.ok) {
        accepted.push(candidate.result);
      } else {
        rejectedDiagnostics.push(...(candidate.diagnostics || []));
        if (candidate.fallbackResult) softRejected.push(candidate.fallbackResult);
      }
    }
  }

  return {
    brief,
    footprints,
    accepted,
    softRejected,
    rejectedDiagnostics,
  };
}

function selectBestResult(accepted, softRejected) {
  if (accepted.length) {
    const rankedAccepted = rankAcceptedCandidates(accepted);
    return {
      phase: 'accepted',
      best: rankedAccepted[0],
      ranked: rankedAccepted,
    };
  }

  if (softRejected.length) {
    const rankedFallback = rankAcceptedCandidates(softRejected);
    return {
      phase: 'soft_fallback',
      best: rankedFallback[0],
      ranked: rankedFallback,
    };
  }

  return {
    phase: 'failed',
    best: null,
    ranked: [],
  };
}

function summarizeResult(result, extras = {}) {
  if (!result) {
    return {
      success: false,
      ...extras,
    };
  }

  const planSpec = result.planSpec || {};
  const levels = Array.isArray(planSpec.levels) ? planSpec.levels : [];
  const allRooms = levels.flatMap((level) => Array.isArray(level?.rooms) ? level.rooms : []);

  return {
    success: true,
    score: result.score,
    scoreIssues: result.scoreIssues || [],
    warnings: result.warnings || [],
    footprint: {
      widthFt: result.footprint?.widthFt || null,
      heightFt: result.footprint?.heightFt || null,
      totalAreaSqFt: result.footprint?.totalAreaSqFt || null,
      aspectRatio: result.footprint?.aspectRatio || null,
    },
    archetype: planSpec.archetype || null,
    levelCount: levels.length,
    roomCount: allRooms.length,
    roomLabels: allRooms.map((room) => room.label || room.type || room.id),
    ...extras,
  };
}

function runScenario(outputRoot, band, scenario) {
  const scenarioDir = path.join(
    outputRoot,
    `${String(band.areaSqFt)}sqft`,
    `${toFileSlug(scenario.id)}`
  );
  ensureDir(scenarioDir);

  const candidatePack = collectCandidates(scenario.surveyData);
  const selection = selectBestResult(candidatePack.accepted, candidatePack.softRejected);
  const best = selection.best;

  const summary = summarizeResult(best, {
    areaSqFt: band.areaSqFt,
    family: band.family,
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    phase: selection.phase,
    acceptedCount: candidatePack.accepted.length,
    softRejectedCount: candidatePack.softRejected.length,
    rejectedDiagnosticCount: candidatePack.rejectedDiagnostics.length,
  });

  const payload = {
    areaSqFt: band.areaSqFt,
    family: band.family,
    scenario: {
      id: scenario.id,
      label: scenario.label,
      surveyData: scenario.surveyData,
    },
    brief: candidatePack.brief,
    summary,
    topCandidates: selection.ranked.slice(0, 3).map((item, index) => ({
      rank: index + 1,
      score: item.score,
      scoreIssues: item.scoreIssues || [],
      warnings: item.warnings || [],
      footprint: item.footprint || null,
      archetype: item.planSpec?.archetype || null,
    })),
    rejectedDiagnostics: candidatePack.rejectedDiagnostics,
  };

  writeJson(path.join(scenarioDir, 'summary.json'), payload);

  if (best?.planSpec) {
    writeJson(path.join(scenarioDir, 'planSpec.json'), best.planSpec);
    fs.writeFileSync(path.join(scenarioDir, 'plan.svg'), renderPlanSvg(best.planSpec), 'utf8');
  }

  return {
    ...summary,
    outputDir: scenarioDir,
  };
}

function selectBestScenarioByBand(results) {
  const valid = results.filter((item) => item.success);
  if (!valid.length) return null;
  return [...valid].sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    const aPenalty = (a.scoreIssues || []).length + (a.warnings || []).length;
    const bPenalty = (b.scoreIssues || []).length + (b.warnings || []).length;
    if (aPenalty !== bPenalty) return aPenalty - bPenalty;
    return String(a.scenarioId).localeCompare(String(b.scenarioId));
  })[0];
}

function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputRoot = path.join(__dirname, '..', '..', 'data', 'size-band-benchmarks', stamp);
  ensureDir(outputRoot);

  const manifest = {
    generatedAt: new Date().toISOString(),
    outputRoot,
    sizeBands: [],
  };

  for (const band of SIZE_BAND_MATRIX) {
    const scenarioResults = band.scenarios.map((scenario) => runScenario(outputRoot, band, scenario));
    manifest.sizeBands.push({
      areaSqFt: band.areaSqFt,
      family: band.family,
      bestScenario: selectBestScenarioByBand(scenarioResults),
      scenarios: scenarioResults,
    });
  }

  writeJson(path.join(outputRoot, 'manifest.json'), manifest);
  console.log(`Benchmark written to ${outputRoot}`);
}

if (require.main === module) {
  main();
}
