// Per-tab, per-owner journal survives reload. Storage must succeed before a
// network mutation is sent, otherwise its outcome could not be recovered.
export const saveJournalKey = owner => `keystone:save-journal:v1:${encodeURIComponent(owner || 'anonymous')}`;
export function readSaveJournal(owner, storage = globalThis.sessionStorage) {
  const raw = storage.getItem(saveJournalKey(owner));
  if (!raw) return null;
  const record = JSON.parse(raw);
  if (record.version !== 1 || record.owner !== owner || !['pending', 'complete'].includes(record.state) ||
      typeof record.request?.body !== 'string' || typeof record.request?.serialized !== 'string') throw new Error('The saved recovery record could not be read. Keep this tab open and save a new copy.');
  return record;
}
export function writeSaveJournal(owner, state, request, project = null, storage = globalThis.sessionStorage) {
  storage.setItem(saveJournalKey(owner), JSON.stringify({ version: 1, owner, state, request, project }));
}
export function clearSaveJournal(owner, storage = globalThis.sessionStorage) { storage.removeItem(saveJournalKey(owner)); }
