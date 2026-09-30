'use strict';

// Owned photoreal renders (mounted only when render services are configured).
//
//   POST /api/renders                 { requestId, projectId, revision, options }
//        -> 202 { render }            a new job, or the same job for a repeated requestId
//   GET  /api/renders?projectId=      the account's renders, newest first
//   GET  /api/renders/:id             { render, model? } model = { glb, lightmaps, stills, meta } when done
//   GET  /api/renders/:id/files/:name?u&e&d&s   signed, short-lived; no bearer token needed
//
// A job belongs to the account that created it. Status and links need that
// account; a file link is issued only for a name in the job's published
// manifest, and the bytes are re-verified (local) or the generation pinned
// (Cloud Storage) before anything is served.

const express = require('express');
const { requireUser } = require('../lib/accounts/auth');
const { requireFeature } = require('../lib/accounts/entitlements');

const ERRORS = {
  JOB_INVALID: [400, 'The render request is not valid.'],
  UPGRADE_REQUIRED: [402, 'Photoreal houses are part of Pro.'],
  NO_CREDITS: [402, 'You have no photoreal houses left this month.'],
  JOB_PROJECT_NOT_FOUND: [404, 'Save the house before making it photoreal.'],
  PROJECT_CONFLICT: [409, 'The saved house changed. Wait for it to save, then try again.'],
  JOB_CONFLICT: [409, 'This request was already used for a different render. Start a new one.'],
  ACCOUNT_DELETING: [409, 'Account deletion is in progress. New changes are blocked.'],
  ARTIFACT_CHANGED: [409, 'This file changed after it was checked and cannot be served.'],
  ARTIFACT_MISSING: [404, 'This file is no longer available.'],
};
const validId = s => typeof s === 'string' && /^rj_[a-f0-9]{40}$/.test(s);

function rendersRouter({ jobs, artifacts, urls = null, dispatcher = null, forceOptions = null, linkTtlMs = 10 * 60_000, log = console.error }) {
  const router = express.Router();
  const wrap = fn => (req, res) => fn(req, res).catch(e => {
    const known = ERRORS[e.code];
    if (known) return res.status(known[0]).json({ success: false, code: e.code, message: known[1] });
    log('[renders]', req.method, e.code || e.message);
    return res.status(500).json({ success: false, message: 'Something went wrong. Try again.' });
  });
  // One link per published file; Cloud Storage signs its own pinned-generation URL.
  const link = async (uid, published, descriptor, download = false) => (artifacts.url
    ? artifacts.url(published.artifactId, descriptor, { ttlMs: linkTtlMs, download })
    : urls.sign(uid, published.job.id, descriptor.name, { ttlMs: linkTtlMs, download }));
  const model = async (uid, published) => {
    const out = { glb: null, lightmaps: {}, stills: [], files: [], meta: published.viewer };
    for (const f of published.files) {
      const url = await link(uid, published, f);
      if (f.name === 'house.glb') out.glb = url;
      else if (f.name.startsWith('lm_')) out.lightmaps[f.name] = url;
      else out.stills.push({ name: f.name, url });
      out.files.push({ name: f.name, size: f.size, contentType: f.contentType, download: await link(uid, published, f, true) });
    }
    return out;
  };

  router.post('/', requireFeature('photoreal'), wrap(async (req, res) => {
    const { requestId, projectId, revision, options } = req.body || {};
    const opts = forceOptions ? { ...(options || {}), ...forceOptions } : options;
    const render = await jobs.create(req.user.uid, { requestId, projectId, revision, options: opts });
    if (!render) return res.status(404).json({ success: false, message: 'Render not found.' });
    dispatcher?.kick?.();
    res.status(202).json({ success: true, render });
  }));
  router.get('/', requireUser, wrap(async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
    res.json({ success: true, renders: await jobs.list(req.user.uid, { projectId }) });
  }));
  router.get('/:id', requireUser, wrap(async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: 'Render not found.' });
    const render = await jobs.get(req.user.uid, req.params.id);
    if (!render) return res.status(404).json({ success: false, message: 'Render not found.' });
    const published = render.state === 'done' ? await jobs.published(req.user.uid, req.params.id) : null;
    res.json({ success: true, render, ...(published ? { model: await model(req.user.uid, published) } : {}) });
  }));
  router.get('/:id/files/:name', wrap(async (req, res) => {
    const grant = urls && validId(req.params.id) ? urls.verify(req.params.id, req.params.name, req.query) : null;
    if (!grant) return res.status(403).json({ success: false, message: 'This link is not valid or has expired.' });
    const published = await jobs.published(grant.uid, req.params.id);
    const descriptor = published?.files.find(f => f.name === req.params.name);
    if (!descriptor) return res.status(404).json({ success: false, message: 'Render not found.' });
    const bytes = await artifacts.read(published.artifactId, descriptor);
    res.setHeader('Cache-Control', `private, max-age=${Math.max(0, Math.floor((grant.expiresAt - Date.now()) / 1000))}`);
    res.setHeader('Content-Type', descriptor.contentType);
    if (grant.download) res.setHeader('Content-Disposition', `attachment; filename="keystone-${descriptor.name}"`);
    res.send(bytes);
  }));
  return router;
}
module.exports = { rendersRouter };
