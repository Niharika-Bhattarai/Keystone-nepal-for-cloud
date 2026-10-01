'use strict';
// Writes the A3 review drawing set (HTML, and PDF when a Chromium is available)
// for the top-ranked hypothesis of a fixture: node tools/nepal-drawing-set.cjs [fixture] [rank]
const fs=require('node:fs');
const path=require('node:path');
const backend=path.join(__dirname,'..','backend-keystone');
const {normalizeBrief}=require(path.join(backend,'lib/nepal/normalizeBrief'));
const {deriveConceptAssumptions}=require(path.join(backend,'lib/nepal/workingAssumptions'));
const {searchConcepts}=require(path.join(backend,'lib/nepal/candidateSearch'));
const {renderDrawingSet}=require(path.join(backend,'lib/nepal/drawingSet'));
const fixture=process.argv[2]||'rental-3_5',rank=Number(process.argv[3]||0);
const brief=normalizeBrief(require(path.join(backend,'test/fixtures/nepal',`${fixture}.json`))).brief;
const a=deriveConceptAssumptions(brief);
const result=searchConcepts(brief,{provisionalSetbacksMm:a.setbacksMm,workingCoverageLimit:a.coverageLimit,maxCandidates:6});
const variant=process.argv.includes('--parking-variant')?result.parkingProgramVariant:null;
const candidate=(variant?variant.candidates:result.candidates)[rank];
if(!candidate)throw new Error('No candidate at that rank');
const set=renderDrawingSet(candidate,variant?variant.brief:brief,{option:`Option ${rank+1}${variant?' (parking variant)':''}`});
const out=path.join(__dirname,'..','runtime','nepal-drawing-set');fs.mkdirSync(out,{recursive:true});
const base=path.join(out,`${fixture}-${rank+1}${variant?'-parking':''}`);
fs.writeFileSync(`${base}.html`,set.html);
console.log(`${base}.html`,set.sheets.map(s=>s.no).join(' '));
if(process.argv.includes('--pdf')){
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  (async()=>{const b=await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{});
    const p=await b.newPage();await p.goto('file://'+base+'.html');
    await p.pdf({path:`${base}.pdf`,width:'420mm',height:'297mm',printBackground:true});
    await b.close();console.log(`${base}.pdf`);})();
}
