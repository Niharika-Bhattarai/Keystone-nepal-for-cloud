'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../frontend/node_modules/playwright');
const { createRunContext } = require('../backend/scripts/benchmark/coverage-run-context');
const { normalizeBrief } = require('../backend/lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../backend/lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../backend/lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../backend/lib/residential/v2/candidateFootprintsV2');
const { tryGenerateArchitectV2Candidate } = require('../backend/lib/residential/v2/candidateGeneration');
const { renderPlanSvg } = require('../backend/lib/renderPlanSvg');
const { doorClearances } = require('../backend/lib/furnitureGeometry');

async function main() {
  const fixtures = require('../backend/test/fixtures/coverage/known-gaps.json').cases.slice(0, 2);
  const context = createRunContext(fixtures.map(r => r.survey), 'compact-service-review');
  const out = context.metadata.outputDirectory;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
  const results = [];
  try {
    for (const fixture of fixtures) {
      const brief = normalizeBrief(fixture.survey);
      const interpretation = interpretBriefV2(brief, resolveArchitectV2Support(brief));
      const footprint = buildCandidateFootprintsV2(brief, interpretation).find(f => f.widthFt === 44 && f.heightFt === 28);
      const candidate = tryGenerateArchitectV2Candidate(brief, interpretation, footprint, fixture.survey, { captureRejectedPlan: true });
      const plan = candidate.result?.planSpec || candidate.rejectedPlan;
      if (!plan) throw new Error(`No inspectable candidate: ${fixture.id}`);
      const level = plan.levels[0];
      const laundry = level.rooms.find(r => r.type === 'laundry');
      const svg = renderPlanSvg({ ...plan, levels: [level] }, { rendered: false });
      const diagnostics = { id: fixture.id, survey: fixture.survey, footprint, delivered: candidate.ok,
        errors: candidate.diagnostics || [], laundry, appliances: level.furniture.filter(f => f.roomId === laundry.id),
        doorClearances: doorClearances(laundry, level), planSpec: plan };
      fs.writeFileSync(path.join(out, `${fixture.id}.json`), JSON.stringify(diagnostics, null, 2));
      fs.writeFileSync(path.join(out, `${fixture.id}.svg`), svg);
      await page.setContent(`<html><body style="margin:20px;background:white;font:18px sans-serif"><h1>${fixture.id}</h1><p>Diagnostic candidate: ${candidate.ok ? 'accepted by current concept validators' : 'rejected; see JSON diagnostics'}. Appliance placement review only.</p>${svg}</body></html>`);
      await page.screenshot({ path: path.join(out, `${fixture.id}.png`), fullPage: true });
      results.push({ id: fixture.id, delivered: candidate.ok, errors: candidate.diagnostics?.flatMap(d => d.errors) || [] });
    }
  } finally { await browser.close(); }
  context.finish({ complete: true, scope: 'Candidate geometry for appliance/door review; see delivered flag for concept validation, not construction approval', results });
  console.log(out);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
