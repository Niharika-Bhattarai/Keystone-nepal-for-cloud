'use strict';

const { analyzeStairGraph } = require('../graph/stairGraphRules');

function validateStairEndpointPrivacy(level, brief = null) {
  const analysis = analyzeStairGraph(level, brief);
  const errors = [];

  for (const failure of analysis.topologyFailures || []) {
    if (/entry sequence or common core/i.test(failure)) {
      errors.push(`Stair privacy invalid: level ${level?.level} stairs are disconnected from the entry sequence`);
    } else if (/private rooms/i.test(failure)) {
      errors.push(`Stair privacy invalid: level ${level?.level} stairs open directly into private rooms`);
    }
  }

  return errors;
}

module.exports = {
  validateStairEndpointPrivacy,
};
