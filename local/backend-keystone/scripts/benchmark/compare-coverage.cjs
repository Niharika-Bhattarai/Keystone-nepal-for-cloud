'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = directory => fs.readFileSync(path.join(directory, 'results.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const key = row => `${row.suite}:${row.case_id}`;
const valid = row => row?.generation_outcome === 'generated_valid';
const target = row => valid(row) && row.option_count >= 3 && row.architectural_diversity?.valid === true;
function compare(beforeDirectory, afterDirectory) {
  const before = read(beforeDirectory), after = read(afterDirectory);
  const previous = new Map(before.map(row => [key(row), row]));
  const current = new Map(after.map(row => [key(row), row]));
  const ids = predicate => after.filter(predicate).map(key);
  return {
    beforeCases: before.length, afterCases: after.length,
    missingBaselineCases: before.filter(row => !current.has(key(row))).map(key),
    generationRegressions: ids(row => valid(previous.get(key(row))) && !valid(row)),
    diversityRegressions: ids(row => target(previous.get(key(row))) && !target(row)),
    recoveredDiversity: ids(row => valid(previous.get(key(row))) && !target(previous.get(key(row))) && target(row)),
    newlyGenerated: ids(row => previous.has(key(row)) && !valid(previous.get(key(row))) && valid(row)),
    lateFailures: ids(row => row.generation_outcome === 'generation_failed_after_supported_preflight'),
    invalidReturnedPlans: ids(row => row.generation_outcome === 'generated_invalid'),
    belowTarget: ids(row => valid(row) && !target(row)),
  };
}
if (require.main === module) {
  const result = compare(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
  const output = JSON.stringify(result, null, 2) + '\n';
  if (process.argv[4]) fs.writeFileSync(path.resolve(process.argv[4]), output);
  console.log(output);
}
module.exports = { compare };
