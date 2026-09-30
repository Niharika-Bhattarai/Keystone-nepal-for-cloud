'use strict';
// Injectable orchestration for the durable job service. Deliberately not wired
// to the legacy Cloud Run worker or HTTP route until private storage is ready.
const { manifest, LEASE_MS } = require('../../accounts/renderJobs');
async function runOwnedRender({ jobs, uid, id, bake, artifacts, heartbeatMs = LEASE_MS / 3 }) {
  const claim = await jobs.claim(uid, id);
  if (!claim?.token) return claim;
  const abort = new AbortController();
  let lost = null, progress = 0, accepting = true, until = claim.until, heartbeat = Promise.resolve();
  const pulse = () => {
    // Only a lost lease, deletion, or a lease that lapsed stops the bake; a transient
    // storage error is retried by the next pulse while the lease is still valid.
    heartbeat = heartbeat.then(async () => { until = await jobs.heartbeat(uid, id, claim.token, progress); }).catch(e => {
      if (['JOB_LEASE_LOST', 'ACCOUNT_DELETING'].includes(e.code) || jobs.clock() >= until) { lost = e; abort.abort(); }
    });
  };
  const timer = setInterval(pulse, heartbeatMs);
  const stop = async () => { clearInterval(timer); await heartbeat; };
  // Output is refused once the lease is lost or its last renewal has lapsed.
  const writer = artifacts.writer?.(claim.artifactId, { signal: abort.signal, closed: () => Boolean(lost) || (until != null && jobs.clock() >= until) });
  try {
    const input = await jobs.input(uid, id, claim.token);
    const output = await bake({ input, artifactId: claim.artifactId, writer, signal: abort.signal,
      progress: value => { if (accepting && Number.isFinite(value) && value >= 0 && value < 1) progress = Math.max(progress, value); } });
    accepting = false; // a late progress callback cannot move a settled job
    if (lost) throw lost;
    // Validate names before passing anything to the private artifact adapter.
    const names = output?.files;
    manifest(names?.map(name => ({ name, size: 1, sha256: '0'.repeat(64), contentType: name === 'house.glb' ? 'model/gltf-binary' : 'image/jpeg' })), input.options);
    const checked = [];
    // Descriptors come from the stored bytes; the lease stays renewed while they are read.
    for (const name of names) checked.push({ ...(await artifacts.inspect(claim.artifactId, name)), name });
    await stop();
    if (lost) throw lost;
    return await jobs.complete(uid, id, claim.token, checked, output.viewer ?? null);
  } catch (error) {
    // A stale worker can neither publish nor settle the replacement attempt.
    if (['JOB_LEASE_LOST', 'ACCOUNT_DELETING'].includes(error.code)) return { state: 'abandoned' };
    try { return await jobs.fail(uid, id, claim.token); }
    catch (settlementError) {
      if (['JOB_LEASE_LOST', 'ACCOUNT_DELETING'].includes(settlementError.code)) return { state: 'abandoned' };
      throw settlementError; // Leave the durable reservation for recovery.
    }
  } finally { accepting = false; await stop(); }
}
// A scheduler may die at any point: due jobs are durable and claim() is the
// authority. Multiple sweeps can discover the same work without double charging.
async function recoverDue({ jobs, run, limit = 20 }) {
  const results = [];
  for (const job of await jobs.due(limit)) {
    try { results.push({ id: job.id, result: await run(job) }); }
    catch (e) { results.push({ id: job.id, code: e.code || 'RETRY_REQUIRED' }); }
  }
  return results;
}
module.exports = { runOwnedRender, recoverDue };
