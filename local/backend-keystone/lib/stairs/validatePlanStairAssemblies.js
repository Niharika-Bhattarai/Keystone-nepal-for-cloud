'use strict';
const {validateStairAssembly}=require('./validateStairAssembly');
const {isDeepStrictEqual}=require('node:util');

// Optional until physical migration is enabled. If present, the new model must
// survive validation rather than being silently stripped or left stale after
// an edit. Incomplete construction inputs do not invalidate a concept plan.
function validatePlanStairAssemblies(plan,{profile}={}) {
  const levels=Array.isArray(plan?.levels)?plan.levels:[];
  if(!Object.hasOwn(plan||{},'stairAssemblies')) {
    return levels.some(l=>l.stairAssemblyIds?.length)?['Stair assembly references have no assembly model.']:[];
  }
  if(!Array.isArray(plan.stairAssemblies)) return ['Stair assemblies must be an array.'];
  const errors=[];
  const ids=new Set();
  const byLevel=new Map(levels.map(l=>[`level:${l.level}`,l]));
  for(const assembly of plan.stairAssemblies) {
    const contract=validateStairAssembly(assembly,{profile});
    if(!contract.valid) {errors.push(...contract.errors.map(e=>`Stair assembly: ${e}`));continue;}
    if(ids.has(assembly.id)) errors.push(`Duplicate stair assembly ID: ${assembly.id}`);
    ids.add(assembly.id);
    if(assembly.validation.status==='invalid') errors.push(`Stair assembly ${assembly.id} has invalid geometry.`);
    for(const levelId of [assembly.fromLevelId,assembly.toLevelId]) {
      const level=byLevel.get(levelId);
      if(!level) errors.push(`Stair assembly ${assembly.id} refers to missing ${levelId}.`);
      else if(!Array.isArray(level.stairAssemblyIds)||!level.stairAssemblyIds.includes(assembly.id)) errors.push(`${levelId} is missing its stair connection ${assembly.id}.`);
    }
  }
  for(const level of levels) {
    if(level.stairAssemblyIds!==undefined&&!Array.isArray(level.stairAssemblyIds)) {errors.push('Stair assembly references must be arrays.');continue;}
    if(new Set(level.stairAssemblyIds||[]).size!==(level.stairAssemblyIds||[]).length) errors.push(`Duplicate stair references on level ${level.level}.`);
    for(const id of level.stairAssemblyIds||[]) {
      const assembly=plan.stairAssemblies.find(a=>a?.id===id);
      if(!assembly||![assembly.fromLevelId,assembly.toLevelId].includes(`level:${level.level}`)) errors.push(`Level ${level.level} refers to an unrelated/missing stair assembly ${id}.`);
    }
  }
  if(errors.length) return [...new Set(errors)];
  try {
    const expected=require('./stairModelMigration').migratePlanStairs(plan,{profile}).stairAssemblies;
    if(expected.length!==plan.stairAssemblies.length) errors.push('Stair assembly connections are incomplete; regenerate the stair model.');
    for(const assembly of plan.stairAssemblies) {
      const current=expected.find(a=>a.id===assembly.id);
      // Compare the whole deterministic projection, including rational step
      // data. A caller cannot preserve a valid hash while tampering with steps.
      if(!current||!isDeepStrictEqual(assembly,current)) errors.push(`Stair assembly ${assembly.id} is stale or modified; regenerate after the edit.`);
    }
  } catch(error) {errors.push(`Stair assembly cannot be revalidated: ${error.message}`);}
  return [...new Set(errors)];
}
module.exports={validatePlanStairAssemblies};
