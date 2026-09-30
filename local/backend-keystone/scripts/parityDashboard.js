'use strict';

/**
 * Parity Dashboard Probe Script
 *
 * Generates brief combinations spanning the full legacy surface and runs each
 * through resolveArchitectV2Support, then attempts a minimal v2 generation pass
 * for supported briefs to catch runtime failures.
 *
 * Usage:
 *   node backend/scripts/parityDashboard.js [--json] [--runtime] [--verbose] [--threshold 90]
 *
 *   --json      Output machine-readable JSON instead of table
 *   --runtime   Also run v2 generation for supported briefs (slow)
 *   --verbose   Print each brief and its result
 *   --threshold Coverage gate (supportedPct). Exit 1 when below this percentage.
 */

const path = require('path');

// ── Imports ─────────────────────────────────────────────────────────────────
const { normalizeBrief } = require(path.resolve(__dirname, '../lib/tile/normalizeBrief'));
const { resolveArchitectV2Support } = require(path.resolve(__dirname, '../lib/residential/v2/supportMatrix'));

// Optional runtime probe imports (only used with --runtime)
let interpretBriefV2, buildCandidateFootprintsV2, buildProgramV2, planRealmsV2;
let assemblePlanSpecV2, validateArchitectPlanV2;

function loadRuntimeDeps() {
  interpretBriefV2 = require(path.resolve(__dirname, '../lib/residential/v2/interpretBriefV2')).interpretBriefV2;
  buildCandidateFootprintsV2 = require(path.resolve(__dirname, '../lib/residential/v2/candidateFootprintsV2')).buildCandidateFootprintsV2;
  buildProgramV2 = require(path.resolve(__dirname, '../lib/residential/v2/programBuilderV2')).buildProgramV2;
  planRealmsV2 = require(path.resolve(__dirname, '../lib/residential/v2/realmPlannerV2')).planRealmsV2;
  assemblePlanSpecV2 = require(path.resolve(__dirname, '../lib/residential/v2/assemblePlanSpecV2')).assemblePlanSpecV2;
  validateArchitectPlanV2 = require(path.resolve(__dirname, '../lib/residential/v2/validateArchitectPlanV2')).validateArchitectPlanV2;
}

// ── Survey space dimensions ─────────────────────────────────────────────────
const BEDROOMS = [1, 2, 3, 4, 5];
const BATHROOMS = [1, 2, 3, 4];
const STORIES = ['1 Story', '2 Stories'];
const SHAPES = ['Rectangular', 'Wide / U-Shape', 'Deep / L-Shape', 'Square'];
const GARAGE_TYPES = ['None', '1 Car Garage', '2 Car Garage'];
const LOT_CONTEXTS = ['Suburban', 'Urban / Tight Lot', 'Rural / Acreage', 'View / Hillside', 'Waterfront', 'Corner Lot'];
const AREAS = [800, 1000, 1200, 1500, 1800, 2000, 2200, 2400, 2800, 3200, 3600, 4200, 5000];
const FEATURES = [
  '',                // no feature
  'Study',
  'Gym',
  'Library',
  'Gaming Room',
  'Movie Room',
  'Wine Cellar',
  'Music Room',
  'Guest Bedroom',
];
const FRONT_FACING = ['South'];          // not a coverage-gating axis
const NATURAL_LIGHT = ['Balanced'];      // not a coverage-gating axis
const MASTER_LOCATIONS = ['', 'Level 1']; // primary on main vs default
const PRIVATE_BATHS = ['', '1', '2'];

// ── Brief generator ─────────────────────────────────────────────────────────

function* generateBriefs() {
  for (const stories of STORIES) {
    for (const bedrooms of BEDROOMS) {
      for (const bathrooms of BATHROOMS) {
        for (const shape of SHAPES) {
          for (const garage of GARAGE_TYPES) {
            for (const lotContext of LOT_CONTEXTS) {
              for (const area of AREAS) {
                for (const feature of FEATURES) {
                  yield {
                    totalArea: String(area),
                    stories,
                    bedrooms: String(bedrooms),
                    bathrooms: String(bathrooms),
                    shape,
                    garage,
                    lotContext,
                    features: feature,
                    frontFacing: 'South',
                    naturalLight: 'Balanced',
                    openConcept: 'Open concept',
                    indoorOutdoor: 'Moderate',
                    budgetTier: 'Mid-range',
                  };
                }
              }
            }
          }
        }
      }
    }
  }
}

// Count total combos without materializing
function countBriefs() {
  return BEDROOMS.length * BATHROOMS.length * STORIES.length * SHAPES.length *
    GARAGE_TYPES.length * LOT_CONTEXTS.length * AREAS.length * FEATURES.length;
}

function parseThresholdArg(argv, fallback = 90) {
  const args = Array.isArray(argv) ? argv : [];
  let threshold = Number(fallback);

  for (let index = 0; index < args.length; index++) {
    const token = String(args[index] || '');
    if (token === '--threshold') {
      const raw = args[index + 1];
      if (raw === undefined) throw new Error('--threshold requires a numeric value');
      threshold = Number(raw);
      index += 1;
      continue;
    }
    if (token.startsWith('--threshold=')) {
      threshold = Number(token.slice('--threshold='.length));
    }
  }

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error(`--threshold must be a number between 0 and 100 (received: ${threshold})`);
  }
  return threshold;
}

// ── Runtime probe ───────────────────────────────────────────────────────────

function tryV2Generation(brief, support) {
  try {
    const interpretation = interpretBriefV2(brief, support);
    const footprints = buildCandidateFootprintsV2(brief, interpretation);
    if (!footprints.length) return { ok: false, reason: 'no_footprints' };

    // Try first 3 footprints (one per variation profile if available)
    const tried = Math.min(3, footprints.length);
    const errors = [];
    for (let i = 0; i < tried; i++) {
      try {
        const footprint = footprints[i];
        const program = buildProgramV2(brief, interpretation);
        const layout = planRealmsV2({ brief, interpretation, footprint, program });
        const planSpec = assemblePlanSpecV2(layout, brief, footprint, interpretation);
        const validation = validateArchitectPlanV2(planSpec, brief);
        if (!validation.errors.length) {
          return { ok: true };
        }
        errors.push(...validation.errors);
      } catch (err) {
        errors.push(`runtime:${err.message}`);
      }
    }
    return { ok: false, reason: 'all_candidates_failed', errors: errors.slice(0, 5) };
  } catch (err) {
    return { ok: false, reason: 'generation_exception', error: err.message };
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function run(argv = process.argv.slice(2)) {
  const args = new Set(Array.isArray(argv) ? argv : []);
  const threshold = parseThresholdArg(argv, 90);
  const jsonOutput = args.has('--json');
  const runtimeProbe = args.has('--runtime');
  const verbose = args.has('--verbose');

  if (runtimeProbe) loadRuntimeDeps();

  const total = countBriefs();
  if (!jsonOutput) {
    console.log(`\nParity Dashboard — probing ${total.toLocaleString()} brief combinations\n`);
    if (runtimeProbe) console.log('  (runtime probe enabled — this may take a while)\n');
  }

  // Accumulators
  let supported = 0;
  let blocked = 0;
  let runtimeOk = 0;
  let runtimeFailed = 0;
  const reasonCounts = {};
  const blockedFamilies = {};          // familyKey -> { count, reasons }
  const validatorFailures = {};        // validator/error -> count
  let processed = 0;

  for (const surveyData of generateBriefs()) {
    processed++;
    const brief = normalizeBrief(surveyData);
    const support = resolveArchitectV2Support(brief);

    if (support.supported) {
      supported++;

      if (runtimeProbe) {
        const result = tryV2Generation(brief, support);
        if (result.ok) {
          runtimeOk++;
        } else {
          runtimeFailed++;
          const errKey = result.reason || 'unknown';
          validatorFailures[errKey] = (validatorFailures[errKey] || 0) + 1;
          if (result.errors) {
            for (const e of result.errors) {
              const shortErr = String(e).slice(0, 80);
              validatorFailures[shortErr] = (validatorFailures[shortErr] || 0) + 1;
            }
          }
          if (verbose) {
            console.log(`  RUNTIME FAIL: ${JSON.stringify(surveyData)} -> ${result.reason}`);
          }
        }
      }
    } else {
      blocked++;
      for (const reason of support.reasons) {
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      }

      // Track family-level blocking
      const familyKey = `${brief.stories}s_${brief.bedrooms}b_${brief.bathrooms}ba_${brief.shape}_${brief.garageType}_${brief.lotContext}`;
      if (!blockedFamilies[familyKey]) {
        blockedFamilies[familyKey] = { count: 0, reasons: new Set() };
      }
      blockedFamilies[familyKey].count++;
      for (const r of support.reasons) blockedFamilies[familyKey].reasons.add(r);

      if (verbose) {
        console.log(`  BLOCKED: ${familyKey} [${support.reasons.join(', ')}]`);
      }
    }

    // Progress indicator
    if (!jsonOutput && !verbose && processed % 10000 === 0) {
      process.stdout.write(`  ...${processed.toLocaleString()} / ${total.toLocaleString()}\r`);
    }
  }

  // ── Compute summary ───────────────────────────────────────────────────────
  const fallbackMismatch = runtimeProbe ? runtimeFailed : null;
  const supportedPct = ((supported / total) * 100).toFixed(1);
  const blockedPct = ((blocked / total) * 100).toFixed(1);

  // Top blocked reasons sorted by count
  const sortedReasons = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1]);

  // Top missing families (blocked, sorted by count)
  const topMissing = Object.entries(blockedFamilies)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([key, val]) => ({
      family: key,
      blockedBriefs: val.count,
      reasons: [...val.reasons],
    }));

  // Top validator failures (runtime probe only)
  const sortedValidatorFailures = Object.entries(validatorFailures)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // ── Output ────────────────────────────────────────────────────────────────

  const report = {
    timestamp: new Date().toISOString(),
    threshold,
    total,
    supported,
    supportedPct: parseFloat(supportedPct),
    blocked,
    blockedPct: parseFloat(blockedPct),
    fallbackMismatch,
    runtimeOk: runtimeProbe ? runtimeOk : null,
    runtimeFailed: runtimeProbe ? runtimeFailed : null,
    blockReasonBreakdown: Object.fromEntries(sortedReasons),
    topMissingFamilies: topMissing,
    hardFailuresByValidator: runtimeProbe ? Object.fromEntries(sortedValidatorFailures) : null,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║              V2 PARITY DASHBOARD RESULTS                 ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  Total briefs probed:    ${String(total).padStart(8)}                    ║`);
    console.log(`║  V2 supported:           ${String(supported).padStart(8)}  (${supportedPct.padStart(5)}%)          ║`);
    console.log(`║  Blocked (legacy):       ${String(blocked).padStart(8)}  (${blockedPct.padStart(5)}%)          ║`);
    console.log(`║  Coverage threshold:     ${String(threshold).padStart(8)}%                    ║`);
    if (runtimeProbe) {
      console.log('╠───────────────────────────────────────────────────────────╣');
      console.log(`║  Runtime OK:             ${String(runtimeOk).padStart(8)}                    ║`);
      console.log(`║  Runtime failed:         ${String(runtimeFailed).padStart(8)}  (fallback mismatch) ║`);
    }
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║  BLOCK REASON BREAKDOWN                                  ║');
    console.log('╠───────────────────────────────────────────────────────────╣');
    for (const [reason, count] of sortedReasons.slice(0, 15)) {
      const pct = ((count / blocked) * 100).toFixed(1);
      console.log(`║  ${reason.padEnd(38)} ${String(count).padStart(7)} (${pct.padStart(5)}%) ║`);
    }
    if (runtimeProbe && sortedValidatorFailures.length) {
      console.log('╠═══════════════════════════════════════════════════════════╣');
      console.log('║  HARD FAILURES BY VALIDATOR (runtime probe)              ║');
      console.log('╠───────────────────────────────────────────────────────────╣');
      for (const [validator, count] of sortedValidatorFailures) {
        console.log(`║  ${validator.slice(0, 38).padEnd(38)} ${String(count).padStart(7)}       ║`);
      }
    }
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║  TOP MISSING FAMILIES                                    ║');
    console.log('╠───────────────────────────────────────────────────────────╣');
    for (const fam of topMissing.slice(0, 10)) {
      console.log(`║  ${fam.family.padEnd(42)} ${String(fam.blockedBriefs).padStart(6)}   ║`);
      console.log(`║    reasons: ${fam.reasons.slice(0, 3).join(', ').slice(0, 46).padEnd(46)} ║`);
    }
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
  }

  return report;
}

if (require.main === module) {
  let report = null;
  try {
    report = run(process.argv.slice(2));
  } catch (error) {
    console.error(`[parityDashboard] ${String(error?.message || error)}`);
    process.exit(1);
  }

  if (Number(report?.supportedPct) < Number(report?.threshold)) {
    console.error(
      `[parityDashboard] Coverage gate failed: supportedPct=${report.supportedPct}% < threshold=${report.threshold}%`
    );
    process.exit(1);
  }

  process.exit(0);
}

module.exports = {
  run,
  parseThresholdArg,
};
