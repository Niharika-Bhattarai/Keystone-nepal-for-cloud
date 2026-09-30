'use strict';
// Conversion runtime boundary. Run before importing any cloud clients.
//
// local:   the isolated conversion on this machine (in-memory accounts, test sign-in,
//          optional local Blender bakes). Unchanged since C4c.
// preview: a private preview in the owner's preview project (C4e). It connects only
//          to the project, bucket and render job it is given, refuses the live site's
//          resources, and refuses keys for features that have not passed their own
//          gates (billing, Gemini, e-mail), so they cannot be half-enabled.

// The existing live site. The preview must never touch it.
const LIVE = Object.freeze({ project: 'gen-lang-client-0717800720', bucket: 'keystone_gallery', service: 'keystone-api' });

function configureKeystoneRuntime(env = process.env, { role = 'server' } = {}) {
  if (env.KEYSTONE_RUNTIME === 'preview') return configurePreview(env, role);
  if (role !== 'server') throw new Error('The render worker runs only in the preview runtime (KEYSTONE_RUNTIME=preview).');
  if (env.KEYSTONE_RUNTIME !== 'local' || env.K_SERVICE || env.NODE_ENV === 'production') {
    throw new Error('Keystone AI conversion requires KEYSTONE_RUNTIME=local outside production, or a complete KEYSTONE_RUNTIME=preview configuration.');
  }
  for (const name of ['GCS_BUCKET_NAME', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_PROJECT_ID',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) {
    if (env[name]) throw new Error(`Remove ${name} from the isolated local process; external services are not enabled.`);
  }
  env.ACCOUNTS_STORE = 'memory';
  env.ACCOUNTS_AUTH = 'insecure-dev';
  // Photoreal renders are off unless explicitly enabled with a local Blender.
  // They then bake in this process into a private local folder; nothing leaves the machine.
  if (env.KEYSTONE_HQ && env.KEYSTONE_HQ !== 'local') throw new Error('KEYSTONE_HQ supports only "local" in the conversion runtime.');
  if (env.KEYSTONE_HQ === 'local' && (!env.BLENDER_BIN || !env.ASSET_DIR)) throw new Error('KEYSTONE_HQ=local needs BLENDER_BIN and ASSET_DIR.');
  if (env.KEYSTONE_HQ_QUALITY && !['preview', 'final'].includes(env.KEYSTONE_HQ_QUALITY)) throw new Error('KEYSTONE_HQ_QUALITY must be preview or final.');
  const photoreal = env.KEYSTONE_HQ === 'local'
    ? { dir: env.KEYSTONE_HQ_DIR || require('node:path').join(__dirname, '..', 'tmp', 'renders'), quality: env.KEYSTONE_HQ_QUALITY || null } : null;
  return { host: '127.0.0.1', port: Number(env.PORT || 8198), ...(photoreal ? { photoreal } : {}) };
}

// Settings that must be absent in the preview: the legacy gallery, features still
// behind their gates, local-only switches, and key files (Cloud Run uses its
// service identity).
const PREVIEW_REFUSED = {
  GCS_BUCKET_NAME: 'the legacy public gallery is not part of the preview',
  STRIPE_SECRET_KEY: 'billing stays off until the C3 billing gates pass',
  STRIPE_WEBHOOK_SECRET: 'billing stays off until the C3 billing gates pass',
  STRIPE_PRICE_PRO: 'billing stays off until the C3 billing gates pass',
  GEMINI_API_KEY: 'the Gemini exterior render and refine stay off in the preview for now',
  GOOGLE_API_KEY: 'the Gemini exterior render and refine stay off in the preview for now',
  GOOGLE_APPLICATION_CREDENTIALS: 'use the Cloud Run service identity, not a key file',
  ACCOUNTS_STORE: 'the preview always uses Firestore',
  ACCOUNTS_AUTH: 'the preview always verifies Firebase sign-in',
  KEYSTONE_HQ: 'preview renders run as the Cloud Run Job, not in-process',
};

// Developer keys (Pro without payment, for the owner's own testing) are allowed in the
// preview only from Secret Manager, and only long random ones: the key is the whole
// defence, and attempts are throttled per account (api/account.js).
const DEV_KEY_MIN = 24;

function configurePreview(env, role) {
  const need = (key, pattern, what) => {
    const value = env[key];
    if (!value) throw new Error(`Preview needs ${key} (${what}).`);
    if (!pattern.test(value)) throw new Error(`${key} is not a valid ${what}.`);
    return value;
  };
  for (const [key, why] of Object.entries(PREVIEW_REFUSED)) if (env[key]) throw new Error(`Remove ${key} from the preview: ${why}.`);
  if (env.DEV_ACCESS_KEYS !== undefined) {
    const keys = String(env.DEV_ACCESS_KEYS).split(',').map((k) => k.trim());
    if (keys.some((k) => k.length < DEV_KEY_MIN || !/^[A-Za-z0-9_-]+$/.test(k))) {
      throw new Error(`DEV_ACCESS_KEYS in the preview must be random keys of at least ${DEV_KEY_MIN} letters, digits, - or _ (from Secret Manager).`);
    }
  }

  const project = need('KEYSTONE_PREVIEW_PROJECT', /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'Google Cloud project ID');
  if (project === LIVE.project) throw new Error('The preview must not use the live site\'s project.');
  if (need('FIREBASE_PROJECT_ID', /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'Firebase project ID') !== project) throw new Error('FIREBASE_PROJECT_ID must equal KEYSTONE_PREVIEW_PROJECT.');
  if (need('HQ_PROJECT', /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'Google Cloud project ID') !== project) throw new Error('HQ_PROJECT must equal KEYSTONE_PREVIEW_PROJECT.');
  for (const key of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']) if (env[key] && env[key] !== project) throw new Error(`${key} must equal KEYSTONE_PREVIEW_PROJECT.`);
  const bucket = need('RENDER_BUCKET', /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'private bucket name');
  if (bucket === LIVE.bucket) throw new Error('The preview must not use the live gallery bucket.');
  const region = need('HQ_REGION', /^(us|europe|asia|australia|northamerica|southamerica|me|africa)-[a-z]+[0-9]$/, 'Cloud Run region');
  const job = need('HQ_JOB_NAME', /^[a-z][a-z0-9-]{0,48}[a-z0-9]$/, 'Cloud Run Job name');

  if (env.K_SERVICE === LIVE.service) throw new Error('The preview must not run as the live service.');
  if (role === 'worker') {
    if (env.K_SERVICE) throw new Error('The render worker runs as a Cloud Run Job, not a service.');
    if (env.CLOUD_RUN_JOB !== job) throw new Error('CLOUD_RUN_JOB must equal HQ_JOB_NAME for the render worker.');
  }

  const max = env.HQ_MAX_CONCURRENT ?? '1';
  if (!/^[1-8]$/.test(max)) throw new Error('HQ_MAX_CONCURRENT must be a whole number from 1 to 8 (the GPU quota).');
  const loop = env.KEYSTONE_RENDER_LOOP ?? '0';
  if (!['0', '1'].includes(loop)) throw new Error('KEYSTONE_RENDER_LOOP must be 0 or 1 (1 on exactly one instance).');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is not a valid port.');
  // KEYSTONE_PHOTOREAL=paused runs the preview before its GPU quota is granted: new
  // photoreal renders are refused and no render job is started.
  const photoreal = env.KEYSTONE_PHOTOREAL ?? 'on';
  if (!['on', 'paused'].includes(photoreal)) throw new Error('KEYSTONE_PHOTOREAL must be on or paused.');

  return { mode: 'preview', host: '0.0.0.0', port, project, bucket, job: { project, region, name: job },
    maxConcurrent: Number(max), renderLoop: loop === '1', photoreal };
}

module.exports = { configureKeystoneRuntime, LIVE };
