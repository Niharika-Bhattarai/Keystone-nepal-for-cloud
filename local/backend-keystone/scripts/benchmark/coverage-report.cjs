'use strict';
// Standalone, offline report. Does not call a server or generate additional plans.
const fs = require('node:fs');
const path = require('node:path');

function writeReport(directory) {
  const rows = fs.readFileSync(path.join(directory, 'results.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  // Escape script delimiters even if freeform survey text contains HTML.
  const data = JSON.stringify(rows).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Studio generation coverage</title><style>
body{font:15px/1.5 system-ui,sans-serif;margin:32px;color:#202725;background:#f6f7f4}h1{margin-bottom:8px}p{max-width:1000px}input,select{font:inherit;padding:9px;border:1px solid #88928e;background:white;margin:4px}table{border-collapse:collapse;width:100%;background:white;font-size:13px}th,td{border:1px solid #d7ddd9;padding:9px;text-align:left;vertical-align:top}th{background:#e8ede9;position:sticky;top:0}td:nth-child(3){min-width:280px}pre{white-space:pre-wrap;word-break:break-word;max-width:600px}.pass{color:#176140}.fail{color:#a22323}summary{cursor:pointer}#count{font-weight:600}a{color:#174e6a}</style>
<h1>Studio generation coverage</h1><p>This is a bounded test matrix, not proof of every possible survey combination. A supported case must generate independently valid geometry; the target is at least three architecturally distinct options. Blocked requests remain coverage gaps. Geometry hashes alone do not prove architectural variety.</p>
<p><a href="results.csv" download>Download all results as CSV</a> · <a href="summary.json">Run summary</a></p>
<label>Search <input id="search" type="search" placeholder="Case, choice, error…"></label>
<label>Outcome <select id="outcome"><option value="">All outcomes</option><option>generated_valid</option><option>blocked_preflight</option><option>generation_failed_after_supported_preflight</option><option>generated_invalid</option><option>runner_error</option><option value="low_variety">Valid, below variety target</option></select></label>
<label>Suite <select id="suite"><option value="">All suites</option></select></label><p id="count" aria-live="polite"></p>
<table><thead><tr><th>Case / suite</th><th>Result</th><th>Survey selections</th><th>Options / variety</th><th>Fulfillment / diagnostics</th></tr></thead><tbody id="rows"></tbody></table>
<script>const data=${data};
const byId=id=>document.getElementById(id), search=byId('search'), outcome=byId('outcome'), suite=byId('suite');
const meets=r=>r.generation_outcome==='generated_valid'&&r.option_count>=3&&r.architectural_diversity?.valid;
for(const name of [...new Set(data.map(r=>r.suite))]){const o=document.createElement('option');o.textContent=name;suite.append(o)}
const indexed=data.map(row=>({row,text:JSON.stringify(row).toLowerCase()}));
function details(parent,label,value){const d=document.createElement('details'),s=document.createElement('summary'),p=document.createElement('pre');s.textContent=label;p.textContent=JSON.stringify(value,null,2);d.append(s,p);parent.append(d)}
function render(){const q=search.value.toLowerCase();const selected=indexed.filter(({row:r,text})=>(!q||text.includes(q))&&(!suite.value||r.suite===suite.value)&&(!outcome.value||(outcome.value==='low_variety'?r.generation_outcome==='generated_valid'&&!meets(r):r.generation_outcome===outcome.value))).map(x=>x.row);
byId('count').textContent=selected.length+' / '+data.length+' cases shown · '+data.filter(meets).length+' meet the three-option target';const fragment=document.createDocumentFragment();
for(const r of selected){const tr=document.createElement('tr'),cells=Array.from({length:5},()=>document.createElement('td'));cells[0].textContent=r.case_id+' / '+r.suite;cells[1].textContent=r.generation_outcome;cells[1].className=r.generation_outcome==='generated_valid'?'pass':'fail';
const survey=r.requested_selections||{};cells[2].textContent=[survey.totalArea+' sq ft',survey.stories,survey.bedrooms,survey.bathrooms,survey.garage,survey.shape,survey.features].filter(Boolean).join(' · ');details(cells[2],'Every submitted choice',survey);
cells[3].textContent=r.valid_option_count+' valid / '+r.option_count+' returned; '+(meets(r)?'target met':'target not met');details(cells[3],'Independent diversity metrics',r.architectural_diversity);
details(cells[4],'Honored / unmet fields',{honored:r.honored_fields,unmet:r.not_honored_fields});details(cells[4],'Errors and preflight messages',r.failure_reasons);details(cells[4],'Candidate diagnostics',r.generation_diagnostics);tr.append(...cells);fragment.append(tr)}byId('rows').replaceChildren(fragment)}
let timer;search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(render,150)});outcome.addEventListener('change',render);suite.addEventListener('change',render);render();</script></html>`;
  fs.writeFileSync(path.join(directory, 'index.html'), html);
  return rows.length;
}
if (require.main === module) console.log(`Report contains ${writeReport(path.resolve(process.argv[2]))} cases`);
module.exports = { writeReport };
