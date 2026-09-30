'use strict';
process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
const fs = require('node:fs');
const path = require('node:path');
const { makeCases } = require('./studio-full-coverage.cjs');
const { invoke } = require('./survey-delivery-audit');

async function main() {
  const fixture = makeCases().find(c => c.id === process.argv[2]);
  if (!fixture) throw new Error('Provide a coverage case ID');
  const out = path.resolve(process.argv[3]);
  const { body } = await invoke(fixture.survey);
  if (!body.success) throw new Error(JSON.stringify(body.diagnostics));
  fs.mkdirSync(out, { recursive: true });
  const options = [{ svg: body.svg, planSpec: body.planSpec }, ...(body.alternatives || [])];
  options.forEach((option, i) => fs.writeFileSync(path.join(out, `option-${i + 1}.svg`), option.svg));
  fs.writeFileSync(path.join(out, 'plans.json'), JSON.stringify({ survey: fixture.survey, plans: options.map(o => o.planSpec) }, null, 2));
  fs.writeFileSync(path.join(out, 'plans.html'), '<!doctype html><meta charset="utf-8"><title>Coverage plan review</title><style>body{font:16px system-ui;background:#eee}section{margin:24px}img{width:100%;background:white}</style>' +
    options.map((_, i) => `<section><h2>Option ${i + 1}</h2><img src="option-${i + 1}.svg"></section>`).join(''));
  console.log(`Saved ${options.length} options to ${out}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
