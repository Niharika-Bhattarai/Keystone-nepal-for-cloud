'use strict';
const crypto = require('node:crypto');
const MAX_PROJECT_BYTES = 2_000_000;
const CHUNK_BYTES = 180_000;
const fields = ['name', 'summary', 'thumbnail', 'survey', 'planSpec', 'svg', 'studioState'];
const error = (code, message) => Object.assign(new Error(message), { code });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const projectId = (uid, mutationId) => hash(JSON.stringify([uid, mutationId])).slice(0, 40);
const revisionOf = p => p?.revision || 0;

function applyProject(previous, uid, id, patch, { expectedRevision = 0, mutationId } = {}) {
  if (previous && previous.ownerUid !== uid) return null;
  const data = Object.fromEntries(fields.filter(k => patch[k] !== undefined).map(k => [k, patch[k]]));
  const digest = hash(JSON.stringify(data));
  if (previous?.lastMutation?.id === mutationId && mutationId) {
    if (previous.lastMutation.digest !== digest) throw error('PROJECT_CONFLICT', 'This save identifier was already used for different changes.');
    return structuredClone(previous);
  }
  if (revisionOf(previous) !== expectedRevision) throw error('PROJECT_CONFLICT', 'This house changed in another tab. Reopen the saved version or save your changes as a copy.');
  const timestamp = new Date().toISOString();
  const result = { ...(previous || {}), ...structuredClone(data), schemaVersion: 2,
    id, ownerUid: uid, revision: revisionOf(previous) + 1,
    createdAt: previous?.createdAt || timestamp, updatedAt: timestamp,
    lastMutation: { id: mutationId || crypto.randomUUID(), digest } };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_PROJECT_BYTES) throw error('PROJECT_TOO_LARGE', 'This house exceeds the 2 MB project limit. Your local draft has been kept.');
  return result;
}

function summary(project) {
  return Object.fromEntries(['id', 'ownerUid', 'schemaVersion', 'revision', 'name', 'summary', 'thumbnail', 'createdAt', 'updatedAt']
    .filter(k => project[k] !== undefined).map(k => [k, structuredClone(project[k])]));
}

// Current snapshot only. Metadata and every chunk commit atomically. No partial
// upload state or old chunks survive a successful save/delete. Future HQ jobs
// must own an immutable input snapshot; these are not a revision-history API.
function encode(project) {
  const bytes = Buffer.from(JSON.stringify(project));
  if (bytes.length > MAX_PROJECT_BYTES) throw error('PROJECT_TOO_LARGE', 'This house exceeds the 2 MB project limit.');
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) chunks.push(bytes.subarray(offset, offset + CHUNK_BYTES).toString('base64'));
  return { metadata: { ...summary(project), payload: { version: 1, count: chunks.length, bytes: bytes.length, sha256: hash(bytes) } }, chunks };
}

function decode(metadata, chunks) {
  if (!metadata.payload) return { ...metadata, revision: revisionOf(metadata) }; // legacy inline record
  const p = metadata.payload;
  if (p.version !== 1 || !Number.isInteger(p.count) || p.count < 1 || p.count > Math.ceil(MAX_PROJECT_BYTES / CHUNK_BYTES) || chunks.length !== p.count || chunks.some(c => typeof c !== 'string')) throw error('PROJECT_CORRUPT', 'The saved house could not be read. Please retry.');
  const bytes = Buffer.concat(chunks.map(c => Buffer.from(c, 'base64')));
  if (bytes.length !== p.bytes || bytes.length > MAX_PROJECT_BYTES || hash(bytes) !== p.sha256) throw error('PROJECT_CORRUPT', 'The saved house is incomplete. Please retry.');
  const result = JSON.parse(bytes.toString('utf8'));
  if (result.ownerUid !== metadata.ownerUid || result.id !== metadata.id || result.revision !== metadata.revision) throw error('PROJECT_CORRUPT', 'The saved house metadata does not match.');
  return result;
}
module.exports = { MAX_PROJECT_BYTES, CHUNK_BYTES, applyProject, projectId, revisionOf, summary, encode, decode, error };
