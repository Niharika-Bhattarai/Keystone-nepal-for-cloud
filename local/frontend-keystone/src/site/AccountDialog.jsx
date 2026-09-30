import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, EnvelopeSimple, GoogleLogo, Warning, X } from '@phosphor-icons/react';
import { authMessage, FEATURE_LABEL, FREE_FEATURES, useAccount } from '../lib/account.jsx';

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

/* Sign in, create a free account, or get an email link. Opened from the nav,
   the pricing page and any locked studio feature (then `reason` says what
   the visitor was trying to do). */
export function AccountDialog({ open, mode: initialMode = 'signin', reason = null, onClose }) {
    const acct = useAccount();
    const [mode, setMode] = useState(initialMode); // signin | signup | link | reset
    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const [sent, setSent] = useState('');
    const panelRef = useRef(null);
    const returnRef = useRef(null);

    /* The dialog stays mounted between openings. Reset it while rendering the
       opening frame, not in an effect: an effect lets one frame show the
       previous mode, and switching Sign in -> Create account then inserts the
       name field above the email field, so early typing lands in the wrong box. */
    const [shownFor, setShownFor] = useState(null);
    const opening = open ? initialMode : null;
    if (opening !== shownFor) {
        setShownFor(opening);
        if (open) { setMode(initialMode); setError(''); setSent(''); setBusy(''); }
    }

    useEffect(() => {
        if (!open) return undefined;
        returnRef.current = document.activeElement;
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
            if (e.key !== 'Tab' || !panelRef.current) return;
            const f = [...panelRef.current.querySelectorAll('button, input, a[href]')].filter((el) => !el.disabled && el.offsetParent !== null);
            if (!f.length) return;
            if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
            else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            if (returnRef.current && document.contains(returnRef.current)) returnRef.current.focus();
        };
    }, [open, initialMode, onClose]);

    // close once signed in
    useEffect(() => { if (open && acct.signedIn && !sent) onClose(); }, [open, acct.signedIn, sent, onClose]);

    useEffect(() => {
        if (!open) return undefined;
        const id = requestAnimationFrame(() => panelRef.current?.querySelector('input, [data-autofocus]')?.focus());
        return () => cancelAnimationFrame(id);
    }, [open, mode, sent]);

    if (!open) return null;

    const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setError(''); };
    const run = async (label, fn) => {
        setBusy(label); setError('');
        try { await fn(); } catch (e) { setError(authMessage(e)); }
        setBusy('');
    };

    const submit = (e) => {
        e.preventDefault();
        const email = form.email.trim();
        if (!isEmail(email)) { setError('Enter a full email address, like jane@email.com.'); return; }
        if (mode === 'link') return run('link', async () => { await acct.sendSignInLink(email); setSent(`We sent a sign-in link to ${email}. Open it on this device to finish.`); });
        if (mode === 'reset') return run('reset', async () => { await acct.resetPassword(email); setSent(`If there is an account for ${email}, a password reset email is on its way.`); });
        if (!acct.devAuth && form.password.length < 8) { setError('Use at least 8 characters for the password.'); return; }
        if (mode === 'signup') return run('signup', () => acct.signUp(email, form.password, form.name.trim()));
        return run('signin', () => acct.signIn(email, form.password));
    };

    const what = reason ? FEATURE_LABEL[reason] || reason : null;
    const title = { signin: 'Sign in', signup: 'Create a free account', link: 'Sign in with an email link', reset: 'Reset your password' }[mode];
    // A Pro feature asks for an account first, but a free account does not unlock it:
    // say so, rather than promise it (C7).
    const proOnly = Boolean(reason) && !FREE_FEATURES.has(reason);
    const sub = mode === 'signup' || mode === 'signin'
        ? (what
            ? (proOnly && acct.openTesting ? `While we test Keystone AI, every account has Pro's features, ${what} included. Create a free account to use it now.`
                : proOnly ? `Keystone AI Pro includes ${what}. Start with a free account, which keeps every house you design; you can upgrade from your account.`
                : `A free account unlocks ${what}, and keeps every house you design.`)
            : 'Save your houses and walk through them in 3D. Free, no card needed.')
        : mode === 'link' ? 'No password: we email you a link that signs you in.' : 'We will email you a link to choose a new password.';

    return (
        <div className="pg-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <form ref={panelRef} className="pg-dialog gl acct-dialog" role="dialog" aria-modal="true" aria-labelledby="ac-title" onSubmit={submit} noValidate>
                <header>
                    <div style={{ display: 'grid', gap: 10 }}>
                        {(mode === 'signin' || mode === 'signup') && (
                            <div className="pg-seg" role="tablist" aria-label="Account">
                                <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>Create account</button>
                                <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => setMode('signin')}>Sign in</button>
                            </div>
                        )}
                        <h2 id="ac-title">{sent ? 'Check your email' : title}</h2>
                        {!sent && <p className="sub">{sub}</p>}
                    </div>
                    <button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} weight="bold" aria-hidden="true"/></button>
                </header>

                {!acct.configured && (
                    <p className="pg-err" role="alert"><Warning size={15} weight="bold" aria-hidden="true"/>Accounts are not switched on for this site yet.</p>
                )}

                {sent ? (
                    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
                        <p className="pg-ok"><CheckCircle size={18} weight="fill" aria-hidden="true"/>{sent}</p>
                        <button type="button" className="btn glass" data-autofocus onClick={() => { setSent(''); setMode('signin'); }}>Back to sign in</button>
                    </div>
                ) : (
                    <>
                        {(mode === 'signin' || mode === 'signup') && (
                            <>
                                <button type="button" className="btn glass acct-google" disabled={!acct.configured || !!busy} onClick={() => run('google', acct.signInWithGoogle)}>
                                    <GoogleLogo size={18} weight="bold" aria-hidden="true"/>{busy === 'google' ? 'Opening Google' : 'Continue with Google'}
                                </button>
                                <p className="acct-or"><span>or with email</span></p>
                            </>
                        )}
                        {mode === 'signup' && (
                            <div className="pg-field" key="name"><label htmlFor="ac-name">Your name <span className="opt">(optional)</span></label>
                                <input id="ac-name" className="pg-input" autoComplete="name" placeholder="Jane Doe" value={form.name} onChange={set('name')}/></div>
                        )}
                        <div className="pg-field" key="email"><label htmlFor="ac-email">Email</label>
                            <input id="ac-email" type="email" className={'pg-input' + (error ? ' is-error' : '')} autoComplete="email" placeholder="jane@email.com"
                                value={form.email} onChange={set('email')} aria-invalid={!!error} aria-describedby={error ? 'ac-err' : undefined}/></div>
                        {(mode === 'signin' || mode === 'signup') && !acct.devAuth && (
                            <div className="pg-field" key="password"><label htmlFor="ac-pw">Password</label>
                                <input id="ac-pw" type="password" className="pg-input" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                                    placeholder={mode === 'signup' ? 'At least 8 characters' : ''} value={form.password} onChange={set('password')}/></div>
                        )}
                        {error && <p id="ac-err" className="pg-err" role="alert"><Warning size={15} weight="bold" aria-hidden="true"/>{error}</p>}
                        <button type="submit" className="btn primary" disabled={!acct.configured || !!busy}>
                            {mode === 'link' && <EnvelopeSimple size={16} weight="bold" aria-hidden="true"/>}
                            {busy ? { signin: 'Signing in', signup: 'Creating your account', link: 'Sending the link', reset: 'Sending' }[busy] || 'Working'
                                : { signin: 'Sign in', signup: 'Create free account', link: 'Email me a sign-in link', reset: 'Send reset email' }[mode]}
                        </button>
                        <p className="fine acct-alt">
                            {mode === 'signin' && <><button type="button" className="linkbtn" onClick={() => setMode('link')}>Sign in with an email link</button> · <button type="button" className="linkbtn" onClick={() => setMode('reset')}>Forgot password</button></>}
                            {mode === 'signup' && <>By creating an account you agree to the <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.</>}
                            {(mode === 'link' || mode === 'reset') && <button type="button" className="linkbtn" onClick={() => setMode('signin')}>Back to sign in</button>}
                        </p>
                        {acct.devAuth && <p className="fine">Development sign-in: any email works, no password.</p>}
                    </>
                )}
            </form>
        </div>
    );
}

/* Pro upsell for a locked feature: what Pro includes, then Stripe Checkout. */
export function UpgradeDialog({ open, reason = null, onClose }) {
    const acct = useAccount();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        setError(''); setBusy(false);
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const id = requestAnimationFrame(() => ref.current?.querySelector('[data-autofocus]')?.focus());
        return () => { document.removeEventListener('keydown', onKey); cancelAnimationFrame(id); };
    }, [open, onClose]);
    if (!open) return null;
    const what = reason ? FEATURE_LABEL[reason] || reason : null;

    const upgrade = async () => {
        setBusy(true); setError('');
        try {
            const res = await acct.authFetch('/api/billing/checkout', { method: 'POST' });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.url) { window.location.href = data.url; return; }
            setError(data?.message || 'Could not open checkout. Try again.');
        } catch { setError('Could not reach the server. Check your connection and try again.'); }
        setBusy(false);
    };

    return (
        <div className="pg-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div ref={ref} className="pg-dialog gl acct-dialog" role="dialog" aria-modal="true" aria-labelledby="up-title">
                <header>
                    <div style={{ display: 'grid', gap: 8 }}>
                        <h2 id="up-title">{what ? `${what[0].toUpperCase()}${what.slice(1)} ${/s$/.test(what) ? 'are' : 'is'} part of Pro` : 'Keystone AI Pro'}</h2>
                        <p className="sub">$49 a month. Cancel any time.</p>
                    </div>
                    <button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} weight="bold" aria-hidden="true"/></button>
                </header>
                <ul className="acct-list">
                    <li>Elevation drawings and exterior renders</li>
                    <li>Refinements and the cost estimate</li>
                    <li>Downloads: plan PDF, DXF, estimate and 3D model</li>
                    <li><b>3 photoreal houses a month</b>, delivered to your account</li>
                </ul>
                {error && <p className="pg-err" role="alert"><Warning size={15} weight="bold" aria-hidden="true"/>{error}</p>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn primary" data-autofocus disabled={busy} onClick={upgrade}>{busy ? 'Opening checkout' : 'Upgrade for $49 a month'}</button>
                    <a className="btn glass" href="/pricing">Compare plans</a>
                </div>
                <p className="fine">Payments are handled by Stripe. You can change or cancel your plan from your account.</p>
                <p className="fine">On the team? <a className="linkbtn" href="/account?tab=billing" onClick={onClose}>Use a developer key</a></p>
            </div>
        </div>
    );
}
