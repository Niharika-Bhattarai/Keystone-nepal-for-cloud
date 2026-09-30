'use strict';
// Starts owned render jobs and keeps their maintenance moving. Everything here
// is discovery and bookkeeping: the job claim remains the single authority to
// run a bake or spend a credit, so a duplicate or dead scheduler is harmless.
const { LEASE_MS } = require('../../accounts/renderJobs');
const { resumeDeletion } = require('../../accounts/lifecycle');
const { deliverOutbox } = require('../../accounts/outbox');
const { runOwnedRender } = require('./ownedWorker');

class RenderDispatcher {
  // launch(job) starts one execution (in-process bake, or a Cloud Run Job run).
  // active() reports executions launched here that may not have claimed yet.
  constructor({ jobs, launch, active = () => 0, maxConcurrent = 1, perOwner = 1, retryMs = 2 * LEASE_MS, pageSize = 100, maxPages = 5, log = () => {} }) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 128 || !Number.isInteger(perOwner) || perOwner < 1 || perOwner > maxConcurrent) throw new Error('Invalid dispatch limits');
    Object.assign(this, { jobs, launch, active, maxConcurrent, perOwner, retryMs, pageSize, maxPages, log });
  }
  async dispatch() {
    const [running, due] = await Promise.all([this.jobs.running(), this.jobs.dueScan({ pageSize: this.pageSize, maxPages: this.maxPages })]);
    const busy = new Map();
    for (const j of running) busy.set(j.ownerUid, (busy.get(j.ownerUid) || 0) + 1);
    let capacity = this.maxConcurrent - Math.max(running.length, this.active());
    const queues = new Map();
    for (const j of due) { if (!queues.has(j.ownerUid)) queues.set(j.ownerUid, []); queues.get(j.ownerUid).push(j); }
    const started = [];
    // Round-robin across owners in order of their oldest waiting job. An owner at
    // its concurrency cap, or one whose jobs cannot start, does not hold others back.
    while (capacity > 0 && queues.size) {
      for (const [owner, list] of [...queues]) {
        if (capacity <= 0) break;
        if ((busy.get(owner) || 0) >= this.perOwner || !list.length) { queues.delete(owner); continue; }
        const job = list.shift();
        let marked = false;
        try { marked = await this.jobs.markDispatched(owner, job.id, this.retryMs, { maxConcurrent: this.maxConcurrent, perOwner: this.perOwner }); }
        catch (e) { this.log(`[dispatch] ${job.id} not dispatched: ${e.code || 'ERROR'}`); queues.delete(owner); continue; }
        if (!marked) continue;
        busy.set(owner, (busy.get(owner) || 0) + 1); capacity--;
        try { await this.launch(job); started.push(job.id); }
        catch (e) { this.log(`[dispatch] ${job.id} launch failed; retried after ${this.retryMs} ms`); }
      }
    }
    return started;
  }
}

// Orphan attempts, pending account deletions and notification delivery.
async function maintain({ jobs, store, artifacts, deleteIdentity, notify = null, limit = 20, log = () => {} }) {
  const report = { swept: 0, deletions: 0, notifications: 0, errors: 0 };
  for (const j of await jobs.sweepDue(limit)) {
    try { report.swept += (await jobs.cleanupAttempts(j.ownerUid, j.id, artifacts)).removed.length; }
    catch (e) { report.errors++; log(`[maintain] sweep ${j.id}: ${e.code || 'ERROR'}`); }
  }
  for (const d of await store.listPendingDeletions(limit)) {
    const result = await resumeDeletion(store, d.uid, deleteIdentity, uid => jobs.cleanupOwner(uid, artifacts));
    if (result?.state === 'complete') report.deletions++;
  }
  if (notify) report.notifications = (await deliverOutbox(store, notify, { clock: jobs.clock, limit })).filter(r => r.status === 'sent').length;
  return report;
}

// In-process execution for the local conversion runtime: bakes run in this
// Node process (Blender as a child), one per launch.
function localLauncher({ jobs, artifacts, bake, heartbeatMs, onSettled = () => {}, log = () => {} }) {
  const active = new Set();
  return {
    active: () => active.size,
    launch: job => {
      const run = runOwnedRender({ jobs, uid: job.ownerUid, id: job.id, artifacts, bake, heartbeatMs })
        .catch(e => log(`[render] ${job.id} left for recovery: ${e.code || 'ERROR'}`))
        .finally(() => { active.delete(run); onSettled(); });
      active.add(run);
    },
    idle: () => Promise.all([...active]),
  };
}

// A single ticking loop: dispatch then maintain, never overlapping itself.
function renderLoop({ dispatcher, maintenance = null, intervalMs = 30_000, log = () => {} }) {
  let timer = null, running = null, again = false, stopped = false;
  const tick = async () => {
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        try { await dispatcher.dispatch(); } catch (e) { log(`[render] dispatch failed: ${e.code || e.message}`); }
        if (maintenance) try { await maintenance(); } catch (e) { log(`[render] maintenance failed: ${e.code || e.message}`); }
      } while (again && !stopped);
    })().finally(() => { running = null; });
    return running;
  };
  timer = setInterval(tick, intervalMs); timer.unref?.();
  return { kick: tick, stop: async () => { stopped = true; clearInterval(timer); await running; } };
}
module.exports = { RenderDispatcher, maintain, localLauncher, renderLoop };
