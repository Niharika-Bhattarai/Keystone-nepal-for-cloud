const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
// The existing live site's Google Cloud project. A preview build never uses it.
const LIVE_PROJECT = 'gen-lang-client-0717800720';

export function localApiTarget(value = 'http://127.0.0.1:8198') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Keystone AI conversion API must be an explicit loopback HTTP origin. Remote preview is not configured.');
  }
  return url.origin;
}

export function assertLocalConversion(env = process.env) {
  if (env.VERCEL || env.K_SERVICE || env.KEYSTONE_RUNTIME !== 'local') {
    throw new Error('Set KEYSTONE_RUNTIME=local for the isolated conversion. Remote deployment is not enabled.');
  }
  if (Object.entries(env).some(([key, value]) => key.startsWith('VITE_FIREBASE_') && value)) {
    throw new Error('Use local test authentication; Firebase preview configuration has not been isolated yet.');
  }
  return localApiTarget(env.KEYSTONE_API_ORIGIN);
}

// C4e preview build: served by the preview API service from the same origin (no
// API target, no proxy), signed in with the preview Firebase project only.
export function assertPreviewConversion(env = process.env) {
  if (env.KEYSTONE_RUNTIME !== 'preview') throw new Error('A preview build needs KEYSTONE_RUNTIME=preview.');
  if (env.VERCEL) throw new Error('The preview is served by the preview API service, not Vercel.');
  if (env.VITE_DEV_AUTH) throw new Error('Remove VITE_DEV_AUTH: a preview build signs in with Firebase only.');
  if (env.KEYSTONE_API_ORIGIN) throw new Error('Remove KEYSTONE_API_ORIGIN: the preview API is the same origin.');
  const need = (key) => { if (!env[key]) throw new Error(`A preview build needs ${key}.`); return env[key]; };
  const project = need('KEYSTONE_PREVIEW_PROJECT');
  if (project === LIVE_PROJECT) throw new Error('A preview build must not use the live site\'s project.');
  if (need('VITE_FIREBASE_PROJECT_ID') !== project) throw new Error('VITE_FIREBASE_PROJECT_ID must equal KEYSTONE_PREVIEW_PROJECT.');
  const domain = need('VITE_FIREBASE_AUTH_DOMAIN');
  if (domain !== `${project}.firebaseapp.com` && domain !== `${project}.web.app`) {
    throw new Error('VITE_FIREBASE_AUTH_DOMAIN must be the preview project\'s Firebase domain.');
  }
  need('VITE_FIREBASE_API_KEY'); need('VITE_FIREBASE_APP_ID');
  return { mode: 'preview', api: null, project };
}

export function assertConversion(env = process.env) {
  if (env.KEYSTONE_RUNTIME === 'preview') throw new Error('Nepal workspace is local-only. Deployment is disabled.');
  if (env.KEYSTONE_RUNTIME === 'preview') return assertPreviewConversion(env);
  return { mode: 'local', api: assertLocalConversion(env) };
}
