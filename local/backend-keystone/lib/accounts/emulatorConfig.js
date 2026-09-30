'use strict';
// Test-only adapter factory. Never selects a project or endpoint by default.
function emulatorConfig(env = process.env) {
  if (env.KEYSTONE_EMULATOR_TEST !== '1' || env.K_SERVICE || env.NODE_ENV === 'production') throw new Error('Explicit local emulator test mode is required.');
  if (!/^demo-keystone-[a-z0-9-]+$/.test(env.GCLOUD_PROJECT || '')) throw new Error('Use a demo-keystone-* project without live resources.');
  if (!/^127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(env.FIRESTORE_EMULATOR_HOST || '') || Number(env.FIRESTORE_EMULATOR_HOST.split(':')[1]) > 65535) throw new Error('Firestore emulator must use a loopback host and valid port.');
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_PROJECT_ID', 'GCS_BUCKET_NAME', 'STRIPE_SECRET_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY']) if (env[key]) throw new Error(`Remove ${key} from the emulator process.`);
  return { projectId: env.GCLOUD_PROJECT, host: env.FIRESTORE_EMULATOR_HOST, ssl: false };
}
module.exports = { emulatorConfig };
