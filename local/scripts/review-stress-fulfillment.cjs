'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {stressCases}=require('../backend/scripts/benchmark/universal-coverage');
const {createRunContext,assertExpectedBuild}=require('../backend/scripts/benchmark/coverage-run-context');

// Inspect misleading current-validator witnesses without changing historical
// numerators. This is evidence capture, not a complete survey fulfillment gate.
async function main() {
  const origin=process.argv[2]||'http://127.0.0.1:8107';
  if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw new Error('Use a local server');
  const cases=stressCases().filter(c=>['basement-wheelchair-two-storey','vault-upper-stair'].includes(c.id));
  const context=createRunContext(cases,'stress-fulfillment-review');
  const build=await(await fetch(`${origin}/health`)).json();assertExpectedBuild(build);
  const results=[];
  for(const c of cases) {
    const response=await fetch(`${origin}/api/plan`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({surveyData:c.survey})});
    const body=await response.json();
    const plans=body.planSpec?[body.planSpec,...(body.alternatives||[]).map(a=>a.planSpec)]:[];
    fs.writeFileSync(path.join(context.metadata.outputDirectory,`${c.id}.json`),JSON.stringify({survey:c.survey,plans},null,2));
    results.push({id:c.id,status:response.status,options:plans.map(plan=>({
      levels:plan.levels.map(l=>({level:l.level,roomTypes:l.rooms.map(r=>r.type),verticalProfile:l.verticalProfile})),
      belowGradeLevelCount:plan.levels.filter(l=>l.level<1).length,
      ceilingHeightType:plan.verticalModel?.ceilingHeightType,
      topLevelModelKeys:Object.keys(plan).sort(),
      review:c.id==='basement-wheelchair-two-storey'
        ?'Check for an actual basement and a verified accessible route between levels. Nominal wide doors are insufficient evidence.'
        :'Check for sloped ceiling surfaces and a headroom sweep. A taller constant ceiling is insufficient evidence of the requested vault.',
    }))});
  }
  context.finish({complete:true,scope:'Manual survey-evidence inspection; current validator success is not full survey fulfillment.',build,results});
  console.log(context.metadata.outputDirectory);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
