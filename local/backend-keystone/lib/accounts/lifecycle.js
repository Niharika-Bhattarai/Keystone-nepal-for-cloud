'use strict';
const { error } = require('./projectRecords');
function assertActive(deletion) {
  if (deletion) throw error('ACCOUNT_DELETING', 'Account deletion is in progress. New changes are blocked.');
}
function assertDeletable(user) {
  if (['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'].includes(user?.subscription?.status)) {
    throw error('CANCEL_PLAN_FIRST', 'Cancel your plan in Billing before deleting the account.');
  }
}
async function deleteIdentity(uid) {
  if (process.env.ACCOUNTS_AUTH === 'insecure-dev' && !process.env.K_SERVICE && process.env.NODE_ENV !== 'production') return;
  const { getAuth } = require('firebase-admin/auth');
  try { await getAuth(require('./firebase').app()).deleteUser(uid); }
  catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
}

// Idempotent phases. The durable deletion fence survives identity removal and
// restarts. A worker can resume by UID even after the old ID token is invalid.
// `cleanupRenders` removes render output once it is quiet (RenderJobs.cleanupOwner);
// until it succeeds the account data and identity stay in place.
async function resumeDeletion(store, uid, removeIdentity = deleteIdentity, cleanupRenders = null) {
  const job = await store.getDeletion(uid);
  if (!job || job.state === 'complete') return job;
  try {
    if (cleanupRenders) await cleanupRenders(uid);
    await store.purgeAccountData(uid);
    await store.setDeletionState(uid, 'identity_pending');
    await removeIdentity(uid);
    return await store.setDeletionState(uid, 'complete');
  } catch {
    // Store no provider error details or personal information in the tombstone.
    return await store.setDeletionState(uid, 'pending', 'RETRY_REQUIRED');
  }
}
module.exports = { assertActive, assertDeletable, resumeDeletion };
