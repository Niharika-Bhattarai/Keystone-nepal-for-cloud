'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const NEPAL_ROOT=path.resolve(__dirname,'../../../../..');
const KNOWLEDGE=path.join(NEPAL_ROOT,'knowledge');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function buildCatalog() {
  const manifest=JSON.parse(fs.readFileSync(path.join(KNOWLEDGE,'manifest.json')));
  const sourceById=new Map(manifest.map(source=>[source.id,source]));
  const data=JSON.parse(fs.readFileSync(path.join(KNOWLEDGE,'rules.json')));
  for (const rule of data.rules) for (const citation of rule.sources) {
    const source=sourceById.get(citation.source_id);
    if (!source || source.sha256!==citation.sha256)
      throw new Error(`Rule ${rule.id}: citation hash differs from knowledge manifest`);
  }
  for (const source of manifest) {
    const original=path.join(NEPAL_ROOT,source.original);
    if (!fs.existsSync(original) || sha(fs.readFileSync(original))!==source.sha256)
      throw new Error(`Original source drift: ${source.id}`);
  }
  const result={schemaVersion:1,builtAt:'2026-09-30',knowledgeRulesSha256:sha(fs.readFileSync(path.join(KNOWLEDGE,'rules.json'))),
    knowledgeManifestSha256:sha(fs.readFileSync(path.join(KNOWLEDGE,'manifest.json'))),
    sources:manifest.map(({id,sha256,status})=>({id,sha256,status})),
    rules:data.rules.filter(rule=>rule.id!=='G02'),
    exclusions:[{ruleId:'G02',reason:'Draft commentary documents exclusion only; no executable threshold is imported from it.'}]};
  const dest=path.join(__dirname,'catalog.json');
  fs.writeFileSync(dest,JSON.stringify(result,null,2)+'\n');
  return result;
}
if (require.main===module) console.log(`Compiled ${buildCatalog().rules.length} source-pinned rules`);
module.exports={buildCatalog};
