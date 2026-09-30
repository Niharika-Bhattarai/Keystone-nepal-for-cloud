'use strict';
const Ajv=require('ajv');
const schema=require('./stairAssemblySchema.json');
const {getStairCodeProfile}=require('./codeProfiles');
const ajv=new Ajv({allErrors:true,strict:true,strictNumbers:true,coerceTypes:false});
const validate=ajv.compile(schema);
function validateStairAssembly(assembly,{profile}={}) {
  const errors=[];
  if(!validate(assembly)) errors.push(...validate.errors.map(e=>`${e.instancePath||'/'} ${e.message}`));
  if(errors.length) return {valid:false,errors};
  try {
    const resolved=getStairCodeProfile(profile??assembly.codeProfileId);
    if(resolved.id!==assembly.codeProfileId) errors.push('Assembly code profile does not match the supplied profile.');
  } catch(error) {errors.push(error.message);}
  if(assembly.fromLevelId===assembly.toLevelId) errors.push('A stair must connect two different levels.');
  const ids=[...assembly.flights,...assembly.landings].map(v=>v.id);
  if(new Set(ids).size!==ids.length) errors.push('Stair primitive IDs must be unique.');
  return {valid:errors.length===0,errors};
}
module.exports={validateStairAssembly};
