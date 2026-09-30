'use strict';
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
function localEnv(parent = process.env) {
  // Allowlist prevents inherited production credentials, proxies and NODE_OPTIONS.
  const env = {};
  for (const [key,value] of Object.entries(parent)) {
    if (/^(path|systemroot|windir|comspec|pathext|temp|tmp|home|userprofile|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|pythonutf8|lang)$/i.test(key)) env[key] = value;
  }
  return Object.assign(env, {
    KEYSTONE_RUNTIME:'local', KEYSTONE_API_ORIGIN:'http://127.0.0.1:8299', PORT:'8299',
    NEPAL_LOCAL_STUDIO:'1',
    VITE_LOCAL_STUDIO:'1', VITE_DEV_AUTH:'1', VITE_SITE_ORIGIN:'http://127.0.0.1:5299',
    ACCOUNTS_STORE:'memory', ACCOUNTS_AUTH:'insecure-dev', HQ_STORE:'local',
    HQ_LOCAL_DIR:path.join(ROOT,'runtime','hq'), KEYSTONE_HQ_DIR:path.join(ROOT,'runtime','renders'),
  });
}
module.exports={localEnv,ROOT};
