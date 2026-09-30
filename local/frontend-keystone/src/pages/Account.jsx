import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowSquareOut, PencilSimple, SignOut, Trash, Warning } from '@phosphor-icons/react';
import { useRouteMeta } from '../hooks/useRouteMeta.js';
import { Subpage } from '../site/Subpage.jsx';
import { useSite } from '../site/SiteShell.jsx';
import { useAccount } from '../lib/account.jsx';
import { getCurrentPath } from '../lib/routing.js';
import { clearAccountDraft } from '../lib/storage.js';

/* Account center: Projects, Downloads, Billing, Profile (?tab=). */
const TABS = [['projects', 'Projects'], ['downloads', 'Downloads'], ['billing', 'Billing'], ['profile', 'Profile']];
const REASON = { plan_grant: 'Monthly allowance', purchase: 'Bought', bake_reserve: 'Photoreal house', bake_spend: 'Photoreal house', bake_refund: 'Returned: the bake did not finish', admin: 'Developer key' };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function useTab() {
    const initial = new URLSearchParams(window.location.search).get('tab');
    const [tab, setTab] = useState(TABS.some(([k]) => k === initial) ? initial : 'projects');
    const go = (k) => {
        setTab(k);
        const u = new URL(window.location.href);
        u.searchParams.set('tab', k);
        u.searchParams.delete('checkout');
        window.history.replaceState({}, '', u);
    };
    return [tab, go];
}

// The photoreal allowance as three houses: filled = still to use this month.
const HouseMark = ({ filled }) => (
    <svg className={'acct-house' + (filled ? ' is-full' : '')} viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
        <path d="M3.5 11.2 12 4l8.5 7.2V20a.8.8 0 0 1-.8.8h-4.9v-5.4H9.2v5.4H4.3a.8.8 0 0 1-.8-.8z"/>
    </svg>
);

function Credits({ credits, perMonth = 3 }) {
    const marks = Array.from({ length: perMonth }, (_, i) => i < Math.min(credits.monthly, perMonth));
    return (
        <div className="acct-credits">
            <div className="acct-houses" role="img" aria-label={`${credits.monthly} of ${perMonth} photoreal houses left this month`}>
                {marks.map((f, i) => <HouseMark key={i} filled={f}/>)}
            </div>
            <p><b className="num">{credits.monthly}</b> of {perMonth} photoreal houses left this month{credits.extra > 0 && <>, plus <b className="num">{credits.extra}</b> bought</>}</p>
        </div>
    );
}

function Projects() {
    const acct = useAccount();
    const { openStudio } = useSite();
    const [list, setList] = useState(null);
    const [error, setError] = useState('');
    const [editing, setEditing] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const sequence = useRef(0);
    const mutationBusy = useRef(false);
    useEffect(() => () => { ++sequence.current; }, []);

    const load = useCallback(async () => {
        const request = ++sequence.current;
        setError('');
        try {
            const res = await acct.authFetch('/api/projects');
            const data = await res.json();
            if (!res.ok) throw new Error(data?.message);
            if (request === sequence.current) setList(data.projects);
        } catch (e) { if (request === sequence.current) { setError(e.message || 'Your houses did not load. Check your connection, then try again.'); setList([]); } }
    }, [acct.authFetch]);
    useEffect(() => { load(); }, [load]);

    const mutate = async (p, method, patch = {}) => {
        if (mutationBusy.current) return;
        mutationBusy.current = true;
        const request = sequence.current;
        setError('');
        try {
            const res = await acct.authFetch(`/api/projects/${encodeURIComponent(p.id)}`, {
                method, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...patch, revision: p.revision || 0, mutationId: crypto.randomUUID() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'The house was not updated. Try again.');
            if (request === sequence.current) await load();
        } catch (error) { if (request === sequence.current) setError(error.message || 'Could not reach the server. Refresh and try again.'); }
        finally { mutationBusy.current = false; }
    };
    const rename = async (p, name) => {
        setEditing(null);
        if (!name.trim() || name === p.name) return;
        await mutate(p, 'PUT', { name });
    };
    const remove = async p => { setConfirm(null); await mutate(p, 'DELETE'); };

    if (list === null) return <p className="acct-muted" role="status">Loading your houses…</p>;
    return (
        <>
            {/* On a glass panel: red text straight on the photograph has no guaranteed contrast. */}
            {error && <div className="acct-alert gl" role="alert"><p className="pg-err"><Warning size={15} weight="bold" aria-hidden="true"/>{error}</p><button type="button" className="linkbtn" onClick={load}>Try again</button></div>}
            {!list.length && !error ? (
                <div className="acct-empty gl">
                    <h2>No saved houses yet</h2>
                    <p>Every house you design while signed in is saved here, so you can come back to it, walk through it and change it.</p>
                    <button type="button" className="btn primary" onClick={openStudio}>Design a house</button>
                </div>
            ) : (
                <ul className="acct-projects">
                    {list.map((p) => (
                        <li key={p.id} className="acct-project gl">
                            <a className="acct-sheet" href={`/?project=${encodeURIComponent(p.id)}#generator`} aria-label={`Open ${p.name} in the studio`}>
                                {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy"/> : <span className="acct-sheet-empty">No drawing yet</span>}
                            </a>
                            <div className="acct-project-body">
                                {editing === p.id ? (
                                    <form onSubmit={(e) => { e.preventDefault(); rename(p, e.currentTarget.elements.name.value); }}>
                                        <label className="sr-only" htmlFor={`nm-${p.id}`}>House name</label>
                                        <input id={`nm-${p.id}`} name="name" className="pg-input" defaultValue={p.name} autoFocus onBlur={(e) => rename(p, e.target.value)}/>
                                    </form>
                                ) : <h3>{p.name}</h3>}
                                <p className="acct-muted">{p.summary ? `${p.summary} · ` : ''}Saved {day(p.updatedAt)}</p>
                                {confirm === p.id ? (
                                    <div className="acct-row">
                                        <span>Delete this house?</span>
                                        <button type="button" className="btn glass sm danger" onClick={() => remove(p)}>Delete</button>
                                        <button type="button" className="btn glass sm" onClick={() => setConfirm(null)}>Keep it</button>
                                    </div>
                                ) : (
                                    <div className="acct-row">
                                        <a className="btn primary sm" href={`/?project=${encodeURIComponent(p.id)}#generator`}>Open</a>
                                        <button type="button" className="iconbtn" onClick={() => setEditing(p.id)} aria-label={`Rename ${p.name}`}><PencilSimple size={16} weight="bold" aria-hidden="true"/></button>
                                        <button type="button" className="iconbtn" onClick={() => setConfirm(p.id)} aria-label={`Delete ${p.name}`}><Trash size={16} weight="bold" aria-hidden="true"/></button>
                                    </div>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}

const RENDER_STATE = { queued: 'Waiting for a renderer', running: 'Baking', done: 'Ready', failed: 'Did not finish' };
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
// Lightmaps are part of the model, not separate downloads.
const photoLabel = (name) => (name.startsWith('exterior_') ? 'Exterior' : capital(name.replace(/^interior_/, '').replace(/_(day|golden|dusk)\.jpg$/, '').replace(/_/g, ' ')));

// Photoreal renders the account owns. Links are signed for a few minutes, so
// each download fetches a fresh one at the moment it is used.
function Downloads() {
    const acct = useAccount();
    const { openUpgrade } = useSite();
    const [list, setList] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const alive = useRef(true);
    useEffect(() => () => { alive.current = false; }, []);

    const entitled = acct.features.downloads === true;
    const load = useCallback(async () => {
        setError('');
        // Without Pro there is nothing to list: show what Pro adds, not a failed request.
        if (!entitled) { if (alive.current) setList([]); return; }
        try {
            const res = await acct.authFetch('/api/renders');
            if (res.status === 503 || res.status === 402) { if (alive.current) setList([]); return; } // not switched on here, or not on this plan
            const data = await res.json();
            if (!res.ok) throw new Error(data?.message);
            if (alive.current) setList(data.renders);
        } catch (e) { if (alive.current) { setError(e.message || 'Your downloads did not load. Check your connection, then try again.'); setList([]); } }
    }, [acct.authFetch, entitled]);
    useEffect(() => { load(); }, [load]);
    // Keep unfinished renders current while the tab is open.
    useEffect(() => {
        if (!list?.some(r => r.state === 'queued' || r.state === 'running')) return undefined;
        const timer = setTimeout(load, 8000);
        return () => clearTimeout(timer);
    }, [list, load]);

    const download = async (render, name) => {
        setBusy(`${render.id}:${name}`); setError('');
        try {
            const data = await (await acct.authFetch(`/api/renders/${encodeURIComponent(render.id)}`)).json();
            const file = data.model?.files.find(f => f.name === name);
            if (!file) throw new Error('This file is no longer available.');
            window.location.assign(file.download);
        } catch (e) { setError(e.message || 'The download did not start. Try again; the link is renewed each time.'); }
        finally { if (alive.current) setBusy(''); }
    };

    if (list === null) return <p className="acct-muted" role="status">Loading your downloads…</p>;
    if (!list.length && !error) {
        if (!acct.features.downloads) {
            return (
                <div className="acct-empty gl">
                    <h2>Downloads are part of Pro</h2>
                    <p>Pro adds plan PDFs, DXF for CAD, the cost estimate, the 3D model file, and 3 photoreal houses a month that arrive here when they are ready.</p>
                    <button type="button" className="btn primary" onClick={() => openUpgrade('downloads')}>Upgrade for $49 a month</button>
                </div>
            );
        }
        return (
            <div className="acct-empty gl">
                <h2>Nothing to download yet</h2>
                <p>Open a saved house and choose <b>Make it photoreal</b> in the 3D view. The final bake in testing took about half an hour; the walkthrough, photographs and model file appear here when it is ready.</p>
                <a className="btn primary" href="/account?tab=projects">Choose a house</a>
            </div>
        );
    }
    return (
        <>
            {/* On a glass panel: red text straight on the photograph has no guaranteed contrast. */}
            {error && <div className="acct-alert gl" role="alert"><p className="pg-err"><Warning size={15} weight="bold" aria-hidden="true"/>{error}</p><button type="button" className="linkbtn" onClick={load}>Try again</button></div>}
            <ul className="acct-projects acct-renders">
                {list.map((r) => (
                    <li key={r.id} className="acct-project gl">
                        <div className="acct-project-body">
                            <div className="acct-row">
                                <h3>{r.projectName || 'Saved house'}</h3>
                                <span className={'tag' + (r.state === 'done' ? ' live' : '')}>{RENDER_STATE[r.state] || r.state}</span>
                            </div>
                            <p className="acct-muted">Version {r.projectRevision} · {r.options?.quality === 'preview' ? 'Preview' : 'Final'} quality · {day(new Date(r.createdAt).toISOString())}</p>
                            {(r.state === 'queued' || r.state === 'running') && (
                                <div className="m3d-bar" role="progressbar" aria-label="Photoreal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((r.progress || 0) * 100)}>
                                    <i style={{ transform: `scaleX(${Math.max(0.03, r.progress || 0)})` }}/>
                                </div>
                            )}
                            {r.state === 'failed' && <p className="acct-muted">This photoreal house was returned to your account.</p>}
                            {r.state === 'done' && <RenderFiles render={r} busy={busy} onDownload={download}/>}
                            <a className="linkbtn acct-render-open" href={`/?project=${encodeURIComponent(r.projectId)}#generator`}>Open the house in the studio <ArrowSquareOut size={14} weight="bold" aria-hidden="true"/></a>
                        </div>
                    </li>
                ))}
            </ul>
        </>
    );
}

// File buttons for a finished render; the list comes from its published manifest.
function RenderFiles({ render, busy, onDownload }) {
    const acct = useAccount();
    const [files, setFiles] = useState(null);
    useEffect(() => {
        let alive = true;
        acct.authFetch(`/api/renders/${encodeURIComponent(render.id)}`).then(r => r.json())
            .then(data => { if (alive) setFiles(data.model?.files || []); }).catch(() => { if (alive) setFiles([]); });
        return () => { alive = false; };
    }, [render.id, acct.authFetch]);
    if (!files) return null;
    const model = files.find(f => f.name === 'house.glb');
    const photos = files.filter(f => /^(exterior|interior)_/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    const label = (f, text) => (busy === `${render.id}:${f.name}` ? 'Preparing…' : text);
    return (
        <div className="acct-render-files">
            {model && <button type="button" className="btn primary sm" disabled={busy === `${render.id}:${model.name}`} onClick={() => onDownload(render, model.name)}>{label(model, 'Download 3D model (.glb)')}</button>}
            {photos.length > 0 && (
                <div className="acct-render-photos" role="group" aria-label="Photographs">
                    <span className="acct-muted">Photographs</span>
                    {photos.map(f => (
                        <button key={f.name} type="button" className="btn glass sm" disabled={busy === `${render.id}:${f.name}`} onClick={() => onDownload(render, f.name)}
                            aria-label={`Download ${photoLabel(f.name).toLowerCase()} photograph`}>{label(f, photoLabel(f.name))}</button>
                    ))}
                </div>
            )}
        </div>
    );
}

// Developer key (team testing): Pro without payment while DEV_ACCESS_KEYS is set.
function DevKey() {
    const acct = useAccount();
    const [key, setKey] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const dev = Boolean(acct.plan?.developer);
    const send = async (method) => {
        setBusy(true); setMsg('');
        try {
            const res = await acct.authFetch('/api/me/devkey', { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ key }) : undefined });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setMsg(data.message || 'That did not work.'); setBusy(false); return; }
            setKey('');
            await acct.refresh();
        } catch { setMsg('Could not reach the server.'); }
        setBusy(false);
    };
    return (
        <section className="gl acct-card" aria-labelledby="dev-h">
            <h2 id="dev-h" className="acct-h2">Developer key</h2>
            {dev ? (
                <>
                    <p className="acct-muted">This account has Pro through a developer key, with {acct.plan?.photorealPerMonth || 3} photoreal houses. No payment is taken.</p>
                    <div className="acct-row"><button type="button" className="btn glass sm" disabled={busy} onClick={() => send('DELETE')}>Remove developer access</button></div>
                </>
            ) : (
                <form onSubmit={(e) => { e.preventDefault(); if (key.trim()) send('POST'); }} className="acct-devkey">
                    <p className="acct-muted">For the Keystone AI team: a developer key unlocks Pro on this account without payment.</p>
                    <div className="acct-row">
                        <label className="sr-only" htmlFor="dev-key">Developer key</label>
                        <input id="dev-key" className="pg-input" autoComplete="off" spellCheck="false" placeholder="Developer key" value={key}
                            onChange={(e) => { setKey(e.target.value); setMsg(''); }} aria-invalid={!!msg} aria-describedby={msg ? 'dev-err' : undefined}/>
                        <button type="submit" className="btn primary sm" disabled={busy || !key.trim()}>{busy ? 'Checking' : 'Use key'}</button>
                    </div>
                    {msg && <p id="dev-err" className="pg-err" role="alert"><Warning size={15} weight="bold" aria-hidden="true"/>{msg}</p>}
                </form>
            )}
        </section>
    );
}

function Billing() {
    const acct = useAccount();
    const { openUpgrade } = useSite();
    const [ledger, setLedger] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const checkout = new URLSearchParams(window.location.search).get('checkout');
    useEffect(() => {
        acct.authFetch('/api/me/ledger').then((r) => r.json()).then((d) => setLedger(d.entries || [])).catch(() => {});
        if (checkout === 'success') { const id = setTimeout(acct.refresh, 2500); return () => clearTimeout(id); } // the webhook may land a moment later
        return undefined;
    }, [acct, checkout]);

    const portal = async () => {
        setBusy(true); setError('');
        try {
            const res = await acct.authFetch('/api/billing/portal', { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.url) { window.location.href = data.url; return; }
            setError(data.message || 'Billing did not open. Try again in a moment.');
        } catch { setError('Could not reach the server.'); }
        setBusy(false);
    };
    const pro = acct.tier === 'pro';
    return (
        <div className="acct-billing">
            {checkout === 'success' && !pro && <p className="pg-ok" role="status">Payment received. Your plan switches to Pro in a moment.</p>}
            <section className="acct-plan gl" aria-labelledby="plan-h">
                <header>
                    <h2 id="plan-h">{pro ? 'Pro' : 'Free account'}</h2>
                    <span className={'tag' + (pro ? ' live' : '')}>{acct.plan?.developer ? 'Developer access' : acct.plan?.testing ? 'Free while we test' : pro ? (acct.plan?.cancelAtPeriodEnd ? `Ends ${day(acct.plan.renewsAt)}` : `Renews ${day(acct.plan?.renewsAt)}`) : '$0'}</span>
                </header>
                {acct.plan?.testing ? (
                    <p>Every Pro feature is open to signed-in accounts while we test Keystone AI, until {day(acct.openTesting?.until)}. No payment is taken. Photoreal houses are not part of the test.</p>
                ) : pro ? <Credits credits={acct.credits} perMonth={acct.plan?.photorealPerMonth || 3}/> : (
                    <p>Saved houses and the 3D walkthrough. Pro adds elevations, renders, refinements, the cost estimate, downloads and 3 photoreal houses a month for $49.</p>
                )}
                {error && <p className="pg-err" role="alert"><Warning size={15} weight="bold" aria-hidden="true"/>{error}</p>}
                <div className="acct-row">
                    {acct.plan?.developer || acct.plan?.testing ? null : pro
                        ? <button type="button" className="btn glass" disabled={busy} onClick={portal}><ArrowSquareOut size={16} weight="bold" aria-hidden="true"/>{busy ? 'Opening' : 'Manage payment and invoices'}</button>
                        : <button type="button" className="btn primary" onClick={() => openUpgrade()}>Upgrade for $49 a month</button>}
                </div>
            </section>
            <DevKey/>
            {ledger.length > 0 && (
                <section className="gl acct-card acct-ledger-card" aria-labelledby="led-h">
                    <h2 id="led-h" className="acct-h2">Photoreal history</h2>
                    <table className="acct-ledger">
                        <thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col" className="num">Houses</th></tr></thead>
                        <tbody>
                            {ledger.map((e) => (
                                <tr key={e.id}><td>{day(e.at)}</td><td>{REASON[e.reason] || e.reason}</td><td className="num">{e.delta > 0 ? `+${e.delta}` : e.delta}</td></tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}
        </div>
    );
}

function Profile() {
    const acct = useAccount();
    const [name, setName] = useState(acct.me.user?.name || acct.authUser?.name || '');
    const [optIn, setOptIn] = useState(Boolean(acct.me.user?.marketingOptIn));
    const [saved, setSaved] = useState('');
    const [danger, setDanger] = useState('');
    const [error, setError] = useState('');

    const save = async (e) => {
        e.preventDefault();
        setSaved(''); setError('');
        const res = await acct.authFetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, marketingOptIn: optIn }) });
        if (res.ok) { setSaved('Saved'); acct.refresh(); } else setError('Could not save. Try again.');
    };
    const remove = async () => {
        setError('');
        try {
            const res = await acct.authFetch('/api/me', { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setError(data.message || 'The account was not deleted. Try again; nothing has been removed yet.'); return; }
            if (data.deletion?.state !== 'complete') { await acct.refresh(); setError('Deletion is pending. Retry from the account status screen.'); return; }
            clearAccountDraft(acct.authUser?.uid);
            await acct.signOut();
            window.location.href = '/';
        } catch { setError('Could not confirm deletion. Refresh your account to check its status before retrying.'); }
    };
    const email = acct.me.user?.email || acct.authUser?.email || '';
    return (
        <div className="acct-profile">
            <form className="gl acct-card" onSubmit={save}>
                <div className="pg-field"><label htmlFor="pf-name">Name</label>
                    <input id="pf-name" className="pg-input" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setSaved(''); }}/></div>
                <div className="pg-field"><label htmlFor="pf-email">Email</label>
                    <input id="pf-email" className="pg-input" value={email} readOnly aria-describedby="pf-email-note"/>
                    <p id="pf-email-note" className="acct-muted">Receipts and photoreal notices go here.</p></div>
                <label className="acct-check"><input type="checkbox" checked={optIn} onChange={(e) => { setOptIn(e.target.checked); setSaved(''); }}/>Email me about new features, no more than once a month</label>
                {error && <p className="pg-err" role="alert"><Warning size={15} weight="bold" aria-hidden="true"/>{error}</p>}
                <div className="acct-row"><button type="submit" className="btn primary">Save changes</button>{saved && <span className="pg-ok" role="status">{saved}</span>}</div>
            </form>
            <section className="gl acct-card" aria-labelledby="del-h">
                <h2 id="del-h" className="acct-h2">Delete account</h2>
                <p className="acct-muted">Deletes your saved houses, photoreal models and account for good. Cancel Pro in Billing first.</p>
                <div className="pg-field"><label htmlFor="pf-del">Type DELETE to confirm</label>
                    <input id="pf-del" className="pg-input" value={danger} onChange={(e) => setDanger(e.target.value)} autoComplete="off"/></div>
                <div className="acct-row"><button type="button" className="btn glass danger" disabled={danger !== 'DELETE'} onClick={remove}><Trash size={16} weight="bold" aria-hidden="true"/>Delete my account</button></div>
            </section>
        </div>
    );
}

function DeletionStatus() {
    const acct = useAccount();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const complete = acct.me.deletion?.state === 'complete';
    const finish = async () => {
        setBusy(true); setError('');
        try {
            if (!complete) {
                const res = await acct.authFetch('/api/me', { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Deletion could not be resumed.');
                if (data.deletion?.state !== 'complete') { await acct.refresh(); setError('Deletion is still pending. Try again shortly.'); return; }
            }
            clearAccountDraft(acct.authUser?.uid);
            await acct.signOut(); window.location.href = '/';
        } catch (e) { setError(e.message || 'Deletion did not finish. Try again to complete it.'); }
        finally { setBusy(false); }
    };
    return <div className="pg-wrap acct"><section className="pg-head gl">
        <h1 className="h-page">{complete ? 'Account deleted' : 'Account deletion pending'}</h1>
        <p>{complete ? 'Your account data has been removed.' : 'New saves are blocked while we finish removing your account. You can retry safely.'}</p>
        {error && <p className="pg-err" role="alert">{error}</p>}
        <button className="btn primary" type="button" disabled={busy} onClick={finish}>{busy ? 'Checking deletion...' : complete ? 'Finish and sign out' : 'Retry account deletion'}</button>
    </section></div>;
}

const AccountContent = () => {
    const acct = useAccount();
    const { openAccount } = useSite();
    const [tab, setTab] = useTab();
    const wantsSignIn = getCurrentPath() === '/signin';
    useEffect(() => { acct.refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- credits change elsewhere

    useEffect(() => {
        if (acct.ready && !acct.signedIn && wantsSignIn) openAccount('signin');
        if (acct.ready && acct.signedIn && wantsSignIn) window.history.replaceState({}, '', '/account');
    }, [acct.ready, acct.signedIn, wantsSignIn, openAccount]);

    const onTabKey = (e) => {
        const keys = TABS.map(([k]) => k);
        const at = keys.indexOf(tab);
        const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: keys.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        const k = keys[(next + keys.length) % keys.length];
        setTab(k);
        document.getElementById(`tab-${k}`)?.focus();
    };
    const who = useMemo(() => acct.me.user?.name || acct.authUser?.name || acct.authUser?.email || '', [acct.me, acct.authUser]);

    if (!acct.ready) return <div className="pg-wrap acct"><p className="acct-muted" role="status">Loading local projects…</p></div>;
    if (acct.localStudio) return <div className="pg-wrap acct">
        <header className="pg-head gl pg-enter acct-head"><div><h1 className="h-page">Local projects</h1>
            <p className="acct-muted">No sign-in. Saved projects are held in the local backend memory and reset when it restarts.</p></div></header>
        <Projects key="nepal_local"/>
    </div>;
    if (acct.me.deletion) return <DeletionStatus/>;
    if (!acct.signedIn) {
        return (
            <div className="pg-wrap acct">
                <div className="pg-head gl pg-enter" style={{ '--i': 0 }}>
                    <h1 className="h-page">Your account</h1>
                    <p className="lead">Sign in to see your saved houses, photoreal models and billing.</p>
                    <div className="pg-actions">
                        <button type="button" className="btn primary" onClick={() => openAccount('signin')}>Sign in</button>
                        <button type="button" className="btn glass" onClick={() => openAccount('signup')}>Create a free account</button>
                    </div>
                </div>
            </div>
        );
    }
    return (
        <div className="pg-wrap acct">
            <header className="pg-head gl pg-enter acct-head" style={{ '--i': 0 }}>
                <div>
                    <h1 className="h-page">{who ? `Hello, ${who.split(/[ @]/)[0]}` : 'Your account'}</h1>
                    <p className="acct-muted">{acct.me.user?.email} · {acct.tier === 'pro' ? 'Pro' : 'Free account'}</p>
                </div>
                <button type="button" className="btn glass sm" onClick={() => acct.signOut().then(() => { window.location.href = '/'; })}><SignOut size={16} weight="bold" aria-hidden="true"/>Sign out</button>
            </header>
            {/* Tabs (WAI-ARIA pattern): one stop in the Tab order; the arrow keys,
                Home and End choose a section (C7 keyboard journey). */}
            <nav className="pg-seg acct-tabs" role="tablist" aria-label="Account sections" onKeyDown={onTabKey}>
                {TABS.map(([k, label]) => (
                    <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`}
                        tabIndex={tab === k ? 0 : -1} onClick={() => setTab(k)}>{label}</button>
                ))}
            </nav>
            <section id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="acct-panel">
                {tab === 'projects' && <Projects key={acct.authUser?.uid}/>}
                {tab === 'downloads' && <Downloads/>}
                {tab === 'billing' && <Billing/>}
                {tab === 'profile' && <Profile/>}
            </section>
        </div>
    );
};

export const AccountPage = () => {
    useRouteMeta('/account');
    return <Subpage><AccountContent/></Subpage>;
};
