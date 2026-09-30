'use strict';
const fs = require('node:fs');
const path = require('node:path');
const handler = require('../../api/plan');
const { base } = require('./generation-coverage');
const { validateEditedPlan } = require('../../lib/validateEditedPlan');

const cases = [
  ['default', {}],
  ['front-kitchen', { kitchenPlacement:'Front of House' }],
  ['closed-rooms', { openConcept:'Traditional (Separate Rooms)' }],
  ['large-outdoor-doors', { indoorOutdoor:'Maximum (open to outdoors)' }],
  ['wide-doors', { accessibilityNeeds:'Wide doorways' }],
  ['maximum-glazing-west', { naturalLight:'Maximum glazing', indoorOutdoor:'Maximum (open to outdoors)', accessibilityNeeds:'Wide doorways', frontFacing:'West' }],
  ['privacy', { naturalLight:'Privacy first (fewer windows)' }],
  ['tall-ceilings', { ceilingHeight:'Tall (10 ft)' }],
  ['front-north', { frontFacing:'North' }],
  ['front-east', { frontFacing:'East' }],
  ['laundry-upstairs', { laundryLocation:'Level 2 (near bedrooms)' }],
  ['primary-downstairs', { masterLocation:'Level 1 (Main)' }],
  ['one-storey-two-bed', { stories:'1 Story', bedrooms:'2 Bed', totalArea:'1800', garage:'None' }],
  ['one-storey-three-bed', { stories:'1 Story', totalArea:'1800', garage:'None' }],
  ['one-storey-garage', { stories:'1 Story', bedrooms:'2 Bed', totalArea:'1800' }],
  ['one-storey-four-bed', { stories:'1 Story', bedrooms:'4 Bed', garage:'None' }],
  ['one-storey-five-bed', { stories:'1 Story', bedrooms:'5 Bed', totalArea:'3200', garage:'None' }],
  ['two-storey-five-bed', { bedrooms:'5 Bed', totalArea:'3200' }],
  ['study', { features:'1 Study' }],
  ['study-and-gym', { totalArea:'3200', features:'1 Study, 1 Gym' }],
  ['study-and-library', { totalArea:'3200', features:'1 Study, 1 Library' }],
  ['l-shape', { totalArea:'3200', shape:'L-Shaped' }],
  ['t-shape', { totalArea:'3200', shape:'T-Shaped' }],
  ['square', { shape:'Square' }],
  ['deck', { outdoorLiving:'Open Deck', outdoorArea:'160' }],
  ['small-lot', { lotWidth:'20', lotDepth:'20' }],
  ['finish-overrides', { finishOverrides:{ exteriorSiding:'Brick', roofMaterial:'Clay tile' } }],
];

const invoke = surveyData => new Promise((resolve,reject) => {
  const response = { statusCode:200, setHeader(){}, status(code){this.statusCode=code;return this;},
    json(body){resolve({status:this.statusCode,body});return this;} };
  Promise.resolve(handler({method:'POST',body:{surveyData},headers:{}},response)).catch(reject);
});

async function main() {
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  const out = path.resolve(process.argv[2] || '../tmp/survey-delivery-audit');
  fs.mkdirSync(out,{recursive:true});
  const results=[];
  for(const [id,patch] of cases){
    const survey={...base,...patch};
    const {status,body}=await invoke(survey);
    const options=body.success ? [{planSpec:body.planSpec,svg:body.svg},...(body.alternatives||[])] : [];
    const errors=options.flatMap((option,i)=>validateEditedPlan(option.planSpec,survey).map(error=>({option:i,error})));
    const row={id,survey,status,options:options.length,diversityValid:body.diversityMetrics?.valid ?? null,
      failedDiversityPairs:body.diversityMetrics?.failedPairs || [],errors,
      blockers:body.diagnostics?.blockers || [], failureExamples:body.diagnostics?.rejectedCandidates?.slice(0,2)};
    results.push(row);
    if(options.length){
      fs.writeFileSync(path.join(out,`${id}.svg`),body.svg);
      fs.writeFileSync(path.join(out,`${id}-front.svg`),body.elevations.frontSvg);
      fs.writeFileSync(path.join(out,`${id}.json`),JSON.stringify({survey,planSpec:body.planSpec,alternatives:options.slice(1).map(o=>o.planSpec)}));
    }
    console.log(`${id}: ${status}, ${options.length} options, diversity=${row.diversityValid}, errors=${errors.length}`);
  }
  const report={date:new Date().toISOString(),total:results.length,generated:results.filter(r=>r.options).length,
    threeDistinct:results.filter(r=>r.options>=3&&r.diversityValid).length,results};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>Survey delivery audit</title><style>body{font:16px system-ui;background:#f7f4ef;color:#252724;margin:32px}section{margin-bottom:48px}img{width:100%;background:white}aside{display:grid;grid-template-columns:2fr 1fr;gap:16px}p{max-width:80ch}</style></head><body><h1>Survey delivery audit</h1><p>${report.generated}/${report.total} briefs generated; ${report.threeDistinct} returned at least three options passing the diversity check.</p>${results.map(r=>`<section><h2>${r.id}</h2><p>Status ${r.status}; options ${r.options}; diversity ${r.diversityValid}; validation errors ${r.errors.length}.</p>${r.options?`<aside><img src="${r.id}.svg" alt="${r.id} plan"><img src="${r.id}-front.svg" alt="${r.id} front elevation"></aside>`:`<p>${r.blockers.map(b=>b.message).join(' ')}</p>`}</section>`).join('')}</body></html>`;
  fs.writeFileSync(path.join(out,'index.html'),html);
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={cases,invoke};
