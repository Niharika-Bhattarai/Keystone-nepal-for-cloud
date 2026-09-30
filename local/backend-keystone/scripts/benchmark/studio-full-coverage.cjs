'use strict';

// High-coverage regression sweep for the controls in frontend-keystone's Studio.
// The complete Cartesian product is not finite: area/lot inputs and free text
// accept effectively arbitrary user values, and feature rooms can be repeated.
// This suite therefore exhausts the structural grid, all optional-room presence
// masks, every bedroom-config pattern by count, all discrete option pairs, and
// defined numeric boundary cases. Every individual row is written as it runs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const planHandler = require('../../api/plan');
const preflightHandler = require('../../api/plan_preflight');
const { validateEditedPlan } = require('../../lib/validateEditedPlan');
const { validateVariationDiversityV2 } = require('../../lib/residential/v2/diversityMetricV2');
const { buildSurveyFulfillment } = require('../../lib/surveyFulfillment');

const base = {
  location: '', totalArea: '2400', stories: '2 Stories', bedrooms: '3 Bed', bathrooms: '3 Bath', privateBaths: '1',
  garage: '1 Car Garage', features: '', shape: 'Rectangular', frontFacing: 'South', lotContext: 'Suburban standard lot',
  openConcept: 'Open Concept (Combined)', masterLocation: 'Level 2 (Upper)', kitchenPlacement: 'Rear of House',
  laundryLocation: 'Level 1 (near garage/mud)', materials: 'Craftsman (Wood & Stone)', ceilingHeight: 'Standard (9 ft)',
  indoorOutdoor: 'Moderate (some connection)', naturalLight: 'Balanced windows', accessibilityNeeds: 'None',
  budgetTier: 'Mid ($200-300/sqft)', foundationType: 'Slab-on-grade', hvacSystem: 'Forced air (gas)',
  outdoorLiving: 'None', outdoorArea: '0', lotWidth: '', lotDepth: '', bedroomConfigs: null, finishOverrides: {}, freeformWishes: '',
};
const options = {
  shape: ['Rectangular (Wide)', 'Rectangular (Deep)', 'Square', 'Rectangular'],
  frontFacing: ['North', 'South', 'East', 'West'],
  lotContext: ['Suburban standard lot', 'Suburban corner lot', 'Urban tight lot', 'Rural acreage', 'View focused site', 'Waterfront lot'],
  openConcept: ['Open Concept (Combined)', 'Traditional (Separate Rooms)'],
  kitchenPlacement: ['Rear of House', 'Front of House'],
  laundryLocation: ['Level 1 (near garage/mud)', 'Level 2 (near bedrooms)', 'No preference'],
  ceilingHeight: ['Standard (9 ft)', 'Tall (10 ft)', 'Cathedral / Vaulted'],
  materials: ['Craftsman (Wood & Stone)', 'Modern Farmhouse (Board & Batten)', 'Traditional Colonial (Brick)', 'Contemporary Modern (Concrete)', 'Mediterranean (Stucco & Tile)'],
  indoorOutdoor: ['Minimal (enclosed feel)', 'Moderate (some connection)', 'Maximum (open to outdoors)'],
  naturalLight: ['Balanced windows', 'Maximum glazing', 'Privacy first (fewer windows)'],
  accessibilityNeeds: ['None', 'Wheelchair accessible', 'Wide doorways', 'Single-level preferred'],
  budgetTier: ['Entry ($120-180/sqft)', 'Mid ($200-300/sqft)', 'Luxury ($350+/sqft)'],
  foundationType: ['Slab-on-grade', 'Crawl space', 'Full basement'],
  hvacSystem: ['Forced air (gas)', 'Heat pump', 'Mini-split'],
  outdoorLiving: ['None', 'Covered porch', 'Open deck', 'Screened porch', 'Patio'],
  garage: ['No Garage', '1 Car Garage', '2 Car Garage'],
  stories: ['1 Story', '2 Stories'],
  bedrooms: [1, 2, 3, 4, 5].map(n => `${n} Bed`),
  bathrooms: [1, 2, 3, 4, 5].map(n => `${n} Bath`),
  masterLocation: ['Level 1 (Main)', 'Level 2 (Upper)'],
};
const featureNames = ['Study', 'Home Theater', 'Gym', 'Gaming Room', 'Library', 'Wine Cellar', 'Music Room', 'Guest Suite', 'Playroom'];

function makeCases() {
  const cases = [];
  const add = (suite, id, survey) => cases.push({ suite, id, survey: { ...base, ...survey } });
  add('priority-regression', 'two-story-square-2400-3bed-3bath', { shape: 'Square' });
  add('priority-regression', 'two-story-main-primary-3bath', { masterLocation: 'Level 1 (Main)' });
  // Exhaust the user-visible structural grid. A one-story home has a main-floor
  // primary; two-story homes exercise both primary-floor selections.
  for (const stories of ['1 Story', '2 Stories']) for (const bedrooms of [1, 2, 3, 4, 5])
    for (const bathrooms of [1, 2, 3, 4, 5]) for (const area of [600, 800, 1000, 1200, 1500, 1800, 2400, 3200, 5000, 10000])
      for (const garage of options.garage) for (const masterLocation of (stories === '1 Story' ? ['Level 1 (Main)'] : ['Level 1 (Main)', 'Level 2 (Upper)'])) {
        const n = cases.length + 1;
        add('structural', `struct-${String(n).padStart(4, '0')}`, { stories, bedrooms: `${bedrooms} Bed`, bathrooms: `${bathrooms} Bath`,
          totalArea: String(area), garage, masterLocation, privateBaths: String(Math.min(bedrooms, bathrooms > 1 ? 1 : 0)) });
      }
  // Single-field checks measure whether each choice reaches generated geometry
  // or another explicit plan representation, against the default brief.
  for (const [field, values] of Object.entries(options)) for (const value of values) {
    const survey = { [field]: value };
    if (field === 'outdoorLiving') survey.outdoorArea = value === 'None' ? '0' : '160';
    add('single-control', `${field}-${slug(value)}`, survey);
  }
  // Greedy covering array: every pair of categorical values across distinct
  // controls appears together at least once; all choices are sourced above.
  const axes = Object.entries(options).filter(([field]) => !['garage', 'stories', 'bedrooms', 'bathrooms', 'masterLocation'].includes(field));
  let uncovered = new Set();
  const pairKey = (i, a, j, b) => `${i}:${a}|${j}:${b}`;
  for (let i = 0; i < axes.length; i++) for (let j = i + 1; j < axes.length; j++)
    for (let a = 0; a < axes[i][1].length; a++) for (let b = 0; b < axes[j][1].length; b++) uncovered.add(pairKey(i, a, j, b));
  let pairIndex = 0;
  while (uncovered.size) {
    const first = [...uncovered][0], [a0, b0] = first.split('|');
    const [i, a] = a0.split(':').map(Number), [j, b] = b0.split(':').map(Number);
    const selected = new Map([[i, a], [j, b]]);
    for (let k = 0; k < axes.length; k++) if (!selected.has(k)) {
      let best = 0, scoreBest = -1;
      for (let v = 0; v < axes[k][1].length; v++) {
        let score = 0;
        for (const [other, ov] of selected) {
          const key = other < k ? pairKey(other, ov, k, v) : pairKey(k, v, other, ov);
          if (uncovered.has(key)) score++;
        }
        if (score > scoreBest) { best = v; scoreBest = score; }
      }
      selected.set(k, best);
    }
    const survey = { ...base };
    axes.forEach(([field, values], k) => { survey[field] = values[selected.get(k)]; });
    survey.outdoorArea = survey.outdoorLiving === 'None' ? '0' : '160';
    for (let x = 0; x < axes.length; x++) for (let y = x + 1; y < axes.length; y++)
      uncovered.delete(pairKey(x, selected.get(x), y, selected.get(y)));
    add('pairwise', `pairwise-${String(++pairIndex).padStart(3, '0')}`, survey);
  }
  // Every feature room presence mask is tested (512 combinations). Repeated
  // quantities are tested independently at representative low/high boundaries.
  for (let mask = 0; mask < (1 << featureNames.length); mask++) {
    const selected = featureNames.filter((_, i) => mask & (1 << i));
    add('feature-mask', `feature-mask-${String(mask).padStart(3, '0')}`, { totalArea: '5000',
      features: selected.map(name => `1 ${name}`).join(', ') || 'None' });
  }
  for (const name of featureNames) for (const count of [1, 2, 4, 32])
    add('feature-count', `feature-${slug(name)}-${count}`, { totalArea: count === 32 ? '10000' : '5000', features: `${count} ${name}` });
  // Exhaust every bedroom configuration pattern (ensuite x closet, per bedroom)
  // by bedroom count. Other survey fields are held at a generous representative.
  for (let nBeds = 1; nBeds <= 5; nBeds++) for (let mask = 0; mask < (1 << (2 * nBeds)); mask++) {
    const bedroomConfigs = Array.from({ length: nBeds }, (_, i) => ({
      privateBath: mask & (1 << (2 * i)) ? 'Yes' : 'No', closet: mask & (1 << (2 * i + 1)) ? 'Walk-in' : 'Standard',
    }));
    const nEnsuite = bedroomConfigs.filter(c => c.privateBath === 'Yes').length;
    const survey = { ...base, totalArea: '5000', bedrooms: `${nBeds} Bed`, bathrooms: `${Math.min(5, Math.max(2, nEnsuite + 1))} Bath`, bedroomConfigs, privateBaths: String(nEnsuite) };
    add('bedroom-config', `bedroom-config-${nBeds}-${String(mask).padStart(3, '0')}`, survey);
  }
  // HTML number inputs: boundary and typical sizes. Arbitrary values are not
  // exhaustible, so cover allowed limits and representative thresholds.
  for (const area of [600, 601, 999, 1000, 1499, 1500, 1800, 2400, 3200, 5000, 9999, 10000])
    add('numeric-boundary', `area-${area}`, { totalArea: String(area) });
  for (const area of [600, 800, 1000, 1200, 1500, 1800, 2400, 3200, 5000, 10000])
    add('single-control', `area-${area}`, { totalArea: String(area) });
  for (const dims of [['20','20'], ['30','40'], ['40','80'], ['60','100'], ['120','200'], ['500','500']])
    add('numeric-boundary', `lot-${dims[0]}x${dims[1]}`, { lotWidth: dims[0], lotDepth: dims[1] });
  for (const outdoorArea of [0, 1, 80, 160, 320, 800]) for (const outdoorLiving of (outdoorArea === 0 ? ['None'] : ['Open Deck']))
    add('numeric-boundary', `outdoor-${outdoorLiving}-${outdoorArea}`, { outdoorLiving, outdoorArea: String(outdoorArea) });
  // Cross-control regressions for the expanded main-floor suite family.
  // Append to preserve all existing structural case IDs.
  for (const area of [2400, 3200, 3600, 4000, 5000])
    for (const shape of ['Rectangular', 'Rectangular (Wide)', 'Rectangular (Deep)'])
      for (const laundryLocation of options.laundryLocation)
        add('main-primary-expansion', `main-primary-${area}-${slug(shape)}-${slug(laundryLocation)}`,
          { totalArea: String(area), shape, laundryLocation, masterLocation: 'Level 1 (Main)' });
  for (const frontFacing of options.frontFacing)
    for (const openConcept of options.openConcept)
      add('front-kitchen-variety', `front-kitchen-${slug(frontFacing)}-${slug(openConcept)}`,
        { frontFacing, openConcept, kitchenPlacement: 'Front of House' });
  for (const [bedrooms, bathrooms] of [[2,3], [3,2], [3,3]]) {
    for (const area of [1200,1500,2400,5000]) for (const openConcept of options.openConcept)
      add('public-spine-cross-controls', `spine-${bedrooms}b-${bathrooms}ba-${area}-${slug(openConcept)}`,
        { stories:'1 Story', bedrooms:`${bedrooms} Bed`, bathrooms:`${bathrooms} Bath`, totalArea:String(area),
          garage:'No Garage', masterLocation:'Level 1 (Main)', openConcept });
    for (const frontFacing of options.frontFacing)
      add('public-spine-cross-controls', `spine-${bedrooms}b-${bathrooms}ba-facing-${slug(frontFacing)}`,
        { stories:'1 Story', bedrooms:`${bedrooms} Bed`, bathrooms:`${bathrooms} Bath`, totalArea:'1200',
          garage:'No Garage', masterLocation:'Level 1 (Main)', frontFacing });
  }
  // The Studio always sends per-bedroom settings: an en-suite and a walk-in
  // closet for the primary, reach-in closets for the others, and the rest of
  // the bathrooms shared (see frontend src/lib/bedroomConfigurations.js). The
  // structural grid above sends none, so it asks for no closets. This suite
  // sends the real payload for the homes people ask for: bathrooms within
  // [max(1, bedrooms - 2), bedrooms + 1] and at least a plausible area.
  const minArea = (b, ba, st) => 350 + 220 * b + 60 * ba + (st === 2 ? 150 : 0);
  for (const st of [1, 2]) for (let b = 1; b <= 5; b++) for (let ba = 1; ba <= 5; ba++)
    for (const area of [600, 800, 1000, 1200, 1500, 1800, 2400, 3200, 5000, 10000])
      for (const garage of options.garage) for (const m of (st === 1 ? [1] : [1, 2])) {
        if (ba > b + 1 || ba < Math.max(1, b - 2) || area < minArea(b, ba, st) || (area > 5000 && b < 4)) continue;
        const attached = ba > 1 ? 1 : 0;
        add('studio-realistic', `studio-${st}s-${b}b-${ba}ba-${area}-${slug(garage)}-m${m}`, {
          stories: st === 1 ? '1 Story' : '2 Stories', bedrooms: `${b} Bed`, bathrooms: `${ba} Bath`, totalArea: String(area), garage,
          masterLocation: m === 1 ? 'Level 1 (Main)' : 'Level 2 (Upper)', privateBaths: String(attached),
          bedroomConfigs: Array.from({ length: b }, (_, i) => ({ privateBath: i < attached ? 'Yes' : 'No', closet: i === 0 ? 'Walk-in' : 'Standard' })),
        });
      }
  return cases;
}
function slug(v) { return String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function invoke(handler, survey) { return new Promise((resolve, reject) => {
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(body) { resolve({ status: this.statusCode, body }); return this; } };
  Promise.resolve(handler({ method: 'POST', body: { surveyData: survey }, headers: {} }, res)).catch(reject);
}); }
function geometry(plan) {
  if (!plan) return '';
  const levels = (plan.levels || []).map(l => ({ level: l.level, width: l.width, height: l.height,
    rooms: (l.rooms || []).map(r => ({ id: r.id, programId: r.programId, type: r.type, x: r.x, y: r.y, w: r.w, h: r.h,
      parts: (r.parts || []).map(({x,y,w,h}) => ({x,y,w,h})) })).sort((a,b) => String(a.id).localeCompare(String(b.id))),
    doors: (l.doors || []).map(({a,b,x,y,dir,width,openThreshold,slidingDoor}) => ({a,b,x,y,dir,width,openThreshold,slidingDoor})),
    windows: (l.windows || []).map(({roomId,x,y,dir,width}) => ({roomId,x,y,dir,width})) }));
  return crypto.createHash('sha256').update(JSON.stringify(levels)).digest('hex').slice(0, 16);
}
function csvCell(value) { const s = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value); return `"${s.replace(/"/g, '""')}"`; }
function failureCategory(error) {
  const value = String(error || '').toLowerCase();
  if (value.includes('stair') && (value.includes('fit') || value.includes('align'))) return 'stairs';
  if (value.includes('closet')) return 'closet';
  if (value.includes('bedroom fit') || value.includes('bed fit')) return 'bedroom furniture fit';
  if (value.includes('area delta') || value.includes('finished floor area')) return 'area target';
  if (value.includes('bath fit') || value.includes('bathroom')) return 'bathroom fit';
  if (value.includes('dining') || value.includes('kitchen') || value.includes('furnishing')) return 'furniture fit';
  if (value.includes('hallway')) return 'circulation';
  if (value.includes('connect') || value.includes('arrival')) return 'connectivity';
  return 'other';
}
const columns = ['suite','case_id','requested_selections','preflight_supported','preflight_messages','http_status','result_code','generation_outcome','option_count','valid_option_count','distinct_geometry_count','architectural_diversity','primary_geometry_hash','geometry_hashes','changed_vs_default_geometry','honored_fields','not_honored_fields','validation_errors','failure_reasons','generation_diagnostics','elapsed_ms'];
async function main() {
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  console.warn = () => {};
  const out = path.resolve(process.argv[2] || '../tmp/universal-coverage/full-studio-sweep'); fs.mkdirSync(out, { recursive: true });
  let cases = makeCases();
  const requestedSuites = process.argv.find(a => a.startsWith('--suite='))?.slice(8)?.split(',');
  const requestedIds = process.argv.find(a => a.startsWith('--case='))?.slice(7)?.split(',');
  if (requestedSuites?.length) cases = cases.filter(c => requestedSuites.includes(c.suite));
  if (requestedIds?.length) cases = cases.filter(c => requestedIds.includes(c.id));
  // --shard=i/n runs every n-th case (merge the shard directories with
  // merge-coverage.cjs). Generation has no time budgets, so shards running
  // side by side give the same rows as one sequential run.
  const shard = process.argv.find(a => a.startsWith('--shard='))?.slice(8)?.split('/').map(Number);
  if (shard) cases = cases.filter((_, i) => i % shard[1] === shard[0]);
  const jsonl = path.join(out, 'results.jsonl'), csv = path.join(out, 'results.csv');
  // --resume keeps the rows already written (a run interrupted part-way) and
  // runs only the cases that are missing.
  const resume = process.argv.includes('--resume') && fs.existsSync(jsonl);
  const kept = resume ? fs.readFileSync(jsonl, 'utf8').split(/\r?\n/).filter(line => {
    try { JSON.parse(line); return true; } catch { return false; } // drops a half-written last line
  }) : [];
  if (resume) fs.writeFileSync(jsonl, kept.map(line => `${line}\n`).join(''));
  const finished = new Set(kept.map(line => { const r = JSON.parse(line); return `${r.suite}\u0000${r.case_id}`; }));
  if (!resume) { fs.writeFileSync(jsonl, ''); fs.writeFileSync(csv, `${columns.join(',')}\n`); }
  const baselineResult = await invoke(planHandler, base);
  const baselinePlan = baselineResult.body?.planSpec;
  const baselineHash = geometry(baselinePlan);
  let done = 0;
  for (const fixture of cases) {
    if (finished.has(`${fixture.suite}\u0000${fixture.id}`)) { done++; continue; }
    const started = Date.now(); let row;
    try {
      const pre = (await invoke(preflightHandler, fixture.survey)).body;
      // Diagnose behavior even when preflight says unsupported. This detects
      // late errors and silent legacy fallback, which the Studio must prevent.
      const generated = await invoke(planHandler, fixture.survey), body = generated.body || {};
      const plans = body.success && body.planSpec ? [body.planSpec, ...(body.alternatives || []).map(o => o.planSpec)] : [];
      const errors = plans.flatMap((plan, i) => validateEditedPlan(plan, fixture.survey).map(error => `option ${i + 1}: ${error}`));
      const hashes = [...new Set(plans.map(geometry))];
      const architecturalDiversity = plans.length ? validateVariationDiversityV2(plans) : null;
      const fulfillment = plans.map(p => buildSurveyFulfillment(p, fixture.survey));
      const items = fulfillment.flatMap(f => f.items);
      const honored = [...new Set(items.filter(i => ['satisfied','preference_scored'].includes(i.status)).map(i => i.field))];
      const notHonored = [...new Set([
        ...items.filter(i => !['satisfied','preference_scored'].includes(i.status)).map(i => `${i.field}:${i.status}`),
        ...(!plans.length ? (pre.blockers || []).map(b => `${b.field}:blocked_preflight`) : []),
      ])];
      const messages = [...(pre.blockers || []), ...(pre.featureBlockers || [])].map(b => `${b.field}: ${b.message}`);
      const outcome = plans.length ? errors.length ? 'generated_invalid' : 'generated_valid' : pre.supported === false ? 'blocked_preflight' : 'generation_failed_after_supported_preflight';
      const diagnostics = plans.length ? null : body.diagnostics || null;
      const generationFailureReasons = [
        ...(body.diagnostics?.blockers || []).map(b => `${b.field || b.code || 'generation'}: ${b.message || b.reason || ''}`),
        ...(body.diagnostics?.rejectedCandidates || []).flatMap(candidate => candidate.errors || candidate.hardErrors || candidate.architecturalErrors || []),
        ...(body.message ? [body.message] : []),
      ];
      const primaryGeometryHash = hashes[0] || '';
      row = { suite: fixture.suite, case_id: fixture.id, requested_selections: fixture.survey, preflight_supported: pre.supported,
        preflight_messages: messages, http_status: generated.status, result_code: body.code || null, generation_outcome: outcome,
        option_count: plans.length, valid_option_count: plans.length - new Set(errors.map(e => e.split(':')[0])).size,
        distinct_geometry_count: hashes.length, primary_geometry_hash: primaryGeometryHash, geometry_hashes: hashes,
        architectural_diversity: architecturalDiversity,
        changed_vs_default_geometry: Boolean(primaryGeometryHash && primaryGeometryHash !== baselineHash),
        honored_fields: honored, not_honored_fields: notHonored, validation_errors: errors,
        failure_reasons: [...messages, ...generationFailureReasons, ...errors], generation_diagnostics: diagnostics,
        elapsed_ms: Date.now() - started };
    } catch (error) {
      row = { suite: fixture.suite, case_id: fixture.id, requested_selections: fixture.survey,
        generation_outcome: 'runner_error', option_count: 0, valid_option_count: 0, distinct_geometry_count: 0,
        primary_geometry_hash: '', geometry_hashes: [], changed_vs_default_geometry: false, honored_fields: [], not_honored_fields: [],
        validation_errors: [error.stack || error.message], failure_reasons: [error.message], generation_diagnostics: null, elapsed_ms: Date.now() - started };
    }
    fs.appendFileSync(jsonl, JSON.stringify(row) + '\n');
    fs.appendFileSync(csv, columns.map(col => csvCell(row[col])).join(',') + '\n');
    done++;
    if (done % 25 === 0 || done === cases.length) console.log(`${done}/${cases.length} ${fixture.id}: ${row.generation_outcome}, ${row.option_count} plans, ${row.elapsed_ms} ms`);
  }
  writeSummary(out, cases.length, baselineHash);
}
function writeSummary(out, expectedCases, baselineHash) {
  const jsonl = path.join(out, 'results.jsonl'), csv = path.join(out, 'results.csv');
  const rows = fs.readFileSync(jsonl, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const summary = { date: new Date().toISOString(), domain: 'Studio discrete choices exhaustively within declared finite sets; numeric/free-text values sampled at boundaries; full Cartesian product is not attempted.',
    expectedCases, completedCases: rows.length,
    outcomes: Object.fromEntries([...new Set(rows.map(r => r.generation_outcome))].map(k => [k, rows.filter(r => r.generation_outcome === k).length])),
    generatedValid: rows.filter(r => r.generation_outcome === 'generated_valid').length,
    atLeastThreeArchitecturallyDiverse: rows.filter(r => r.generation_outcome === 'generated_valid' && r.option_count >= 3 && r.architectural_diversity?.valid).length,
    generatedInvalid: rows.filter(r => r.generation_outcome === 'generated_invalid').length,
    blockedPreflight: rows.filter(r => r.generation_outcome === 'blocked_preflight').length,
    supportedButFailed: rows.filter(r => r.generation_outcome === 'generation_failed_after_supported_preflight').length,
    sameGeometryAsDefault: rows.filter(r => r.option_count && !r.changed_vs_default_geometry).length,
    successfulWithFewerThanThreeDistinctGeometries: rows.filter(r => r.generation_outcome === 'generated_valid' && (r.option_count < 3 || r.distinct_geometry_count < 3)).length,
    fewerThanThreeDistinctOptions: rows.filter(r => r.option_count < 3 || r.distinct_geometry_count < 3).length,
    mostFrequentPreflightBlockers: Object.entries(rows.flatMap(r => r.preflight_messages || []).reduce((counts, item) => {
      const field = item.split(':', 1)[0]; counts[field] = (counts[field] || 0) + 1; return counts;
    }, {})).sort((a,b) => b[1] - a[1]),
    generationFailureCasesByCategory: Object.entries(rows.filter(r => r.generation_outcome === 'generation_failed_after_supported_preflight').reduce((counts, r) => {
      const diagnostics = r.generation_diagnostics || {};
      const categories = new Set((diagnostics.rejectedCandidates || []).flatMap(c => c.errors || []).map(failureCategory));
      for (const category of categories) counts[category] = (counts[category] || 0) + 1;
      return counts;
    }, {})).sort((a,b) => b[1] - a[1]),
    suiteResults: Object.fromEntries([...new Set(rows.map(r => r.suite))].map(suite => {
      const selected = rows.filter(r => r.suite === suite);
      return [suite, { attempted: selected.length, generatedValid: selected.filter(r => r.generation_outcome === 'generated_valid').length,
        blockedPreflight: selected.filter(r => r.generation_outcome === 'blocked_preflight').length,
        supportedButFailed: selected.filter(r => r.generation_outcome === 'generation_failed_after_supported_preflight').length,
        atLeastThreeDistinct: selected.filter(r => r.generation_outcome === 'generated_valid' && r.option_count >= 3 && r.distinct_geometry_count >= 3).length }];
    })),
    failuresByCode: Object.fromEntries([...new Set(rows.map(r => r.result_code).filter(Boolean))].map(k => [k, rows.filter(r => r.result_code === k).length])),
    outputCsv: csv, outputJsonl: jsonl, baselineGeometryHash: baselineHash };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  require('./coverage-report.cjs').writeReport(out);
  console.log(JSON.stringify(summary, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { makeCases, geometry, base, writeSummary, columns };
