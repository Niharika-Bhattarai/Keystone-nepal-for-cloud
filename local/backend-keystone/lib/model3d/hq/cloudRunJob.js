'use strict';

// Starts one execution of the Cloud Run Job that holds Blender (image built
// from bake/Dockerfile) for one owned render. Only the job ID and owner UID are
// passed; the worker (bake/worker.js) claims the job, so a duplicate or retried
// execution is harmless. Used as the dispatcher's launch() in a cloud runtime.
//
// Env: HQ_JOB_NAME (default "keystone-render"), HQ_PROJECT (or GOOGLE_CLOUD_PROJECT),
// HQ_REGION (default us-central1). The API service account needs
// roles/run.developer (run.jobs.runWithOverrides) on the job. Not deployed.

async function startBakeJob({ jobId, ownerUid }, { request = null, env = process.env } = {}) {
  if (!/^rj_[a-f0-9]{40}$/.test(jobId || '') || !/^[\w-]{1,128}$/.test(ownerUid || '')) throw new Error('A render job ID and owner are required');
  const project = env.HQ_PROJECT || env.GOOGLE_CLOUD_PROJECT;
  const region = env.HQ_REGION || 'us-central1';
  const job = env.HQ_JOB_NAME || 'keystone-render';
  if (!project) throw new Error('HQ_PROJECT is not set');
  if (!request) {
    const { GoogleAuth } = require('google-auth-library');
    const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
    request = (options) => client.request(options);
  }
  const res = await request({
    url: `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`, method: 'POST',
    data: { overrides: { containerOverrides: [{ env: [{ name: 'RENDER_JOB_ID', value: jobId }, { name: 'RENDER_OWNER_UID', value: ownerUid }] }], taskCount: 1 } },
  });
  return res.data && res.data.name;
}

module.exports = { startBakeJob };
