'use strict';

const path = require('path');

const pkg = require(path.join(__dirname, '..', 'package.json'));

// Bump this when planner behavior changes materially so live responses can
// prove which engine family is serving requests.
const PLAN_ENGINE_VERSION = 'fitted-stairs-v2-2026-09-24';

function getBuildInfo() {
  return {
    appVersion: String(pkg.version || '0.0.0'),
    planEngineVersion: PLAN_ENGINE_VERSION,
    runtimeRevision: String(process.env.K_REVISION || process.env.GA_REVISION || 'local-dev'),
    serviceName: String(process.env.K_SERVICE || 'keystone-api'),
    buildStamp: String(process.env.BUILD_STAMP || process.env.K_REVISION || 'local-dev'),
  };
}

module.exports = {
  PLAN_ENGINE_VERSION,
  getBuildInfo,
};
