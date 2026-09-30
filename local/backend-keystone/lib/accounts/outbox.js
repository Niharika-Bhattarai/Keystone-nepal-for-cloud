'use strict';
// Delivers notification intents that terminal render transitions committed to
// the outbox. Each record is claimed with a short, token-fenced lease. An expired
// sender can overlap its replacement, so retries use the same idempotency key
// (the record id), which the provider must honour. Only the current claimant can
// settle the record. No real provider is configured in this conversion: tests use a fake,
// and actual mail needs an authorized provider and sending domain.
const LEASE_MS = 5 * 60_000, MAX_ATTEMPTS = 6;
const { randomUUID } = require('node:crypto');
const backoff = attempts => Math.min(6 * 60 * 60_000, 60_000 * 2 ** (attempts - 1));

async function deliverOutbox(store, provider, { clock = Date.now, limit = 20 } = {}) {
  if (!provider || typeof provider.send !== 'function') throw new Error('A notification provider is required');
  const results = [];
  for (const record of await store.listOutboxDue(clock(), limit)) {
    const now = clock(), token = randomUUID();
    const claimed = await store.updateOutbox(record.id, (r, context) => {
      if (!r || r.status !== 'pending' || r.nextAt > now || r.lease > now) return null;
      if (context?.deleting) return { ...r, status: 'dropped', lease: null, leaseToken: null };
      if (r.attempts >= MAX_ATTEMPTS) return { ...r, status: 'failed', lease: null, leaseToken: null };
      return { ...r, attempts: r.attempts + 1, lease: now + LEASE_MS, leaseToken: token };
    });
    if (!claimed) continue; // another deliverer holds it, or it changed
    if (claimed.status !== 'pending') { results.push({ id: record.id, status: claimed.status }); continue; }
    const settle = patch => store.updateOutbox(record.id, r => r?.status === 'pending' && r.leaseToken === token ? { ...r, ...patch, lease: null, leaseToken: null } : null);
    const user = await store.getUser(claimed.ownerUid);
    if (!user?.email) { // deleted account or no address: nothing to send
      const applied = await settle({ status: 'dropped' });
      results.push({ id: record.id, status: applied ? 'dropped' : 'stale' }); continue;
    }
    try {
      await provider.send({ idempotencyKey: claimed.id, kind: claimed.kind, to: user.email, name: user.name || '', projectName: claimed.projectName, jobId: claimed.jobId });
      const applied = await settle({ status: 'sent', sentAt: clock() });
      results.push({ id: record.id, status: applied ? 'sent' : 'stale' });
    } catch {
      // Provider error details are not stored: they can contain addresses or keys.
      const attempts = claimed.attempts, status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      const applied = await settle({ status, nextAt: clock() + backoff(attempts) });
      results.push({ id: record.id, status: applied ? status : 'stale' });
    }
  }
  return results;
}
module.exports = { deliverOutbox, OUTBOX_LEASE_MS: LEASE_MS, MAX_ATTEMPTS };
