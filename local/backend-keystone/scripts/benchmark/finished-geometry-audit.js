'use strict';
const { base } = require('./generation-coverage');
const { invoke } = require('./survey-delivery-audit');
const { createRunContext } = require('./coverage-run-context');
const { buildWallModel } = require('../../lib/geometry/wallModel');
const { deriveLevelClearances, deriveStairClearance, findNarrowStairs } = require('../../lib/geometry/clearanceGeometry');
const { validateFurnitureGeometry, CHECKED_ROOM_TYPES } = require('../../lib/furnitureGeometry');
const { compareMetrics } = require('../../lib/residential/v2/diversityMetricV2');
const { validateEditedPlan } = require('../../lib/validateEditedPlan');
const { migratePlanStairs } = require('../../lib/stairs/stairModelMigration');
const { validateStairAssembly } = require('../../lib/stairs/validateStairAssembly');

async function main() {
  process.env.V2_DISABLE_LEGACY_FALLBACK = 'true';
  const cases = [
    ['default', {}], ['wide', {accessibilityNeeds:'Wide doorways'}],
    ['l-shape',{totalArea:'3200',shape:'L-Shaped'}], ['t-shape',{totalArea:'3200',shape:'T-Shaped'}],
    ['study-gym',{totalArea:'3200',features:'1 Study, 1 Gym'}],
    ...['2 Bed','3 Bed'].flatMap(bedrooms=>['South','North','East','West'].map(frontFacing=>[
      `compact-${bedrooms[0]}-${frontFacing}`, {totalArea:'1800',bedrooms,garage:'2 Car Garage',frontFacing},
    ])),
  ];
  const context=createRunContext(cases,'finished-geometry-review');
  const results=[];
  for (const [id,patch] of cases) {
    const survey={...base,...patch};
    const {status,body}=await invoke(survey);
    const plans=body.success?[body.planSpec,...(body.alternatives||[]).map(o=>o.planSpec)]:[];
    const options=plans.map(plan=>{
      const migrated=migratePlanStairs(plan);
      return {
      currentValidationErrors:validateEditedPlan(plan,survey),
      stairMigration:{
        idempotent:JSON.stringify(migratePlanStairs(migrated))===JSON.stringify(migrated),
        assemblies:migrated.stairAssemblies.map(assembly=>({id:assembly.id,status:assembly.validation.status,
          hash:assembly.geometryHash,flightCount:assembly.flights.length,findings:assembly.validation.findings,
          schemaErrors:validateStairAssembly(assembly).errors,unverifiedInputs:assembly.validation.unverifiedInputs})),
      },
      levels:plan.levels.map(level=>{
        const model=buildWallModel(level), openings=deriveLevelClearances(level,model);
        const stair=level.rooms.find(r=>r.id===level.stairCore?.roomId);
        const clearance=stair?deriveStairClearance(stair,model,1,level.stairCore?.layout):null;
        return {level:level.level,wallErrors:model.errors,partition:model.partition,
          unhostedOpenings:openings.unhostedCount,
          roughOpeningFailures:openings.doors.filter(o=>o.roughOpeningFitsHost===false).map(o=>o.opening),
          unresolvedOpeningFrames:[...openings.doors,...openings.windows].filter(o=>o.roughOpeningWidthFt===null).length,
          unresolvedProductOpenings:[...openings.doors,...openings.windows].filter(o=>o.clearWidthFt===null).length,
          stairClearance:clearance,stairFindings:stair?findNarrowStairs(clearance):[],
          finishedFurnitureErrors:validateFurnitureGeometry({...level,finishedFaceGeometryVersion:1},CHECKED_ROOM_TYPES)};
      }),
    };});
    results.push({id,survey,status,options,diversity:compareMetrics(plans)});
    context.finish({complete:false,scope:'Shadow measurement; finished-face enforcement is not enabled on existing generated plans.',results});
    console.log(`${id}: ${status}, ${plans.length} options, corrected diversity ${results.at(-1).diversity.v2ValidPairs}/${results.at(-1).diversity.pairCount}`);
  }
  context.finish({complete:true,scope:'Shadow measurement; no construction approval. Performance affected by concurrent regression testing.',results});
  console.log(context.metadata.outputDirectory);
  if(results.some(r=>r.status!==200 || !r.options.length || r.options.some(o=>o.currentValidationErrors.length
    || !o.stairMigration.idempotent || o.stairMigration.assemblies.some(a=>a.status==='invalid'||a.schemaErrors.length)))) process.exitCode=1;
}
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
