'use strict';

// Account data: users, a credits ledger, projects and processed Stripe events.
//
// Two implementations with one interface:
//   MemoryStore    - tests and local development (ACCOUNTS_STORE=memory)
//   FirestoreStore - production (Firestore in the GCP project)
//
// Credits come in two buckets: `monthly` (one allowance per paid period) and
// `extra` (including expired-period refunds; never expire). A photoreal
// bake reserves one credit (monthly first), then either spends it or refunds
// it. Every change is a ledger entry written in the same transaction as the
// balance, so the balance can always be explained. Reservation status and retry
// receipts are separate from the immutable ledger, under users/{uid}/creditOps.

const crypto = require('crypto');
const projects = require('./projectRecords');
const { assertActive, assertDeletable } = require('./lifecycle');

const creditRecords = require('./creditRecords');
const capacity = require('./renderCapacity');
const { NoCreditsError } = creditRecords;

const newId = () => crypto.randomBytes(10).toString('hex');
const now = () => new Date().toISOString();
const emptyUser = (uid, email) => ({
  uid, email: email || '', name: '', createdAt: now(), marketingOptIn: false,
  credits: { monthly: 0, extra: 0 },
  subscription: null, // Verified canonical Stripe state; see billing.js.
  stripeCustomerId: null,
});

class MemoryStore {
  constructor() {
    this.users = new Map();
    this.ledger = new Map(); // uid -> [entries]
    this.projects = new Map();
    this.renderJobs = new Map();
    this.renderPools = new Map();
    this.renderInputs = new Map();
    this.outbox = new Map();
    this.events = new Map();
    this.creditOps = new Map();
    this.billingCustomers = new Map();
    this.deletions = new Map();
    this.projectTombstones = new Map();
  }

  async getUser(uid) { return this.users.has(uid) ? structuredClone(this.users.get(uid)) : null; }

  async ensureUser(uid, email) {
    assertActive(this.deletions.get(uid));
    if (!this.users.has(uid)) this.users.set(uid, emptyUser(uid, email));
    return this.getUser(uid);
  }

  async updateUser(uid, patch) {
    assertActive(this.deletions.get(uid));
    const u = this.users.get(uid);
    if (!u) throw new Error('no such user');
    this.users.set(uid, { ...u, ...patch, uid });
    return this.getUser(uid);
  }

  async findUserByCustomer(customerId) {
    for (const u of this.users.values()) if (u.stripeCustomerId === customerId) return structuredClone(u);
    return null;
  }

  async atomicAccount(uid, keys, transition, eventId = null, customerId = null, jobScope = null) {
    // No await between reading and publishing: equivalent atomic boundary in memory.
    if (eventId && this.events.has(eventId)) return 'duplicate';
    const deletion = this.deletions.get(uid), user = this.users.get(uid);
    if (eventId && (deletion || !user)) { this.events.set(eventId, { at: now(), result: 'account unavailable' }); return 'account unavailable'; }
    assertActive(deletion);
    if (!user) throw new Error('no such user');
    if (customerId && this.billingCustomers.has(customerId) && this.billingCustomers.get(customerId) !== uid) {
      if (eventId) this.events.set(eventId, { at: now(), result: 'customer ownership mismatch' });
      return 'customer ownership mismatch';
    }
    const ops = this.creditOps.get(uid) || new Map();
    const records = Object.fromEntries(keys.map(k => [k, structuredClone(ops.get(k) || null)]));
    const job = jobScope ? this.renderJobs.get(jobScope.id) : null;
    if (job && job.ownerUid !== uid) return null;
    const project = jobScope?.projectId && !job ? this.projects.get(jobScope.projectId) : null;
    const input = jobScope?.readInput && job ? this.renderInputs.get(jobScope.id) : null;
    const pool = job?.dispatchPool || jobScope?.pool || 'default';
    const slots = jobScope ? capacity.active(this.renderPools.get(pool), jobScope.now()) : {};
    const change = transition(structuredClone(user), records, structuredClone({ job, project, input, slots }));
    // Prepare all copies before publishing any state.
    const copy = structuredClone(change);
    const poolUpdate = copy.job ? capacity.update(slots, copy.job) : null;
    if (copy.outbox && this.outbox.has(copy.outbox.id)) throw new Error('Notification already recorded');
    if (copy.job) { this.renderPools.set(pool, poolUpdate); this.renderJobs.set(jobScope.id, copy.job); }
    if (copy.input) this.renderInputs.set(jobScope.id, copy.input.snapshot);
    if (copy.outbox) this.outbox.set(copy.outbox.id, copy.outbox);
    if (change.patch?.stripeCustomerId && customerId) this.billingCustomers.set(customerId, uid);
    if (change.patch) this.users.set(uid, { ...user, ...structuredClone(change.patch), uid });
    if (change.entries?.length) this.ledger.set(uid, [...(this.ledger.get(uid) || []), ...structuredClone(change.entries)]);
    for (const [id, record] of Object.entries(change.records || {})) ops.set(id, structuredClone(record));
    this.creditOps.set(uid, ops);
    if (eventId) this.events.set(eventId, { at: now(), result: 'processed' });
    return structuredClone(change.result);
  }

  async credit(uid, op, reason, ref = null) {
    const r = creditRecords.request(op, reason, ref);
    return this.atomicAccount(uid, r.keys, (user, records) => creditRecords.credit(user, records, r));
  }

  async settle(uid, entryId, outcome) {
    return this.atomicAccount(uid, [entryId], (user, records) => creditRecords.settle(user, records, entryId, outcome));
  }

  async listLedger(uid, limit = 50) { return structuredClone([...(this.ledger.get(uid) || [])].reverse().slice(0, limit)); }

  async listProjects(uid) {
    assertActive(this.deletions.get(uid));
    return [...this.projects.values()].filter((p) => p.ownerUid === uid).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(projects.summary);
  }

  async getProject(uid, id) {
    assertActive(this.deletions.get(uid));
    const p = this.projects.get(id);
    return p && p.ownerUid === uid ? structuredClone(p) : null;
  }

  async saveProject(uid, id, data, options = {}) {
    assertActive(this.deletions.get(uid));
    const pid = id || (options.mutationId ? projects.projectId(uid, options.mutationId) : newId());
    if (this.projectTombstones.has(pid)) { if (id) return null; throw projects.error('PROJECT_DELETED', 'This house was deleted. Save the draft as a new house.'); }
    const previous = this.projects.get(pid);
    if (id && !previous) return null;
    const doc = projects.applyProject(previous, uid, pid, data, options);
    if (!doc) return null;
    this.projects.set(pid, doc);
    return structuredClone(doc);
  }

  async deleteProject(uid, id, revision) {
    const p = this.projects.get(id);
    if (!p || p.ownerUid !== uid) return false;
    if (revision !== undefined && projects.revisionOf(p) !== revision) throw projects.error('PROJECT_CONFLICT', 'This house changed. Refresh the list before deleting it.');
    this.projectTombstones.set(id, { ownerUid: uid, deletedAt: now() });
    this.projects.delete(id);
    return true;
  }

  async getDeletion(uid) { return this.deletions.has(uid) ? structuredClone(this.deletions.get(uid)) : null; }
  async beginDeletion(uid) {
    if (this.deletions.has(uid)) return this.getDeletion(uid);
    assertDeletable(this.users.get(uid));
    this.deletions.set(uid, { uid, state: 'pending', requestedAt: now(), updatedAt: now() });
    return this.getDeletion(uid);
  }
  async setDeletionState(uid, state, failure = null) {
    const existing = this.deletions.get(uid);
    if (!existing) throw new Error('Deletion was not requested');
    if (existing.state === 'complete') return this.getDeletion(uid);
    this.deletions.set(uid, { ...existing, state, failure, updatedAt: now() });
    return this.getDeletion(uid);
  }
  async listPendingDeletions(limit = 20) { return [...this.deletions.values()].filter(j => j.state !== 'complete').slice(0, limit).map(j => structuredClone(j)); }
  // Cleanup-only job transaction. It never touches credits and is allowed while
  // the account is being deleted; `deleting` requires that fence. See renderJobs.
  async renderCleanup(uid, id, transition, { deleting = false } = {}) {
    if (deleting && !this.deletions.has(uid)) throw new Error('Deletion fence required');
    const job = this.renderJobs.get(id);
    const change = transition(job && job.ownerUid === uid ? structuredClone(job) : null);
    if (job && job.ownerUid === uid && change.deleteJob) {
      const pool = job.dispatchPool || 'default';
      if (this.renderPools.has(pool)) this.renderPools.set(pool, capacity.remove(this.renderPools.get(pool), id));
      this.renderJobs.delete(id); this.renderInputs.delete(id);
    }
    else if (job && job.ownerUid === uid && change.job) this.renderJobs.set(id, structuredClone(change.job));
    return structuredClone(change.result);
  }
  async listOwnerRenderJobIds(uid) { return [...this.renderJobs.values()].filter(j => j.ownerUid === uid).map(j => j.id).sort(); }
  async listOwnerRenderJobs(uid, limit = 50) {
    return structuredClone([...this.renderJobs.values()].filter(j => j.ownerUid === uid).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(0, limit));
  }
  async dueRenderJobs(now, limit, cursor = null) {
    const after = j => !cursor || j.wakeAt > cursor.wakeAt || (j.wakeAt === cursor.wakeAt && j.id > cursor.id);
    return structuredClone([...this.renderJobs.values()].filter(j => j.wakeAt != null && j.wakeAt <= now && after(j))
      .sort((a, b) => a.wakeAt - b.wakeAt || a.id.localeCompare(b.id)).slice(0, limit));
  }
  async runningRenderJobs() { return structuredClone([...this.renderJobs.values()].filter(j => j.state === 'running')); }
  async sweepDueRenderJobs(now, limit) {
    return structuredClone([...this.renderJobs.values()].filter(j => j.sweepAt != null && j.sweepAt <= now).sort((a, b) => a.sweepAt - b.sweepAt).slice(0, limit));
  }
  async listOutboxDue(now, limit = 20) {
    return structuredClone([...this.outbox.values()].filter(r => r.status === 'pending' && r.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt).slice(0, limit));
  }
  // Read-modify-write of one notification record; the transition returns null to leave it unchanged.
  async updateOutbox(id, transition) {
    const current = this.outbox.get(id);
    const next = transition(structuredClone(current || null), { deleting: Boolean(current && this.deletions.has(current.ownerUid)) });
    if (next) this.outbox.set(id, structuredClone(next));
    return structuredClone(next);
  }
  async purgeAccountData(uid) {
    if (!this.deletions.has(uid)) throw new Error('Deletion fence required');
    const jobs = [...this.renderJobs.values()].filter(j => j.ownerUid === uid);
    // Every recorded attempt namespace must have been removed by the quiescent
    // artifact cleanup (RenderJobs.cleanupOwner) before identity removal.
    if (jobs.some(j => j.artifactAttempts.some(a => !(j.removedAttempts || []).includes(a)))) throw creditRecords.error('RENDER_CLEANUP_REQUIRED', 'Render artifact cleanup must finish first');
    for (const job of jobs) {
      const pool = job.dispatchPool || 'default';
      if (this.renderPools.has(pool)) this.renderPools.set(pool, capacity.remove(this.renderPools.get(pool), job.id));
      this.renderJobs.delete(job.id); this.renderInputs.delete(job.id);
    }
    for (const [id, r] of this.outbox) if (r.ownerUid === uid) this.outbox.delete(id);
    for (const [id, p] of this.projects) if (p.ownerUid === uid) this.projects.delete(id);
    for (const [id, p] of this.projectTombstones) if (p.ownerUid === uid) this.projectTombstones.delete(id);
    this.ledger.delete(uid);
    this.creditOps.delete(uid);
    for (const [id, owner] of this.billingCustomers) if (owner === uid) this.billingCustomers.delete(id);
    this.users.delete(uid);
  }
  async deleteUser(uid) { await this.beginDeletion(uid); await this.purgeAccountData(uid); }
}

class FirestoreStore {
  constructor(db) {
    this.db = db;
    this.users = db.collection('users');
    this.projects = db.collection('projects');
    this.renderJobs = db.collection('renderJobs');
    this.renderPools = db.collection('renderDispatchPools');
    this.outbox = db.collection('notificationOutbox');
    this.events = db.collection('stripeEvents');
    this.billingCustomers = db.collection('billingCustomers');
    this.deletions = db.collection('accountDeletions');
    this.projectTombstones = db.collection('projectTombstones');
  }

  async getUser(uid) { const s = await this.users.doc(uid).get(); return s.exists ? s.data() : null; }

  async ensureUser(uid, email) {
    const ref = this.users.doc(uid);
    await this.db.runTransaction(async (tx) => {
      assertActive((await tx.get(this.deletions.doc(uid))).data());
      const s = await tx.get(ref);
      if (!s.exists) tx.set(ref, emptyUser(uid, email));
    });
    return this.getUser(uid);
  }

  async updateUser(uid, patch) {
    await this.db.runTransaction(async tx => {
      assertActive((await tx.get(this.deletions.doc(uid))).data());
      const ref = this.users.doc(uid), user = await tx.get(ref);
      if (!user.exists) throw new Error('no such user');
      tx.update(ref, patch);
    });
    return this.getUser(uid);
  }

  async findUserByCustomer(customerId) {
    const q = await this.users.where('stripeCustomerId', '==', customerId).limit(1).get();
    return q.empty ? null : q.docs[0].data();
  }

  async atomicAccount(uid, keys, transition, eventId = null, customerId = null, jobScope = null) {
    const uref = this.users.doc(uid), event = eventId ? this.events.doc(eventId) : null;
    return this.db.runTransaction(async tx => {
      if (event && (await tx.get(event)).exists) return 'duplicate';
      const deletion = (await tx.get(this.deletions.doc(uid))).data();
      const us = await tx.get(uref);
      if (event && (deletion || !us.exists)) { tx.set(event, { at: now(), result: 'account unavailable' }); return 'account unavailable'; }
      assertActive(deletion);
      if (!us.exists) throw new Error('no such user');
      const binding = customerId ? this.billingCustomers.doc(customerId) : null;
      const owner = binding ? (await tx.get(binding)).data()?.ownerUid : null;
      if (owner && owner !== uid) {
        if (event) tx.set(event, { at: now(), result: 'customer ownership mismatch' });
        return 'customer ownership mismatch';
      }
      const records = {};
      for (const k of new Set(keys)) records[k] = (await tx.get(uref.collection('creditOps').doc(k))).data() || null;
      const jobRef = jobScope ? this.renderJobs.doc(jobScope.id) : null;
      const job = jobRef ? (await tx.get(jobRef)).data() : null;
      if (job && job.ownerUid !== uid) return null;
      let project = null, input = null;
      if (jobScope?.projectId && !job) {
        const ref = this.projects.doc(jobScope.projectId), saved = await tx.get(ref);
        if (saved.exists && saved.data().ownerUid === uid) project = await this.readProject(tx, ref, saved.data());
      }
      if (jobScope?.readInput && job) input = await this.readProject(tx, jobRef, job.input);
      const poolRef = jobScope ? this.renderPools.doc(job?.dispatchPool || jobScope.pool || 'default') : null;
      const slots = poolRef ? capacity.active((await tx.get(poolRef)).data(), jobScope.now()) : {};
      const change = transition(us.data(), records, { job, project, input, slots });
      const poolUpdate = change.job ? capacity.update(slots, change.job) : null;
      // All reads precede writes; callback is synchronous and may be retried by Firestore.
      if (change.job) { tx.set(poolRef, poolUpdate); tx.set(jobRef, change.job); }
      if (change.input) change.input.chunks.forEach((data, i) => tx.create(jobRef.collection('payload').doc(String(i)), { data }));
      // Created, never overwritten: a terminal transition happens once per job.
      if (change.outbox) tx.create(this.outbox.doc(change.outbox.id), change.outbox);
      if (change.patch?.stripeCustomerId && binding) tx.set(binding, { ownerUid: uid });
      if (change.patch) tx.update(uref, change.patch);
      for (const entry of change.entries || []) tx.create(uref.collection('ledger').doc(entry.id), entry);
      for (const [id, record] of Object.entries(change.records || {})) tx.set(uref.collection('creditOps').doc(id), record);
      if (event) tx.set(event, { at: now(), result: 'processed' });
      return change.result;
    });
  }

  async credit(uid, op, reason, ref = null) {
    const r = creditRecords.request(op, reason, ref);
    return this.atomicAccount(uid, r.keys, (user, records) => creditRecords.credit(user, records, r));
  }

  async settle(uid, entryId, outcome) {
    return this.atomicAccount(uid, [entryId], (user, records) => creditRecords.settle(user, records, entryId, outcome));
  }

  async listLedger(uid, limit = 50) {
    const q = await this.users.doc(uid).collection('ledger').orderBy('at', 'desc').limit(limit).get();
    return q.docs.map((d) => d.data());
  }

  async listProjects(uid) {
    assertActive(await this.getDeletion(uid));
    const q = await this.projects.where('ownerUid', '==', uid).orderBy('updatedAt', 'desc').limit(200).get();
    return q.docs.map(d => projects.summary(d.data()));
  }

  async readProject(tx, ref, metadata) {
    if (!metadata.payload) return projects.decode(metadata, []);
    const count = metadata.payload.count;
    if (!Number.isInteger(count) || count < 1 || count > Math.ceil(projects.MAX_PROJECT_BYTES / projects.CHUNK_BYTES)) throw projects.error('PROJECT_CORRUPT', 'Invalid saved house payload.');
    const parts = [];
    for (let i = 0; i < count; i++) parts.push((await tx.get(ref.collection('payload').doc(String(i)))).data()?.data);
    return projects.decode(metadata, parts);
  }

  async getProject(uid, id) {
    const ref = this.projects.doc(id);
    return this.db.runTransaction(async tx => {
      assertActive((await tx.get(this.deletions.doc(uid))).data());
      const s = await tx.get(ref);
      if (!s.exists || s.data().ownerUid !== uid) return null;
      return this.readProject(tx, ref, s.data());
    });
  }

  async saveProject(uid, id, data, options = {}) {
    const ref = this.projects.doc(id || (options.mutationId ? projects.projectId(uid, options.mutationId) : newId()));
    return this.db.runTransaction(async tx => {
      assertActive((await tx.get(this.deletions.doc(uid))).data());
      const s = await tx.get(ref);
      if ((id && !s.exists) || (s.exists && s.data().ownerUid !== uid)) return null;
      const tombstone = await tx.get(this.projectTombstones.doc(ref.id));
      if (tombstone.exists) { if (id) return null; throw projects.error('PROJECT_DELETED', 'This house was deleted. Save the draft as a new house.'); }
      const previous = s.exists ? await this.readProject(tx, ref, s.data()) : null;
      const doc = projects.applyProject(previous, uid, ref.id, data, options);
      const { metadata, chunks } = projects.encode(doc);
      tx.set(ref, metadata);
      chunks.forEach((data, i) => tx.set(ref.collection('payload').doc(String(i)), { data }));
      for (let i = chunks.length; i < (s.data()?.payload?.count || 0); i++) tx.delete(ref.collection('payload').doc(String(i)));
      return doc;
    });
  }

  async deleteProject(uid, id, revision) {
    const ref = this.projects.doc(id);
    return this.db.runTransaction(async tx => {
      const s = await tx.get(ref);
      if (!s.exists || s.data().ownerUid !== uid) return false;
      if (revision !== undefined && projects.revisionOf(s.data()) !== revision) throw projects.error('PROJECT_CONFLICT', 'This house changed. Refresh the list before deleting it.');
      const parts = await tx.get(ref.collection('payload'));
      parts.docs.forEach(d => tx.delete(d.ref));
      tx.set(this.projectTombstones.doc(id), { ownerUid: uid, deletedAt: now() });
      tx.delete(ref);
      return true;
    });
  }

  async getDeletion(uid) { const s = await this.deletions.doc(uid).get(); return s.exists ? s.data() : null; }
  async beginDeletion(uid) {
    const ref = this.deletions.doc(uid);
    return this.db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (existing.exists) return existing.data();
      const user = await tx.get(this.users.doc(uid));
      assertDeletable(user.data());
      const job = { uid, state: 'pending', requestedAt: now(), updatedAt: now() };
      tx.set(ref, job);
      return job;
    });
  }
  async setDeletionState(uid, state, failure = null) {
    const ref = this.deletions.doc(uid);
    return this.db.runTransaction(async tx => {
      const s = await tx.get(ref);
      if (!s.exists) throw new Error('Deletion was not requested');
      if (s.data().state === 'complete') return s.data();
      const job = { ...s.data(), state, failure, updatedAt: now() };
      tx.set(ref, job); return job;
    });
  }
  async listPendingDeletions(limit = 20) {
    const q = await this.deletions.where('state', 'in', ['pending', 'identity_pending']).limit(limit).get();
    return q.docs.map(d => d.data());
  }
  async renderCleanup(uid, id, transition, { deleting = false } = {}) {
    const ref = this.renderJobs.doc(id);
    return this.db.runTransaction(async tx => {
      const fence = await tx.get(this.deletions.doc(uid));
      if (deleting && !fence.exists) throw new Error('Deletion fence required');
      const snap = await tx.get(ref), job = snap.exists && snap.data().ownerUid === uid ? snap.data() : null;
      const parts = job && deleting ? await tx.get(ref.collection('payload')) : null; // reads before writes
      const change = transition(job);
      if (job && change.deleteJob) {
        const poolRef = this.renderPools.doc(job.dispatchPool || 'default'), pool = await tx.get(poolRef);
        if (pool.exists) tx.set(poolRef, capacity.remove(pool.data(), id));
        parts.docs.forEach(d => tx.delete(d.ref)); tx.delete(ref);
      }
      else if (job && change.job) tx.set(ref, change.job);
      return change.result;
    });
  }
  async listOwnerRenderJobIds(uid) {
    const { FieldPath } = require('firebase-admin/firestore'); // declared dependency; same class as the SDK's
    const ids = [];
    for (let last = null; ;) {
      let q = this.renderJobs.where('ownerUid', '==', uid).orderBy(FieldPath.documentId()).select().limit(200);
      if (last) q = q.startAfter(last);
      const page = await q.get();
      ids.push(...page.docs.map(d => d.id));
      if (page.size < 200) return ids;
      last = page.docs[page.size - 1].id;
    }
  }
  async listOwnerRenderJobs(uid, limit = 50) {
    const q = await this.renderJobs.where('ownerUid', '==', uid).orderBy('createdAt', 'desc').limit(limit).get();
    return q.docs.map(d => d.data());
  }
  async dueRenderJobs(now, limit, cursor = null) {
    const { FieldPath } = require('firebase-admin/firestore');
    let q = this.renderJobs.where('wakeAt', '<=', now).orderBy('wakeAt').orderBy(FieldPath.documentId()).limit(limit);
    if (cursor) q = q.startAfter(cursor.wakeAt, cursor.id);
    return (await q.get()).docs.map(d => d.data());
  }
  async runningRenderJobs() { return (await this.renderJobs.where('state', '==', 'running').limit(500).get()).docs.map(d => d.data()); }
  async sweepDueRenderJobs(now, limit) { return (await this.renderJobs.where('sweepAt', '<=', now).orderBy('sweepAt').limit(limit).get()).docs.map(d => d.data()); }
  async listOutboxDue(now, limit = 20) {
    return (await this.outbox.where('status', '==', 'pending').where('nextAt', '<=', now).orderBy('nextAt').limit(limit).get()).docs.map(d => d.data());
  }
  async updateOutbox(id, transition) {
    const ref = this.outbox.doc(id);
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(ref), current = snap.exists ? snap.data() : null;
      const fence = current ? await tx.get(this.deletions.doc(current.ownerUid)) : null;
      const next = transition(current, { deleting: Boolean(fence?.exists) });
      if (next) tx.set(ref, next);
      return next;
    });
  }
  async purgeAccountData(uid) {
    if (!await this.getDeletion(uid)) throw new Error('Deletion fence required');
    // A claimed job may have private artifacts or a worker still writing. Never
    // declare deletion complete until every recorded attempt namespace was removed.
    const ownedJobs = this.renderJobs.where('ownerUid', '==', uid);
    for (let cursor = null; ;) {
      let q = ownedJobs.where('attempt', '>', 0).limit(100);
      if (cursor) q = q.startAfter(cursor);
      const page = await q.get();
      if (page.docs.some(d => d.data().artifactAttempts.some(a => !(d.data().removedAttempts || []).includes(a)))) throw creditRecords.error('RENDER_CLEANUP_REQUIRED', 'Render artifact cleanup must finish first');
      if (page.size < 100) break;
      cursor = page.docs[page.size - 1];
    }
    while (true) {
      const page = await ownedJobs.limit(20).get();
      if (page.empty) break;
      for (const d of page.docs) await this.renderCleanup(uid, d.id, job => {
        if (job?.artifactAttempts.some(a => !(job.removedAttempts || []).includes(a))) throw creditRecords.error('RENDER_CLEANUP_REQUIRED', 'Render artifact cleanup must finish first');
        return { deleteJob: true, result: null };
      }, { deleting: true });
    }
    // Fence is read in every user/project/credit write transaction. No new data
    // can be added after it commits. Small batches are resumable after failure.
    while (true) {
      const page = await this.projects.where('ownerUid', '==', uid).limit(30).get();
      if (page.empty) break;
      for (const d of page.docs) await this.deleteProject(uid, d.id);
    }
    for (const query of [this.users.doc(uid).collection('ledger'), this.users.doc(uid).collection('creditOps'), this.billingCustomers.where('ownerUid', '==', uid), this.projectTombstones.where('ownerUid', '==', uid), this.outbox.where('ownerUid', '==', uid)]) {
      while (true) {
        const page = await query.limit(200).get();
        if (page.empty) break;
        const batch = this.db.batch(); page.docs.forEach(d => batch.delete(d.ref)); await batch.commit();
      }
    }
    await this.users.doc(uid).delete();
  }
  async deleteUser(uid) { await this.beginDeletion(uid); await this.purgeAccountData(uid); }
}

let current = null;
function getStore() {
  if (current) return current;
  if (process.env.ACCOUNTS_STORE === 'memory') return (current = new MemoryStore());
  const { getFirestore } = require('firebase-admin/firestore');
  const { app } = require('./firebase');
  return (current = new FirestoreStore(getFirestore(app())));
}

module.exports = { MemoryStore, FirestoreStore, NoCreditsError, getStore, setStore: (s) => { current = s; } };
