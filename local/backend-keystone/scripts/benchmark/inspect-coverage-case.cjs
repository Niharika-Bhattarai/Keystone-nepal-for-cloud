'use strict';
// Reproduce one matrix case and expose the closest rejected geometry.
const fs = require('node:fs');
const { makeCases } = require('./studio-full-coverage.cjs');
const { normalizeBrief } = require('../../lib/tile/normalizeBrief');
const { resolveArchitectV2Support } = require('../../lib/residential/v2/supportMatrix');
const { interpretBriefV2 } = require('../../lib/residential/v2/interpretBriefV2');
const { buildCandidateFootprintsV2 } = require('../../lib/residential/v2/candidateFootprintsV2');
const { tryGenerateArchitectV2Candidate } = require('../../lib/residential/v2/candidateGeneration');
const fixture = makeCases().find(c => c.id === process.argv[2]);
if (!fixture) throw new Error('Pass a coverage case ID');
const survey = fixture.survey, brief = normalizeBrief(survey);
const support = resolveArchitectV2Support(brief), interpretation = interpretBriefV2(brief, support);
if (!support.supported) throw new Error(support.reasons.join(', '));
const rows = buildCandidateFootprintsV2(brief, interpretation).map(footprint => ({ footprint,
  result: tryGenerateArchitectV2Candidate(brief, interpretation, footprint, survey, { skipElevation: true, captureRejectedPlan: true }) }));
rows.sort((a, b) => (a.result.ok ? -1 : a.result.diagnostics?.[0]?.errors?.length ?? 999) -
  (b.result.ok ? -1 : b.result.diagnostics?.[0]?.errors?.length ?? 999));
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ survey, candidates: rows }, null, 2));
console.log(JSON.stringify(rows.slice(0, 3).map(({ footprint: f, result: r }) => ({
  footprint: [f.widthFt, f.heightFt, f.variationId], ok: r.ok, errors: r.diagnostics?.flatMap(d => d.errors),
  closets: r.rejectedPlan?.closetPlacementDiagnostics,
  rooms: r.rejectedPlan?.levels.map(l => ({ level: l.level, rooms: l.rooms.map(({ programId, type, x, y, w, h }) => ({ programId, type, x, y, w, h })) })),
})), null, 2));
