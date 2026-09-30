'use strict';
// Measure which home types deliver valid plans, and over which areas, with the
// payload the Studio sends (per-bedroom settings: the primary with an en-suite
// when there is more than one bathroom and a walk-in closet, the others shared
// with reach-in closets). The structural support gates are lifted for the
// measurement; every returned plan must pass the independent validators.
//
//   node scripts/benchmark/measure-support.cjs <out-dir> [--shard=i/n] [--standard-closets | --no-closets]
//   node scripts/benchmark/measure-support.cjs --table[-standard-closets|-without-closets] <out-dir> [<out-dir> ...]
//
// The first form writes rows (results.jsonl). The second reads rows from one
// or more directories and writes lib/residential/v2/measuredSupportTable.json:
// for each home type, the area ranges in which every measured area delivered.
// Areas between two delivering measurements count as supported; an area
// between a delivering and a failing measurement does not.
const fs = require('node:fs');
const path = require('node:path');

const AREAS = [600, 700, 800, 900, 1000, 1100, 1200, 1350, 1500, 1650, 1800, 2000, 2200, 2400, 2800, 3200, 3600, 4000, 5000, 6000, 7500, 10000];
const GARAGES = ['No Garage', '1 Car Garage', '2 Car Garage'];
// Gates the measurement replaces (supportMatrix.MEASURED_GATES).
const LIFTED = ['area_too_small_for_v2', 'bedrooms_out_of_range', 'bathrooms_out_of_range', 'primary_without_ensuite_topology_not_supported',
  'one_story_public_spine_requires_min_1200_sqft', 'one_story_garage_requires_min_1500_sqft', 'one_story_four_bed_requires_min_1800_sqft',
  'one_story_four_bed_requires_min_2200_sqft', 'one_story_five_bed_requires_min_2400_sqft', 'one_story_five_bed_requires_min_2800_sqft',
  'two_story_garage_requires_min_1800_sqft', 'two_story_compact_three_bed_requires_min_1800_sqft', 'two_story_compact_two_bed_requires_min_1500_sqft',
  'two_story_five_bed_requires_min_3000_sqft', 'two_story_four_bed_requires_min_2400_sqft', 'one_story_area_above_measured', 'measured_area_out_of_range'];

function signature({ stories, bedrooms, bathrooms, garage }) {
  const g = garage === 'No Garage' || garage === 'NONE' ? 'none' : /2|TWO/.test(garage) ? 'two' : 'one';
  return `${stories}s-${bedrooms}b-${bathrooms}ba-${g}`;
}

// --no-closets: the payload without per-bedroom settings (no closets asked
// for), which the API and older clients send; measured into its own ranges.
const NO_CLOSETS = process.argv.includes('--no-closets');
// --standard-closets: every bedroom with a standard (reach-in) closet.
const STANDARD_CLOSETS = process.argv.includes('--standard-closets');
// --main-floor-primary: two storeys with the primary suite on the main floor
// (the primary en-suite the only private bath; --one-car for the one-car garage only); its tables
// go under `mainFloorPrimary`.
const MAIN_FLOOR = process.argv.includes('--main-floor-primary');

function cases() {
  const { base } = require('./studio-full-coverage.cjs');
  const out = [];
  for (const stories of MAIN_FLOOR ? [2] : [1, 2]) for (let b = MAIN_FLOOR ? 2 : 1; b <= 5; b++) for (let ba = Math.max(MAIN_FLOOR ? 2 : 1, b - 2); ba <= b + 1; ba++)
    for (const garage of MAIN_FLOOR && process.argv.includes('--one-car') ? ['1 Car Garage'] : GARAGES) for (const area of AREAS) {
      const attached = ba > 1 ? 1 : 0;
      out.push({ id: `${signature({ stories, bedrooms: b, bathrooms: ba, garage })}-${area}`, sig: signature({ stories, bedrooms: b, bathrooms: ba, garage }), area,
        survey: { ...base, stories: stories === 1 ? '1 Story' : '2 Stories', bedrooms: `${b} Bed`, bathrooms: `${ba} Bath`, totalArea: String(area), garage,
          masterLocation: stories === 1 || MAIN_FLOOR ? 'Level 1 (Main)' : 'Level 2 (Upper)', privateBaths: String(attached),
          bedroomConfigs: NO_CLOSETS ? null : Array.from({ length: b }, (_, i) => ({ privateBath: i < attached ? 'Yes' : 'No', closet: i === 0 && !STANDARD_CLOSETS ? 'Walk-in' : 'Standard' })) } });
    }
  return out;
}

async function measure(outDir, shard) {
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  process.env.KEYSTONE_MEASURING_SUPPORT = '1'; // supportMatrix skips the measured table
  console.warn = () => {};
  const sm = require('../../lib/residential/v2/supportMatrix');
  const original = sm.resolveArchitectV2Support;
  const lifted = new Set(LIFTED);
  sm.resolveArchitectV2Support = (brief) => {
    const r = original(brief);
    if (r.supported) return r;
    const reasons = r.reasons.filter((c) => !lifted.has(c) && c !== 'house_pattern_not_supported');
    if (reasons.length) return r;
    const housePattern = sm.resolveHousePattern(brief);
    return housePattern ? { ...r, supported: true, generatorId: 'architect_v2', supportTier: 'wave1', housePattern, reasons: [] } : r;
  };
  const planHandler = require('../../api/plan');
  const { validateEditedPlan } = require('../../lib/validateEditedPlan');
  const { validateVariationDiversityV2 } = require('../../lib/residential/v2/diversityMetricV2');
  const invoke = (s) => new Promise((ok, fail) => {
    const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { ok(b); return this; } };
    Promise.resolve(planHandler({ method: 'POST', body: { surveyData: s }, headers: {} }, res)).catch(fail);
  });
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'results.jsonl');
  const done = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((l) => { try { return [JSON.parse(l).id]; } catch { return []; } }) : []);
  // --sig=1s-4b-2ba-one,... measures only those home types.
  const sigs = process.argv.find((a) => a.startsWith('--sig='))?.slice(6).split(',');
  // --areas=6000,7500 measures only those areas.
  const areas = process.argv.find((a) => a.startsWith('--areas='))?.slice(8).split(',').map(Number);
  const all = cases().filter((c) => (!sigs || sigs.includes(c.sig)) && (!areas || areas.includes(c.area))).filter((_, i) => !shard || i % shard[1] === shard[0]);
  for (const c of all) {
    if (done.has(c.id)) continue;
    const t = Date.now();
    let row;
    try {
      const body = await invoke(c.survey);
      const plans = body.success && body.planSpec ? [body.planSpec, ...(body.alternatives || []).map((o) => o.planSpec)] : [];
      const errors = plans.flatMap((p) => validateEditedPlan(p, c.survey));
      row = { id: c.id, sig: c.sig, area: c.area, plans: plans.length, valid: plans.length > 0 && errors.length === 0,
        diverse: plans.length >= 3 && Boolean(validateVariationDiversityV2(plans)?.valid), code: body.code || null, ms: Date.now() - t };
    } catch (error) {
      row = { id: c.id, sig: c.sig, area: c.area, plans: 0, valid: false, diverse: false, code: 'RUNNER_ERROR', error: error.message, ms: Date.now() - t };
    }
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  }
}

function table(dirs, key = 'ranges', group = null) {
  const rows = new Map();
  for (const dir of dirs) {
    for (const line of fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean)) {
      const r = JSON.parse(line);
      rows.set(r.id, r);
    }
  }
  const bySig = new Map();
  for (const r of rows.values()) (bySig.get(r.sig) || bySig.set(r.sig, []).get(r.sig)).push(r);
  const out = {};
  for (const [sig, list] of [...bySig].sort()) {
    list.sort((a, b) => a.area - b.area);
    const ranges = [];
    let current = null;
    for (const r of list) {
      if (r.valid) {
        if (current) current[1] = r.area; else current = [r.area, r.area];
      } else if (current) { ranges.push(current); current = null; }
    }
    if (current) ranges.push(current);
    out[sig] = ranges;
  }
  const target = path.resolve(__dirname, '../../lib/residential/v2/measuredSupportTable.json');
  const existing = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
  const entry = group ? { [group]: { ...(existing[group] || {}), [key]: out } } : { [key]: out };
  fs.writeFileSync(target, JSON.stringify({
    ...existing,
    description: 'Area ranges (sq ft) in which each home type delivered valid plans with default settings: `ranges` with the Studio payload (per-bedroom settings, a walk-in for the primary and reach-ins for the others), `rangesStandardClosets` with a standard (reach-in) closet in every bedroom, `rangesWithoutClosets` with no per-bedroom settings (no closets asked for). Generated by scripts/benchmark/measure-support.cjs --table / --table-standard-closets / --table-without-closets; do not edit by hand.',
    measuredOn: new Date().toISOString().slice(0, 10), areas: AREAS, ...entry }, null, 1) + '\n');
  console.log(`wrote ${Object.keys(out).length} home types (${group ? `${group}.` : ''}${key}) to ${target}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--table') table(args.slice(1));
  else if (args[0] === '--table-without-closets') table(args.slice(1), 'rangesWithoutClosets');
  else if (args[0] === '--table-standard-closets') table(args.slice(1), 'rangesStandardClosets');
  // --table-main-floor[-standard-closets|-without-closets]: the main-floor suite's tables.
  else if (args[0] === '--table-main-floor') table(args.slice(1), 'ranges', 'mainFloorPrimary');
  else if (args[0] === '--table-main-floor-standard-closets') table(args.slice(1), 'rangesStandardClosets', 'mainFloorPrimary');
  else if (args[0] === '--table-main-floor-without-closets') table(args.slice(1), 'rangesWithoutClosets', 'mainFloorPrimary');
  else {
    const shard = args.find((a) => a.startsWith('--shard='))?.slice(8).split('/').map(Number);
    measure(path.resolve(args[0]), shard).catch((e) => { console.error(e); process.exitCode = 1; });
  }
}
module.exports = { signature, AREAS, LIFTED };
