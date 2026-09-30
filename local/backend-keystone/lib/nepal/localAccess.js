'use strict';
// Local copy only. The entrypoint strips inherited environment and refuses
// cloud startup; this extra guard prevents accidental account bypass elsewhere.
function localStudio() {
  return process.env.NEPAL_LOCAL_STUDIO === '1' && process.env.KEYSTONE_RUNTIME === 'local' &&
    process.env.ACCOUNTS_STORE === 'memory' &&
    process.env.ACCOUNTS_AUTH === 'insecure-dev' &&
    process.env.NODE_ENV !== 'production' && !process.env.K_SERVICE;
}
module.exports = { localStudio };
