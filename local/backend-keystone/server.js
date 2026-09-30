'use strict';
require('../tools/backend-boundary.cjs');
const { configureKeystoneRuntime } = require('./lib/keystoneRuntime');
const runtime = configureKeystoneRuntime();
const { createApp } = require('./app');

// Optional local photoreal renders (KEYSTONE_HQ=local): owned jobs in the memory
// store, bakes in this process, private files under runtime.photoreal.dir,
// short signed links with a per-process secret. No cloud service is used.
function localRender() {
  if (!runtime.photoreal) return null;
  const crypto = require('node:crypto');
  const { getStore } = require('./lib/accounts/store');
  const { RenderJobs } = require('./lib/accounts/renderJobs');
  const { LocalArtifacts } = require('./lib/model3d/hq/ownedArtifacts');
  const { bakeOwned } = require('./lib/model3d/hq/ownedBake');
  const { renderUrls } = require('./lib/model3d/hq/renderUrls');
  const { RenderDispatcher, maintain, localLauncher, renderLoop } = require('./lib/model3d/hq/dispatcher');
  const store = getStore(), jobs = new RenderJobs(store), artifacts = new LocalArtifacts(runtime.photoreal.dir);
  const log = (line) => console.log(line);
  let loop = null;
  const launcher = localLauncher({ jobs, artifacts, bake: (args) => bakeOwned(args), onSettled: () => loop?.kick(), log });
  const dispatcher = new RenderDispatcher({ jobs, launch: launcher.launch, active: launcher.active, maxConcurrent: 1, perOwner: 1, log });
  loop = renderLoop({ dispatcher, intervalMs: 15_000, log,
    maintenance: () => maintain({ jobs, store, artifacts, log }) }); // identity removal: the lifecycle default
  return { mode: 'local', jobs, artifacts, urls: renderUrls({ secret: crypto.randomBytes(32) }), dispatcher: loop,
    forceOptions: runtime.photoreal.quality ? { quality: runtime.photoreal.quality } : null };
}

// Preview (C4e): Firestore, Firebase sign-in, the private render bucket and the
// Cloud Run render job of the one preview project; see lib/previewRender.js.
if (runtime.mode === 'preview') {
  const { previewRender } = require('./lib/previewRender');
  createApp({ render: previewRender(runtime), runtimeMode: 'preview' }).listen(runtime.port, runtime.host, () => {
    console.log(`Keystone AI preview listening on ${runtime.host}:${runtime.port} (project ${runtime.project}, render loop ${runtime.renderLoop ? 'on' : 'off'})`);
  });
} else {
  createApp({ render: localRender() }).listen(runtime.port, runtime.host, () => {
    console.log(`Keystone AI conversion listening on http://${runtime.host}:${runtime.port} (local, in-memory accounts${runtime.photoreal ? ', local photoreal renders' : ''})`);
  });
}
