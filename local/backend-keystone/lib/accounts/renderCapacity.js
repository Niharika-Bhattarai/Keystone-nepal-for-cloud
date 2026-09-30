'use strict';
// A bounded shared admission record, committed with every job state change.
// Launch reservations count before a worker claims; live claims renew their slot.
const MAX_SLOTS = 128;
function active(state, now) {
  return Object.fromEntries(Object.entries(state?.slots || {}).filter(([, s]) => s.until > now));
}
function update(slots, job) {
  const next = { ...slots };
  const until = Math.max(job.lease?.until || 0, job.dispatch?.until || 0);
  if (['running', 'queued'].includes(job.state) && until) next[job.id] = { ownerUid: job.ownerUid, until };
  else delete next[job.id];
  if (Object.keys(next).length > MAX_SLOTS) throw Object.assign(new Error('Render capacity is full'), { code: 'RENDER_CAPACITY_FULL' });
  return { slots: next };
}
function remove(state, id) {
  const slots = { ...state?.slots };
  delete slots[id];
  return { slots };
}
module.exports = { active, update, remove, MAX_SLOTS };
