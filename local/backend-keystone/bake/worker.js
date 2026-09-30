'use strict';

// Cloud Run Job entry point for one owned photoreal render (image: bake/Dockerfile).
//
// The dispatcher starts one execution with RENDER_JOB_ID and RENDER_OWNER_UID.
// The worker claims that job through the account transaction (the claim, not
// this execution, is the authority), reads its frozen input, bakes, writes only
// into its own private attempt namespace in RENDER_BUCKET, and completes or
// fails the job, settling the reserved credit in the same transaction. A
// duplicate execution finds the job claimed and exits without doing anything.
//
// Nothing here is deployed: it needs a preview project's Firestore, a private
// bucket and a service identity. It replaces the legacy entry, which read a
// mutable models/<BAKE_ID>/input.json and published into a shared namespace.

const { RenderJobs } = require('../lib/accounts/renderJobs');
const { runOwnedRender } = require('../lib/model3d/hq/ownedWorker');
const { bakeOwned } = require('../lib/model3d/hq/ownedBake');

async function main({ env = process.env, store, artifacts, bake = bakeOwned, log = console.log } = {}) {
  const id = env.RENDER_JOB_ID, uid = env.RENDER_OWNER_UID;
  if (!/^rj_[a-f0-9]{40}$/.test(id || '') || !/^[\w-]{1,128}$/.test(uid || '')) throw new Error('RENDER_JOB_ID and RENDER_OWNER_UID are required');
  // Real cloud clients only inside the declared preview (C4e): the preview project's
  // Firestore and render bucket, running as the declared Cloud Run Job. Tests that
  // inject both clients skip this; the deployed job never does.
  let runtime = null;
  if (!store || !artifacts) runtime = require('../lib/keystoneRuntime').configureKeystoneRuntime(env, { role: 'worker' });
  if (!store) {
    const { FirestoreStore } = require('../lib/accounts/store');
    const { getFirestore } = require('firebase-admin/firestore');
    store = new FirestoreStore(getFirestore(require('../lib/accounts/firebase').app()));
  }
  if (!artifacts) {
    const { Storage } = require('@google-cloud/storage');
    const { GcsArtifacts } = require('../lib/model3d/hq/ownedArtifacts');
    artifacts = new GcsArtifacts({ bucket: new Storage({ projectId: runtime.project }).bucket(runtime.bucket) });
  }
  const result = await runOwnedRender({ jobs: new RenderJobs(store), uid, id, artifacts, bake });
  // No job identifiers beyond the one given; no account or plan details in logs.
  log(`[worker] ${id} ${result?.state || 'not claimed'}`);
  return result;
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[worker] failed; the job stays durable for recovery:', e.code || e.message);
    process.exit(1);
  });
}
module.exports = { main };
