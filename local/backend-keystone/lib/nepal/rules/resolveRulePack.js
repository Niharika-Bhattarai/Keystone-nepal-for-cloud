'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const catalog=require('./catalog.json');
const {normalizedTextSha256}=require('./buildCatalog');
const kmc=require('./profiles/kmc.json');
const nepalRoot=path.resolve(__dirname,'../../../../..');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const textSha=file=>normalizedTextSha256(fs.readFileSync(file));
const cached=new Map();
function unchanged(file,expected,hash=sha) {
  const stat=fs.statSync(file),signature=`${stat.size}:${stat.mtimeMs}`;
  const prior=cached.get(file);
  if(prior?.signature===signature)return prior.valid;
  const valid=hash(file)===expected;cached.set(file,{signature,valid});return valid;
}
// Lists why the compiled catalog cannot be trusted; empty means verified.
// kind: knowledge_pin (rules/manifest text changed), original_missing, original_hash.
function catalogDrift() {
  const drift=[];
  try {
    for(const [file,expected] of [['rules.json',catalog.knowledgeRulesSha256],['manifest.json',catalog.knowledgeManifestSha256]])
      if(!unchanged(path.join(nepalRoot,'knowledge',file),expected,textSha))drift.push({kind:'knowledge_pin',file:`knowledge/${file}`});
    if(drift.length)return drift;
    const manifest=JSON.parse(fs.readFileSync(path.join(nepalRoot,'knowledge','manifest.json')));
    const byId=new Map(manifest.map(item=>[item.id,item]));
    for(const ref of catalog.sources) {
      const item=byId.get(ref.id);
      if(item?.sha256!==ref.sha256){drift.push({kind:'knowledge_pin',id:ref.id});continue;}
      const original=path.join(nepalRoot,item.original);
      if(!fs.existsSync(original))drift.push({kind:'original_missing',id:ref.id});
      else if(!unchanged(original,ref.sha256))drift.push({kind:'original_hash',id:ref.id});
    }
  } catch(error) {drift.push({kind:'unreadable',message:error.message});}
  return drift;
}
const verifyCatalog=()=>catalogDrift().length===0;
function resolveRulePack(brief) {
  const municipality=String(brief?.jurisdiction?.municipality||'').trim().toLowerCase();
  const isKmc=['kathmandu','kathmandu metropolitan city','kathmandu mahanagarpalika'].includes(municipality);
  const blockers=[];
  const drift=catalogDrift();
  if(drift.length)blockers.push({code:'RULE_SOURCE_DRIFT',message:'Rule source files changed or are missing; rebuild and re-review the compiled catalog.',
    causes:[...new Set(drift.map(item=>item.kind))],drift});
  if (!isKmc) blockers.push({code:'MUNICIPAL_OVERLAY_PENDING',message:'This municipality needs its own reviewed bylaw overlay.'});
  else if (kmc.status!=='adopted_and_reviewed') blockers.push({code:'KMC_RULE_REVIEW_REQUIRED',
    message:'The current Kathmandu bylaw and amendments must be reviewed for this parcel before permit claims.'});
  const profile=isKmc?kmc:null;
  const version=crypto.createHash('sha256').update(JSON.stringify({catalogHash:catalog.knowledgeRulesSha256,profile})).digest('hex');
  return {version,profile,catalogVersion:catalog.knowledgeRulesSha256,blockers,
    permitRulesReady:blockers.length===0 && Object.values(profile.parameters).every(v=>v!==null)};
}
module.exports={resolveRulePack,verifyCatalog,catalogDrift};
