'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const catalog=require('./catalog.json');
const kmc=require('./profiles/kmc.json');
const nepalRoot=path.resolve(__dirname,'../../../../..');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const cached=new Map();
function unchanged(file,expected) {
  const stat=fs.statSync(file),signature=`${stat.size}:${stat.mtimeMs}`;
  const prior=cached.get(file);
  if(prior?.signature===signature)return prior.valid;
  const valid=sha(file)===expected;cached.set(file,{signature,valid});return valid;
}
function verifyCatalog() {
  try {
    if(!unchanged(path.join(nepalRoot,'knowledge','rules.json'),catalog.knowledgeRulesSha256))return false;
    if(!unchanged(path.join(nepalRoot,'knowledge','manifest.json'),catalog.knowledgeManifestSha256))return false;
    const manifest=JSON.parse(fs.readFileSync(path.join(nepalRoot,'knowledge','manifest.json')));
    const byId=new Map(manifest.map(item=>[item.id,item]));
    return catalog.sources.every(ref=>{
      const item=byId.get(ref.id);
      return item?.sha256===ref.sha256&&unchanged(path.join(nepalRoot,item.original),ref.sha256);
    });
  } catch {return false;}
}
function resolveRulePack(brief) {
  const municipality=String(brief?.jurisdiction?.municipality||'').trim().toLowerCase();
  const isKmc=['kathmandu','kathmandu metropolitan city','kathmandu mahanagarpalika'].includes(municipality);
  const blockers=[];
  if(!verifyCatalog())blockers.push({code:'RULE_SOURCE_DRIFT',message:'Rule source files changed or are missing; rebuild and re-review the compiled catalog.'});
  if (!isKmc) blockers.push({code:'MUNICIPAL_OVERLAY_PENDING',message:'This municipality needs its own reviewed bylaw overlay.'});
  else if (kmc.status!=='adopted_and_reviewed') blockers.push({code:'KMC_RULE_REVIEW_REQUIRED',
    message:'The current Kathmandu bylaw and amendments must be reviewed for this parcel before permit claims.'});
  const profile=isKmc?kmc:null;
  const version=crypto.createHash('sha256').update(JSON.stringify({catalogHash:catalog.knowledgeRulesSha256,profile})).digest('hex');
  return {version,profile,catalogVersion:catalog.knowledgeRulesSha256,blockers,
    permitRulesReady:blockers.length===0 && Object.values(profile.parameters).every(v=>v!==null)};
}
module.exports={resolveRulePack,verifyCatalog};
