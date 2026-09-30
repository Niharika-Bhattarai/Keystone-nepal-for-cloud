'use strict';
const fs=require('node:fs');const path=require('node:path');
const {normalizeBrief}=require('../backend-keystone/lib/nepal/normalizeBrief');
const {buildReviewCase}=require('../backend-keystone/lib/nepal/reviewSheet');
const {runSpatialStudy,renderSpatialStudy}=require('../backend-keystone/lib/nepal/spatialStudy');
async function main(){
  const out=path.resolve(__dirname,'../runtime/nepal-polygon-study');fs.mkdirSync(out,{recursive:true});
  const candidates=[];
  for(const fixture of ['rectangle-2_5','rental-3_5']){
    const raw=structuredClone(require(`../backend-keystone/test/fixtures/nepal/${fixture}.json`));
    for(const level of raw.buildingProgram.levels)level.specialRooms=level.specialRooms.filter(x=>x!=='puja');
    raw.buildingProgram.levels.at(-1).specialRooms.push('puja');
    const review=buildReviewCase(fixture,normalizeBrief(raw).brief);
    candidates.push(...review.result.candidates.slice(0,2).map(c=>({...c,id:`${fixture}/${c.id}`})));
  }
  const large=structuredClone(require('../backend-keystone/test/fixtures/nepal/rectangle-2_5.json'));
  large.site.rectangle.width.value=16;large.site.rectangle.depth.value=16;
  large.site.sideLengths.forEach(s=>s.value=16);large.site.declaredArea={value:256,unit:'sq_m'};
  for(const l of large.buildingProgram.levels)l.specialRooms=l.specialRooms.filter(s=>s!=='puja');
  large.buildingProgram.levels.at(-1).specialRooms.push('puja');
  const {searchConcepts}=require('../backend-keystone/lib/nepal/candidateSearch');
  const expanded=searchConcepts(normalizeBrief(large).brief,{provisionalSetbacksMm:[1500,1500,1500,1500],
    workingCoverageLimit:.7,maxCandidates:1}).candidates[0];
  if(expanded)candidates.push({...expanded,id:`16m-enlarged-study/${expanded.id}`});
  const result={studies:[]};
  for(const candidate of candidates){
    result.studies.push(...(await runSpatialStudy([candidate])).studies);
    console.log('Reviewed',candidate.id);
  }
  fs.writeFileSync(path.join(out,'inputs.json'),JSON.stringify({candidates},null,2));
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));
  fs.writeFileSync(path.join(out,'index.html'),renderSpatialStudy(result));
  const rows=result.studies.map(s=>[s.candidateId,s.balconyCount,s.courtStatus,s.voidUse||'none',s.irregularRoomCount,
    s.projectedCoveredAreaSqM,s.projectedCoverageRatio,s.levels.reduce((n,l)=>n+l.issues.length,0)]);
  fs.writeFileSync(path.join(out,'results.csv'),['candidate,projecting_balconies,court_status,void_use,irregular_rooms,projected_coverage_m2,projected_coverage_ratio,functional_fit_findings',
    ...rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(','))].join('\n')+'\n');
  // This optional input is deliberately titled analytical; it proves polygon
  // operations, not production success on a furnished/engineered house.
  const analytical=path.join(out,'analytical-fixture.json');
  if(fs.existsSync(analytical)){
    const demo=await runSpatialStudy([JSON.parse(fs.readFileSync(analytical,'utf8'))]);
    fs.writeFileSync(path.join(out,'analytical.html'),renderSpatialStudy(demo));
    fs.writeFileSync(path.join(out,'analytical-results.json'),JSON.stringify(demo,null,2));
  }
  console.log(rows);console.log(out);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
