'use strict';
// Server-only job service. No route or cloud worker is enabled by this module.
const crypto = require('node:crypto');
const credit = require('./creditRecords');
const projects = require('./projectRecords');
const VERSION = Object.freeze({ schema: 1, renderer: 'hq-4', model: 'model3d-6', assets: 'hq-assets-2' });
const LEASE_MS = 60_000, DEADLINE_MS = 2 * 60 * 60_000, MAX_ATTEMPTS = 3;
// How long after an attempt's last valid lease its output may still be arriving
// (an upload already in flight). Cleanup waits this long before removing it.
const WRITE_GRACE_MS = 10 * 60_000, VIEWER_BYTES = 64_000;
const fail = (code, message) => { throw credit.error(code, message); };
const valid = s => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(s);
const terminal = j => ['done', 'failed'].includes(j.state);
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
  return value;
}
function options(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['sky', 'quality', 'stills', 'roofKind'].includes(k))) fail('JOB_INVALID', 'Unsupported render options');
  const result = { sky: value.sky ?? 'day', quality: value.quality ?? 'final', stills: value.stills ?? true, roofKind: value.roofKind ?? null };
  if (!['day', 'golden', 'dusk'].includes(result.sky) || !['preview', 'final'].includes(result.quality) || typeof result.stills !== 'boolean' ||
    (result.roofKind !== null && (typeof result.roofKind !== 'string' || !/^[a-zA-Z -]{1,40}$/.test(result.roofKind)))) fail('JOB_INVALID', 'Invalid render options');
  return result;
}
function request(uid, input) {
  if (!input || !valid(input.requestId) || !valid(input.projectId) || !Number.isSafeInteger(input.revision) || input.revision < 1) fail('JOB_INVALID', 'A saved project revision and stable request ID are required');
  const opts = options(input.options);
  const id = `rj_${credit.key(uid, input.requestId).slice(0, 40)}`;
  return { id, projectId: input.projectId, revision: input.revision, options: opts,
    fingerprint: credit.key(input.projectId, input.revision, canonical(opts)) };
}
const reservation = id => credit.request({ kind: 'reserve' }, 'bake_reserve', `render:${id}`);
function visible(job) {
  if (!job) return null;
  return Object.fromEntries(['id', 'projectId', 'projectRevision', 'projectName', 'state', 'progress', 'createdAt', 'updatedAt', 'failure', 'attempt', 'options'].map(k => [k, job[k] ?? null]));
}
function assertLease(job, token, now) {
  if (!job || job.state !== 'running' || job.lease?.token !== token || job.lease.until <= now || job.deadlineAt <= now) fail('JOB_LEASE_LOST', 'This render attempt no longer owns the job');
}
function manifest(files, opts) {
  if (!Array.isArray(files) || files.length < 2 || files.length > 200) fail('JOB_MANIFEST_INVALID', 'A complete model and lightmaps are required');
  const names = new Set(); let bytes = 0;
  const result = files.map(f => {
    const type = f?.name === 'house.glb' ? 'model/gltf-binary' : /^(lm_[a-zA-Z0-9_-]+|(?:exterior|interior)_[a-zA-Z0-9_-]+)\.jpg$/.test(f?.name) ? 'image/jpeg' : null;
    const generation = f?.generation ?? null;
    if (!type || f.name.length > 80 || names.has(f.name) || f.contentType !== type || !Number.isSafeInteger(f.size) || f.size <= 0 || f.size > 500_000_000 || !/^[a-f0-9]{64}$/.test(f.sha256) ||
      (generation !== null && (typeof generation !== 'string' || !/^[0-9]{1,30}$/.test(generation)))) fail('JOB_MANIFEST_INVALID', 'Invalid render artifact');
    names.add(f.name); bytes += f.size;
    // A pinned storage generation, when the artifact store has one, is part of the published record.
    return { name: f.name, contentType: type, size: f.size, sha256: f.sha256, generation };
  });
  if (!names.has('house.glb') || ![...names].some(n => n.startsWith('lm_')) || (opts.stills && ![...names].some(n => /^(exterior|interior)_/.test(n))) || bytes > 2_000_000_000) fail('JOB_MANIFEST_INVALID', 'Incomplete render output');
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
// Camera/room metadata for the viewer, derived by the server-side bake from the frozen plan.
function viewer(value) {
  if (value === null) return null;
  const text = value && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : null;
  if (!text || Buffer.byteLength(text) > VIEWER_BYTES) fail('JOB_MANIFEST_INVALID', 'Invalid viewer metadata');
  return JSON.parse(text);
}
// Notification intent, committed with the job's terminal state. Delivery is a
// separate, retryable step (outbox.js); the record holds no email address.
function notice(job, now) {
  return { id: `rn_${credit.key(job.id, job.state).slice(0, 40)}`, ownerUid: job.ownerUid, jobId: job.id,
    kind: job.state === 'done' ? 'render_ready' : 'render_failed', projectName: job.projectName || '',
    status: 'pending', attempts: 0, createdAt: now, nextAt: now, lease: null };
}
// Last moment an attempt could legitimately write: its live lease, or when it ended.
function attemptEnd(job, artifactId) {
  if (job.lease?.artifactId === artifactId) return job.lease.until;
  return job.attemptEnds?.[artifactId] ?? job.updatedAt;
}

class RenderJobs {
  constructor(accounts, { clock = Date.now, pool = 'default' } = {}) {
    if (!valid(pool)) fail('JOB_INVALID', 'Invalid render capacity pool');
    this.accounts = accounts; this.clock = clock; this.pool = pool;
  }
  async transact(uid, id, fn, scope = {}) {
    if (!/^rj_[a-f0-9]{40}$/.test(id)) fail('JOB_INVALID', 'Invalid render identifier');
    const r = reservation(id);
    return this.accounts.atomicAccount(uid, r.keys, (user, records, context) => fn(user, records, context, r, this.clock()), null, null, { ...scope, id, pool: this.pool, now: this.clock });
  }
  async create(uid, input) {
    const r = request(uid, input);
    return this.transact(uid, r.id, (user, records, { job, project }, reserve, now) => {
      if (job) {
        if (job.ownerUid !== uid) return { result: null };
        if (job.fingerprint !== r.fingerprint) fail('JOB_CONFLICT', 'This request ID was used for a different render');
        return { result: visible(job) };
      }
      if (require('./entitlements').tierOf(user) !== 'pro') fail('UPGRADE_REQUIRED', 'Photoreal rendering requires Pro');
      if (!project || project.ownerUid !== uid) fail('JOB_PROJECT_NOT_FOUND', 'Saved house not found');
      if (projects.revisionOf(project) !== r.revision) fail('PROJECT_CONFLICT', 'The saved house changed; reopen it before rendering');
      if (!Array.isArray(project.planSpec?.levels) || !project.planSpec.levels.length || project.planSpec.levels.length > 6) fail('JOB_INVALID', 'A generated floor plan is required');
      const snapshot = { id: r.id, ownerUid: uid, revision: 1, planSpec: project.planSpec, options: r.options, versions: VERSION };
      const encoded = projects.encode(snapshot);
      const change = credit.credit(user, records, reserve, new Date(now).toISOString());
      if (change.result.duplicate) fail('JOB_CREDIT_CONFLICT', 'A reservation exists without its job');
      const created = { id: r.id, ownerUid: uid, dispatchPool: this.pool, projectId: r.projectId, projectRevision: r.revision, fingerprint: r.fingerprint,
        projectName: String(project.name || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 120),
        contentHash: credit.key(canonical({ planSpec: project.planSpec, options: r.options, versions: VERSION })),
        input: encoded.metadata, versions: VERSION, options: r.options, reservationId: reserve.id,
        state: 'queued', attempt: 0, lease: null, artifactAttempts: [], manifest: null, progress: 0, failure: null,
        createdAt: now, updatedAt: now, deadlineAt: now + DEADLINE_MS, wakeAt: now };
      return { ...change, job: created, input: { snapshot, chunks: encoded.chunks }, result: visible(created) };
    }, { projectId: r.projectId });
  }
  async get(uid, id) { return this.transact(uid, id, (u, r, { job }) => ({ result: job?.ownerUid === uid ? visible(job) : null })); }
  async claim(uid, id) {
    const token = crypto.randomBytes(16).toString('hex');
    return this.transact(uid, id, (user, records, { job, slots }, r, now) => {
      if (!job || job.ownerUid !== uid || terminal(job)) return { result: null };
      if (job.deadlineAt <= now || (job.attempt >= MAX_ATTEMPTS && job.lease?.until <= now)) return this.finish(user, records, job, 'failed', now, 'RETRIES_EXHAUSTED');
      if (job.state === 'running' && job.lease.until > now) return { result: null };
      // A delayed launcher must not start after its admission expired and another
      // job took that capacity. The scheduler can reserve and launch it again.
      if (job.dispatch && !slots[id]) return { result: null };
      const artifactId = `${id}_${token}`;
      const ends = job.lease ? { ...job.attemptEnds, [job.lease.artifactId]: job.lease.until } : { ...job.attemptEnds };
      const next = { ...job, dispatch: job.dispatch ? { ...job.dispatch, until: 0 } : null, state: 'running', attempt: job.attempt + 1, progress: 0,
        lease: { token, until: Math.min(now + LEASE_MS, job.deadlineAt), artifactId },
        artifactAttempts: [...job.artifactAttempts, artifactId], attemptEnds: ends, updatedAt: now, wakeAt: Math.min(now + LEASE_MS, job.deadlineAt) };
      return { job: next, result: { id, token, artifactId, attempt: next.attempt, until: next.lease.until } };
    });
  }
  async input(uid, id, token) {
    return this.transact(uid, id, (user, records, { job, input }, r, now) => {
      assertLease(job, token, now);
      return { result: input };
    }, { readInput: true });
  }
  async heartbeat(uid, id, token, progress = 0) {
    if (!Number.isFinite(progress) || progress < 0 || progress >= 1) fail('JOB_INVALID', 'Invalid render progress');
    return this.transact(uid, id, (u, r, { job }, reserve, now) => {
      assertLease(job, token, now);
      const next = { ...job, progress: Math.max(job.progress, progress), updatedAt: now,
        lease: { ...job.lease, until: Math.min(now + LEASE_MS, job.deadlineAt) }, wakeAt: Math.min(now + LEASE_MS, job.deadlineAt) };
      return { job: next, result: next.lease.until };
    });
  }
  finish(user, records, job, state, now, failure = null, files = null, meta = null) {
    const change = credit.settle(user, records, job.reservationId, state === 'done' ? 'spent' : 'refunded', new Date(now).toISOString());
    if (!change.result) fail('JOB_CREDIT_CONFLICT', 'The job reservation was already settled outside its job');
    const ends = job.lease ? { ...job.attemptEnds, [job.lease.artifactId]: Math.min(now, job.lease.until) } : { ...job.attemptEnds };
    // Attempts other than the published one become orphans once quiet; the maintenance sweep removes them.
    const orphans = job.artifactAttempts.length - (files ? 1 : 0);
    const next = { ...job, state, failure, manifest: files ? { artifactId: job.lease.artifactId, files } : null, viewer: meta, attemptEnds: ends,
      completedToken: job.lease?.token || null, lease: null, wakeAt: null, sweepAt: orphans > 0 ? now + WRITE_GRACE_MS : null,
      updatedAt: now, progress: state === 'done' ? 1 : job.progress };
    return { ...change, job: next, outbox: notice(next, now), result: visible(next) };
  }
  async complete(uid, id, token, files, meta = null) {
    return this.transact(uid, id, (user, records, { job }, r, now) => {
      const checked = manifest(files, job?.options || {}), checkedViewer = viewer(meta);
      if (job?.state === 'done' && job.completedToken === token && canonical(job.manifest.files) === canonical(checked)) return { result: visible(job) };
      assertLease(job, token, now);
      return this.finish(user, records, job, 'done', now, null, checked, checkedViewer);
    });
  }
  async fail(uid, id, token) {
    return this.transact(uid, id, (user, records, { job }, r, now) => {
      if (job?.state === 'failed' && job.completedToken === token) return { result: visible(job) };
      assertLease(job, token, now);
      return this.finish(user, records, job, 'failed', now, 'RENDER_FAILED');
    });
  }
  // Discovery only (a scheduler may die at any point): claim() stays the authority.
  // Pages past jobs that cannot start (for example an owner being deleted) so they
  // cannot hide a job behind them.
  async dueScan({ pageSize = 100, maxPages = 5 } = {}) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50) fail('JOB_INVALID', 'Invalid scan limit');
    const now = this.clock(), found = [];
    for (let page = 0, cursor = null; page < maxPages; page++) {
      const batch = await this.accounts.dueRenderJobs(now, pageSize, cursor);
      found.push(...batch.filter(j => !terminal(j)).map(j => ({ id: j.id, ownerUid: j.ownerUid, wakeAt: j.wakeAt })));
      if (batch.length < pageSize) break;
      cursor = { wakeAt: batch[batch.length - 1].wakeAt, id: batch[batch.length - 1].id };
    }
    return found;
  }
  async due(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('JOB_INVALID', 'Invalid scan limit');
    return (await this.dueScan({ pageSize: limit, maxPages: 1 })).map(({ id, ownerUid }) => ({ id, ownerUid }));
  }
  // Jobs holding a live lease: the dispatcher's concurrency count.
  async running() {
    const now = this.clock();
    return (await this.accounts.runningRenderJobs()).filter(j => j.state === 'running' && j.lease?.until > now).map(j => ({ id: j.id, ownerUid: j.ownerUid }));
  }
  // Records a dispatch so repeated scheduler ticks do not launch duplicate
  // executions; an execution that never claims is dispatched again after retryMs.
  async markDispatched(uid, id, retryMs, { maxConcurrent = 1, perOwner = 1 } = {}) {
    if (!Number.isInteger(retryMs) || retryMs < 1000 || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 128 || !Number.isInteger(perOwner) || perOwner < 1 || perOwner > maxConcurrent) fail('JOB_INVALID', 'Invalid dispatch limits');
    return this.transact(uid, id, (u, r, { job, slots }, reserve, now) => {
      if (!job || job.ownerUid !== uid || terminal(job) || (job.state === 'running' && job.lease?.until > now)) return { result: false };
      if (job.dispatch && job.dispatch.at + retryMs > now) return { result: false };
      const held = Object.values(slots);
      if (held.length >= maxConcurrent || held.filter(s => s.ownerUid === uid).length >= perOwner) return { result: false };
      return { job: { ...job, dispatch: { at: now, until: now + retryMs, count: (job.dispatch?.count || 0) + 1 } }, result: true };
    });
  }
  async list(uid, { projectId = null, limit = 50 } = {}) {
    if (projectId !== null && !valid(projectId)) fail('JOB_INVALID', 'Invalid saved house');
    return (await this.accounts.listOwnerRenderJobs(uid, limit)).filter(j => j.ownerUid === uid && (!projectId || j.projectId === projectId)).map(visible);
  }
  // Server-only view of a completed owned job, for issuing file access.
  async published(uid, id) {
    return this.transact(uid, id, (u, r, { job }) => ({ result: job?.ownerUid === uid && job.state === 'done' && job.manifest
      ? { job: visible(job), artifactId: job.manifest.artifactId, files: job.manifest.files, viewer: job.viewer || null } : null }));
  }
  async sweepDue(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('JOB_INVALID', 'Invalid scan limit');
    return (await this.accounts.sweepDueRenderJobs(this.clock(), limit)).map(j => ({ id: j.id, ownerUid: j.ownerUid }));
  }
  // Removes attempt output that can no longer change: every attempt whose last
  // valid lease ended at least WRITE_GRACE_MS ago. A completed job keeps its
  // published attempt unless the owner's account is being deleted. Storage is
  // removed first and recorded afterwards, so a crash between the two only
  // repeats an idempotent removal. With `deleting`, a job whose every attempt is
  // removed (or that never started) is deleted with its frozen input.
  async cleanupAttempts(uid, id, artifacts, { deleting = false } = {}) {
    if (!/^rj_[a-f0-9]{40}$/.test(id)) fail('JOB_INVALID', 'Invalid render identifier');
    const job = await this.accounts.renderCleanup(uid, id, current => ({ result: current }), { deleting });
    if (!job) return { removed: [], pending: 0, deleted: false };
    const now = this.clock(), keep = !deleting && job.state === 'done' ? job.manifest?.artifactId : null;
    const open = job.artifactAttempts.filter(a => a !== keep && !(job.removedAttempts || []).includes(a));
    const due = open.filter(a => attemptEnd(job, a) + WRITE_GRACE_MS <= now), removed = [];
    for (const artifactId of due) { await artifacts.remove(artifactId); removed.push(artifactId); }
    const deleted = await this.accounts.renderCleanup(uid, id, current => {
      if (!current) return { result: deleting };
      const removedAttempts = [...new Set([...(current.removedAttempts || []), ...removed])];
      const live = current.state === 'running' && current.lease?.until > this.clock();
      if (deleting && !live && current.artifactAttempts.every(a => removedAttempts.includes(a))) return { deleteJob: true, result: true };
      // Terminal jobs are revisited by the orphan sweep until nothing but the published attempt remains.
      const keepNow = !deleting && current.state === 'done' ? current.manifest?.artifactId : null;
      const remaining = current.artifactAttempts.filter(a => a !== keepNow && !removedAttempts.includes(a));
      const sweepAt = terminal(current) && remaining.length ? Math.min(...remaining.map(a => attemptEnd(current, a) + WRITE_GRACE_MS)) : null;
      return removed.length || (current.sweepAt ?? null) !== sweepAt ? { job: { ...current, removedAttempts, sweepAt }, result: false } : { result: false };
    }, { deleting });
    return { removed, pending: open.length - removed.length, deleted };
  }
  // Account deletion: runs under the deletion fence, which already blocks new
  // jobs, claims, heartbeats and publication. Reports pending work as an error
  // so the resumable deletion lifecycle retries later.
  async cleanupOwner(uid, artifacts) {
    if (!await this.accounts.getDeletion(uid)) fail('JOB_INVALID', 'Owner cleanup requires an account deletion fence');
    let pending = 0;
    for (const id of await this.accounts.listOwnerRenderJobIds(uid)) if (!(await this.cleanupAttempts(uid, id, artifacts, { deleting: true })).deleted) pending++;
    if (pending) fail('RENDER_CLEANUP_REQUIRED', 'Render output is still finishing; cleanup will retry');
    return { pending };
  }
}
module.exports = { RenderJobs, manifest, VERSION, LEASE_MS, DEADLINE_MS, MAX_ATTEMPTS, WRITE_GRACE_MS };
