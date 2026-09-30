import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '../lib/account.jsx';
import { beginRenderRequest, pendingRenderRequest, settleRenderRequest } from '../lib/renderRequests.js';

const ModelViewer = lazy(() => import('../site/ModelViewer.jsx'));
const HqViewer = lazy(() => import('../site/HqViewer.jsx'));

/* The studio's 3D view.

   Instant model: POST /api/plan/model returns a GLB in milliseconds and the
   Babylon viewer shows it straight away. Authentication and server errors
   stay visible with a retry; they do not trigger a silent substitute model.

   Photoreal model: an owned render of the saved house (POST /api/renders).
   It needs a saved revision, because the server bakes a frozen copy of it.
   The request ID is stored before the request is sent, so a lost response or
   a reload resends the same ID and never charges twice. On load the studio
   reattaches to this house's latest render, so a bake started on another
   device, or before a reload, keeps showing. Settlement happens on the
   server; closing the page never loses or double-spends a credit. */

const POLL_MS = 5000;
const OPTIONS = { quality: 'final', sky: 'day', stills: true };
const FAILURE = 'The photoreal model could not be built. Your photoreal house was returned to your account.';

export default function Model3D({ planSpec, project = null, requireAccess, watermark = false }) {
  const [instant, setInstant] = useState({ status: 'loading', glb: null });
  const [hq, setHq] = useState({ state: 'idle' });
  const [view, setView] = useState('instant');
  const [photo, setPhoto] = useState(null);
  const poll = useRef(null);
  const acct = useAccount();
  const owner = acct.authUser?.uid || null;
  const canRender = acct.features.photoreal === true;
  // The server says photoreal is paused (its GPU is not available yet): show that
  // plainly instead of a button that would only be refused.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/health').then((r) => r.json()).then((h) => { if (alive) setPaused(h?.photoreal === 'paused' || (acct.localStudio && h?.photoreal === 'off')); }).catch(() => {});
    return () => { alive = false; };
  }, [acct.localStudio]);

  const epoch = useRef(0);
  const controller = useRef(null);
  const starting = useRef(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const current = ++epoch.current;
    const abort = new AbortController();
    controller.current = abort;
    starting.current = false;
    setInstant({ status: 'loading', glb: null });
    setView('instant');
    setPhoto(null);
    if (planSpec) acct.authFetch('/api/plan/model', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planSpec }), signal: abort.signal,
    }).then(async res => {
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'The 3D model could not be loaded. Try again.');
      }
      if (!String(res.headers.get('content-type') || '').includes('gltf')) throw new Error('The server did not return a 3D model.');
      const glb = await res.arrayBuffer();
      if (current === epoch.current) setInstant({ status: 'ready', glb });
    }).catch(error => {
      if (current === epoch.current && !abort.signal.aborted) setInstant({ status: 'error', glb: null, error: error.message });
    });
    return () => { ++epoch.current; abort.abort(); };
  }, [planSpec, acct.authUser?.uid, acct.authFetch, retry]);

  // Photoreal state follows the saved house and the signed-in account, not the draft.
  const hqEpoch = useRef(0);
  const follow = useCallback((id, current) => {
    clearTimeout(poll.current);
    poll.current = setTimeout(async () => {
      if (current !== hqEpoch.current) return;
      try {
        const res = await acct.authFetch(`/api/renders/${encodeURIComponent(id)}`);
        const data = await res.json();
        if (current !== hqEpoch.current) return;
        if (!res.ok) throw new Error(data?.message || 'Could not check the photoreal model just now. It keeps baking; this page checks again shortly.');
        show(data, current);
      } catch (error) {
        // A failed check is not a failed render: keep following, more slowly.
        if (current === hqEpoch.current) { setHq(h => ({ ...h, notice: 'Checking again shortly…' })); follow(id, current); }
      }
    }, POLL_MS);
  }, [acct.authFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = (data, current) => {
    const render = data.render;
    // A render that finishes while it is being watched opens in the photoreal viewer.
    if (render.state === 'done' && data.model) { setHq({ state: 'done', render, model: data.model }); setView('hq'); acct.refresh(); }
    else if (render.state === 'failed') { setHq({ state: 'failed', render, error: FAILURE }); acct.refresh(); }
    else { setHq({ state: render.state, render }); follow(render.id, current); }
  };

  const send = useCallback(async (record, current) => {
    setHq({ state: 'starting' });
    try {
      const res = await acct.authFetch('/api/renders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: record.requestId, projectId: project.id, revision: record.revision, options: record.options }),
      });
      const data = await res.json().catch(() => null);
      if (current !== hqEpoch.current) return;
      if (!res.ok) {
        // The server answered: nothing was created, so this request is finished.
        settleRenderRequest(owner, project.id, record.requestId);
        setHq({ state: 'idle', error: data?.message || 'The photoreal model could not be started.' });
        return;
      }
      settleRenderRequest(owner, project.id, record.requestId);
      acct.refresh();
      show({ render: data.render }, current);
    } catch {
      // Outcome unknown: keep the stored request so Try again cannot charge twice.
      if (current === hqEpoch.current) setHq({ state: 'uncertain', error: 'We could not confirm the start. Check your connection and try again; you will not be charged twice.' });
    }
  }, [acct.authFetch, owner, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const current = ++hqEpoch.current;
    clearTimeout(poll.current);
    setHq({ state: 'idle' });
    // Accounts without photoreal have no renders to find; do not ask (the API answers 402).
    if (!owner || !project?.id || !canRender) return undefined;
    (async () => {
      try {
        const res = await acct.authFetch(`/api/renders?projectId=${encodeURIComponent(project.id)}`);
        if (res.status === 503 || res.status === 402) return; // photoreal not enabled here, or not on this plan
        const data = await res.json();
        if (current !== hqEpoch.current || !res.ok) return;
        const pending = pendingRenderRequest(owner, project.id);
        const latest = data.renders?.[0];
        if (pending && (!latest || latest.createdAt < pending.createdAt)) return send(pending, current); // a start whose answer was lost
        if (!latest) return;
        if (latest.state === 'done') {
          const detail = await (await acct.authFetch(`/api/renders/${encodeURIComponent(latest.id)}`)).json();
          if (current === hqEpoch.current && detail.model) setHq({ state: 'done', render: detail.render, model: detail.model });
        } else if (latest.state === 'failed') setHq({ state: 'failed', render: latest, error: FAILURE });
        else { setHq({ state: latest.state, render: latest }); follow(latest.id, current); }
      } catch { /* the quick model still works; photoreal can be started again */ }
    })();
    return () => { ++hqEpoch.current; clearTimeout(poll.current); };
  }, [owner, project?.id, canRender, acct.authFetch, follow, send]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (starting.current || !planSpec) return;
    if (requireAccess && !requireAccess('the photoreal 3D model')) return;
    if (!project?.id || !project.saved) return;
    starting.current = true;
    try {
      let record;
      try { record = beginRenderRequest(owner, project.id, project.revision, OPTIONS); }
      catch { setHq({ state: 'idle', error: 'This browser could not record the request safely. Free some browser storage and try again.' }); return; }
      await send(record, hqEpoch.current);
    } finally { starting.current = false; }
  };

  // Links expire after a few minutes: fetch fresh ones before opening a photograph.
  const openPhoto = async (still) => {
    try {
      const data = await (await acct.authFetch(`/api/renders/${encodeURIComponent(hq.render.id)}`)).json();
      const fresh = data.model?.stills.find(s => s.name === still.name);
      if (fresh) { setHq(h => ({ ...h, model: data.model })); setPhoto(fresh); return; }
    } catch { /* fall back to the current link */ }
    setPhoto(still);
  };

  const hqReady = hq.state === 'done' && hq.model?.glb;
  const pct = Math.round((hq.render?.progress || 0) * 100);
  const version = hq.render ? `Saved version ${hq.render.projectRevision}${project?.revision && hq.render.projectRevision !== project.revision ? ' (an earlier version of this house)' : ''}` : '';
  const waitingToSave = project?.id && !project.saved;

  let body;
  if (view === 'hq' && hqReady) {
    body = <Suspense fallback={<p className="studio-empty-note" style={{ padding: 24 }}>Loading the photoreal viewer…</p>}><HqViewer manifest={hq.model}/></Suspense>;
  } else if (instant.status === 'loading') {
    body = <p className="studio-empty-note" style={{ padding: 24 }} role="status">Building the 3D model…</p>;
  } else if (instant.status === 'ready') {
    body = <Suspense fallback={<p className="studio-empty-note" style={{ padding: 24 }}>Loading the 3D viewer…</p>}><ModelViewer glb={instant.glb} label="3D model of the generated plan" allowDownloads={acct.features.downloads === true}/></Suspense>;
  } else {
    body = <div className="studio-empty-note" style={{ padding: 24 }}>
      <p role="alert">{instant.error || 'The 3D model is unavailable.'}</p>
      <button type="button" className="studio-btn studio-btn-primary" onClick={() => setRetry(n => n + 1)}>Retry 3D</button>
    </div>;
  }

  return (
    <div className="m3d">
      <div className="m3d-stage">{body}{watermark && view !== 'hq' && <span className="m3d-watermark" aria-hidden="true">Keystone AI · Free</span>}</div>
      <div className="m3d-rail">
        {hqReady ? (
          <>
            <div className="studio-seg" role="group" aria-label="Model">
              <button type="button" aria-pressed={view === 'hq'} onClick={() => setView('hq')}>Photoreal</button>
              <button type="button" aria-pressed={view === 'instant'} onClick={() => setView('instant')}>Quick model</button>
            </div>
            {hq.model.stills?.length > 0 && (
              <ul className="m3d-photos" aria-label="Photographs of the house">
                {hq.model.stills.map((s) => (
                  <li key={s.name}>
                    <button type="button" onClick={() => openPhoto(s)} aria-label={`Open ${stillLabel(s.name)}`}>
                      <img src={s.url} alt={stillLabel(s.name)} loading="lazy"/>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="m3d-note">{version}. Plants, rugs, art, planting and paving are styling, not part of the plan. Files are in Account, Downloads.</p>
          </>
        ) : hq.state === 'queued' || hq.state === 'running' || hq.state === 'starting' ? (
          <div className="m3d-progress" role="status" aria-live="polite">
            <p><b>Making it photoreal</b> <span>{hq.state === 'running' ? 'Baking' : hq.state === 'starting' ? 'Starting' : 'Waiting for a renderer'}</span></p>
            <div className="m3d-bar"><i style={{ transform: `scaleX(${Math.max(0.03, hq.render?.progress || 0)})` }}/></div>
            <p className="m3d-note">{pct}%{version ? ` · ${version}` : ''}. Real materials, furniture and every light on. You can close this page; it keeps going and appears in Account, Downloads. The final bake in testing took about half an hour.{hq.notice ? ` ${hq.notice}` : ''}</p>
          </div>
        ) : paused ? (
          <div className="m3d-cta">
            <p><b>Photoreal model</b> Coming soon: real materials, furniture and lighting, baked on our servers. The 3D model above is yours to explore in the meantime.</p>
          </div>
        ) : (
          <div className="m3d-cta">
            <p><b>Photoreal model</b> Real materials, furniture and lighting, plus a set of photographs of the saved house. The final bake in testing took about half an hour.</p>
            {(hq.state === 'failed' || hq.error) && <p className="m3d-error" role="alert">{hq.error || FAILURE}</p>}
            {canRender && owner && !project?.id && <p className="m3d-note">Save the house to make it photoreal.</p>}
            {waitingToSave && <p className="m3d-note" role="status">Waiting for the house to save…</p>}
            <button type="button" className="studio-btn studio-btn-primary" onClick={start} disabled={!planSpec || (canRender && (!project?.id || waitingToSave))}>
              {hq.state === 'uncertain' || hq.state === 'failed' ? 'Try again' : 'Make it photoreal'}
            </button>
          </div>
        )}
      </div>
      {photo && (
        <div className="m3d-lightbox" role="dialog" aria-modal="true" aria-label={stillLabel(photo.name)} onClick={() => setPhoto(null)}>
          <img src={photo.url} alt={stillLabel(photo.name)}/>
          <button type="button" className="studio-btn studio-btn-quiet" onClick={() => setPhoto(null)}>Close</button>
        </div>
      )}
    </div>
  );
}

function stillLabel(name) {
  const m = /^(exterior|interior)_(?:(.+)_)?(day|golden|dusk)\.jpg$/.exec(name || '');
  if (!m) return 'Photograph';
  if (m[1] === 'exterior') return 'Exterior photograph';
  return `${(m[2] || 'room').replace(/_/g, ' ')} photograph`;
}
