'use strict';
// Owned photoreal renders for the preview runtime (C4e). The pieces were built and
// tested separately in C4b-C4d; this connects them for one preview project:
//
//   Firestore (accounts, projects, render jobs and the dispatch pool)
//   -> RenderDispatcher, whose launch starts one Cloud Run Job execution per job
//   -> bake/worker.js in that execution claims the job and writes into the private
//      bucket (GcsArtifacts), then completes or fails it in the account transaction
//   -> the API signs short, generation-pinned bucket links for the owner.
//
// Every instance kicks a dispatch when a render is created; the dispatch pool's
// transaction caps concurrency (the GPU quota) however many instances do that.
// Only the instance with KEYSTONE_RENDER_LOOP=1 also runs the periodic pass and the
// maintenance (orphan sweep, pending account deletions).
//
// All cloud clients are injectable so the wiring is tested without the cloud.

const { RenderJobs } = require('./accounts/renderJobs');
const { GcsArtifacts } = require('./model3d/hq/ownedArtifacts');
const { RenderDispatcher, maintain, renderLoop } = require('./model3d/hq/dispatcher');
const { startBakeJob } = require('./model3d/hq/cloudRunJob');

function previewRender(runtime, { store, bucket, runRequest = null, deleteIdentity, log = console.log, intervalMs = 15_000 } = {}) {
  if (runtime?.mode !== 'preview') throw new Error('previewRender needs a preview runtime');
  if (!store) {
    const { getStore } = require('./accounts/store');
    store = getStore();
  }
  if (!bucket) {
    const { Storage } = require('@google-cloud/storage');
    bucket = new Storage({ projectId: runtime.project }).bucket(runtime.bucket);
  }
  if (!deleteIdentity) {
    // Account deletion finishes by removing the Firebase sign-in; one already gone is done.
    deleteIdentity = async (uid) => {
      const { getAuth } = require('firebase-admin/auth');
      const { app } = require('./accounts/firebase');
      try { await getAuth(app()).deleteUser(uid); } catch (e) { if (e?.code !== 'auth/user-not-found') throw e; }
    };
  }
  const jobs = new RenderJobs(store);
  const artifacts = new GcsArtifacts({ bucket });
  const jobEnv = { HQ_PROJECT: runtime.job.project, HQ_REGION: runtime.job.region, HQ_JOB_NAME: runtime.job.name };
  const launch = (job) => startBakeJob({ jobId: job.id, ownerUid: job.ownerUid }, { request: runRequest, env: jobEnv });
  const dispatcher = new RenderDispatcher({ jobs, launch, maxConcurrent: runtime.maxConcurrent, perOwner: 1, log });

  let loop = null;
  if (runtime.renderLoop) {
    loop = renderLoop({ dispatcher, intervalMs, log, maintenance: () => maintain({ jobs, store, artifacts, deleteIdentity, log }) });
  } else {
    // Kick-only: one dispatch pass at a time, no timer and no maintenance.
    let running = null, again = false;
    const kick = () => {
      if (running) { again = true; return running; }
      running = (async () => {
        do { again = false; try { await dispatcher.dispatch(); } catch (e) { log(`[render] dispatch failed: ${e.code || e.message}`); } } while (again);
      })().finally(() => { running = null; });
      return running;
    };
    loop = { kick, stop: async () => { await running; } };
  }
  // Links come from the bucket (artifacts.url), so no local link secret exists here.
  // Paused (no GPU quota yet): the routes refuse new renders (app.js); jobs, links,
  // maintenance and account deletion work as usual.
  return { mode: runtime.photoreal === 'paused' ? 'paused' : 'preview', jobs, artifacts, urls: null, dispatcher: loop, deleteIdentity };
}

module.exports = { previewRender };
