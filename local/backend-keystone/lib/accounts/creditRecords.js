'use strict';
// Pure transitions. Stores commit the balance, immutable ledger and operation
// receipts together. Mutable reservation status lives outside the ledger.
const crypto = require('node:crypto');
const key = (...parts) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const error = (code, message) => Object.assign(new Error(message), { code });
class NoCreditsError extends Error {
  constructor() { super('No photoreal credits left'); this.code = 'NO_CREDITS'; }
}
function balances(user) {
  const credits = { monthly: user.credits?.monthly ?? 0, extra: user.credits?.extra ?? 0 };
  if (Object.values(credits).some(n => !Number.isSafeInteger(n) || n < 0)) throw error('CREDIT_CORRUPT', 'Invalid credit balance');
  return credits;
}
function request(op, reason, ref) {
  if (!['reserve', 'reset_monthly', 'grant_extra'].includes(op?.kind)) throw error('CREDIT_INVALID', 'Unsupported credit operation');
  if (op.kind !== 'reserve' && (!Number.isSafeInteger(op.amount) || op.amount < 0)) throw error('CREDIT_INVALID', 'Credit amount must be a nonnegative integer');
  if ((op.kind !== 'grant_extra' || ref != null) && (typeof ref !== 'string' || !ref.length || ref.length > 500)) throw error('CREDIT_INVALID', 'A stable operation reference is required');
  const period = op.kind === 'reset_monthly' ? { id: op.period?.id || ref, start: op.period?.start ?? null, end: op.period?.end ?? null, source: op.period?.source || 'internal' } : null;
  if (period && (typeof period.id !== 'string' || !period.id || period.id.length > 500 ||
    ((period.start !== null || period.end !== null) && (!Number.isSafeInteger(period.start) || !Number.isSafeInteger(period.end) || period.start < 0 || period.end <= period.start)))) throw error('CREDIT_INVALID', 'Invalid allowance period');
  const id = key(op.kind, ref ?? crypto.randomUUID());
  const periodKey = period ? key('period', period.id) : null;
  const fingerprint = key(op.kind, op.amount ?? null, period, reason, ref);
  return { op, reason, ref: ref ?? null, period, id, periodKey, fingerprint, keys: [id, ...(periodKey ? [periodKey] : [])] };
}
function credit(user, records, r, at = new Date().toISOString()) {
  const credits = balances(user), previous = records[r.id];
  if (previous) {
    if (previous.fingerprint !== r.fingerprint) throw error('CREDIT_CONFLICT', 'This reference was already used for a different operation');
    return { result: { entry: previous.entry, credits, state: previous.state, duplicate: true } };
  }
  let bucket, delta, allowance = user.allowance || null, skipped = false;
  if (r.op.kind === 'reserve') {
    // Do not spend expired monthly credit merely because its renewal event is late.
    const current = !allowance?.end || allowance.end * 1000 > Date.parse(at);
    bucket = current && credits.monthly > 0 ? 'monthly' : credits.extra > 0 ? 'extra' : null;
    if (!bucket) throw new NoCreditsError();
    delta = -1; credits[bucket]--;
  } else if (r.op.kind === 'grant_extra') {
    bucket = 'extra'; delta = r.op.amount; credits.extra += delta;
  } else {
    bucket = 'monthly';
    // A second invoice for the same period cannot refill spent credits. Old
    // invoices cannot replace a newer allowance. Developer keys cannot reset
    // an active paid allowance.
    skipped = Boolean(records[r.periodKey] ||
      (allowance?.start != null && (r.period.start == null || r.period.start < allowance.start)) ||
      (allowance?.source === 'stripe' && r.period.source === 'developer' && allowance.end * 1000 > Date.parse(at)));
    delta = skipped ? 0 : r.op.amount - credits.monthly;
    if (!skipped) { credits.monthly = r.op.amount; allowance = r.period; }
  }
  if (!Number.isSafeInteger(credits.extra)) throw error('CREDIT_INVALID', 'Credit balance overflow');
  const state = r.op.kind === 'reserve' ? 'reserved' : 'final';
  const entry = { id: r.id, delta, bucket, reason: r.reason, ref: r.ref, at, state,
    period: bucket === 'monthly' ? (r.period || allowance) : null, skipped };
  const changes = { [r.id]: { fingerprint: r.fingerprint, entry, state } };
  if (r.periodKey && !records[r.periodKey]) changes[r.periodKey] = { entryId: entry.id };
  return { patch: { credits, allowance }, entries: [entry], records: changes, result: { entry, credits, state, duplicate: false } };
}
function settle(user, records, entryId, outcome, at = new Date().toISOString()) {
  if (!['spent', 'refunded'].includes(outcome)) throw error('CREDIT_INVALID', 'Invalid reservation outcome');
  const reservation = records[entryId];
  if (!reservation || reservation.state !== 'reserved') return { result: null };
  const original = reservation.entry, credits = balances(user);
  const samePeriod = original.period?.id === user.allowance?.id;
  const unexpired = !original.period?.end || original.period.end * 1000 > Date.parse(at);
  const bucket = original.bucket === 'monthly' && samePeriod && unexpired ? 'monthly' : 'extra';
  const delta = outcome === 'refunded' ? 1 : 0;
  if (delta) credits[bucket]++;
  if (!Number.isSafeInteger(credits[bucket])) throw error('CREDIT_INVALID', 'Credit balance overflow');
  const entry = { id: key('settlement', entryId), delta, bucket: delta ? bucket : original.bucket,
    reason: delta ? 'bake_refund' : 'bake_spend', ref: entryId, at, state: 'final',
    originalPeriod: original.period || null, outcome };
  return { patch: { credits }, entries: [entry], records: { [entryId]: { ...reservation, state: outcome } }, result: { entry, credits } };
}
module.exports = { request, credit, settle, balances, key, error, NoCreditsError };
