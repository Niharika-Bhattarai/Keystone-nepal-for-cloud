import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { List, UserCircle, X } from '@phosphor-icons/react';
import { Mark } from './Mark.jsx';
import { AccountDialog, UpgradeDialog } from './AccountDialog.jsx';
import { useAccount } from '../lib/account.jsx';
import { CONTACT_EMAIL } from '../data/brand.js';
import { LIVE_STUDIO_HASH } from '../lib/routing.js';

const Badge3D = lazy(() => import('./Badge3D.jsx'));

const NAV = [
    ['How it works', '/how-floor-plans-work'],
    ['Pricing', '/pricing'],
    ['Workflow', '/b2b-workflow'],
    ['Roadmap', '/roadmap'],
    ['FAQ', '/faq'],
];

const SiteCtx = createContext({ openAccount: () => {}, openUpgrade: () => {}, openStudio: () => {} });
export const useSite = () => useContext(SiteCtx);

/* Glass light follows the pointer on hover. One delegated listener for the
   whole page rather than one per panel. */
function usePointerLight(ref) {
    useEffect(() => {
        const root = ref.current;
        if (!root || !window.matchMedia('(hover: hover)').matches) return undefined;
        let raf = 0;
        const onMove = (e) => {
            const g = e.target.closest?.('.gl');
            if (!g || raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                const r = g.getBoundingClientRect();
                g.style.setProperty('--mx', `${e.clientX - r.left}px`);
                g.style.setProperty('--my', `${e.clientY - r.top}px`);
            });
        };
        root.addEventListener('pointermove', onMove, { passive: true });
        return () => { root.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
    }, [ref]);
}

/* The footer's 3D badge pulls in three.js (about 170 KB compressed). It loads only
   when the footer comes within 300px of the screen, and then only once the
   browser is idle (on short pages the footer is on screen at load, and the badge
   is ornament). Until then the flat mark stands in. Browsers without
   IntersectionObserver load it straight away. */
function FooterBadge() {
    const ref = useRef(null);
    const [near, setNear] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el || near) return undefined;
        if (typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
        const cancelIdle = window.cancelIdleCallback || clearTimeout;
        let idleId = null;
        const io = new IntersectionObserver(([entry]) => {
            if (!entry.isIntersecting) return;
            io.disconnect();
            idleId = idle(() => setNear(true), { timeout: 4000 });
        }, { rootMargin: '300px' });
        io.observe(el);
        return () => { io.disconnect(); if (idleId !== null) cancelIdle(idleId); };
    }, [near]);
    const still = <Mark size={72} tile="#E8EEF4" ink="#0F1420"/>;
    return <div className="pg-badge" ref={ref}>{near ? <Suspense fallback={still}><Badge3D/></Suspense> : still}</div>;
}

export const SiteShell = ({ children, currentPath = '/', onOpenStudio, sceneTone, outside = null }) => {
    const rootRef = useRef(null);
    const acct = useAccount();
    const [dialog, setDialog] = useState(null);      // null | { kind: 'account' | 'upgrade', mode, reason }
    const [menu, setMenu] = useState(false);
    const menuRef = useRef(null);
    const menuButtonRef = useRef(null);
    const [scrolled, setScrolled] = useState(false);
    usePointerLight(rootRef);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 40);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    /* The menu is a modal sheet: Escape closes it, Tab stays inside it, and closing
       returns focus to the menu button (the sign-in dialog works the same way). */
    useEffect(() => {
        if (!menu) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') { setMenu(false); return; }
            if (e.key !== 'Tab' || !menuRef.current) return;
            const stops = [...menuRef.current.querySelectorAll('a[href], button:not([disabled])')].filter((el) => el.offsetParent !== null);
            if (!stops.length) return;
            const first = stops[0], last = stops[stops.length - 1];
            if (!menuRef.current.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
            else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            if (menuButtonRef.current && document.contains(menuButtonRef.current) && menuButtonRef.current.offsetParent !== null) menuButtonRef.current.focus();
        };
    }, [menu]);

    const openStudio = useCallback(() => {
        if (onOpenStudio) onOpenStudio();
        else window.location.href = LIVE_STUDIO_HASH;
    }, [onOpenStudio]);
    const openAccount = useCallback((mode = 'signin', reason = null) => { setMenu(false); if (acct.localStudio) { openStudio(); return; } setDialog({ kind: 'account', mode, reason }); }, [acct.localStudio, openStudio]);
    const openUpgrade = useCallback((reason = null) => { setMenu(false); if (acct.localStudio) { openStudio(); return; } setDialog({ kind: 'upgrade', reason }); }, [acct.localStudio, openStudio]);
    const closeDialog = useCallback(() => setDialog(null), []);
    const initial = (acct.authUser?.name || acct.authUser?.email || '?').trim()[0]?.toUpperCase() || '?';

    return (
        <SiteCtx.Provider value={{ openAccount, openUpgrade, openStudio }}>
            <div className="pg" ref={rootRef}>
                <div className="pg-scene" data-tone={sceneTone} aria-hidden="true">
                    <img src="/story/render.jpg" alt="" decoding="async"/>
                </div>

                <header className={'pg-nav gl clear' + (scrolled ? ' is-scrolled' : '')}>
                    <a className="pg-brand" href="/" aria-label="Keystone AI home"><Mark motion="intro"/><b>Keystone</b><span>AI</span></a>
                    <nav className="pg-navlinks" aria-label="Main">
                        {NAV.filter(([, href]) => !acct.localStudio || href !== '/pricing').map(([label, href]) => (
                            <a key={href} href={href} aria-current={currentPath === href ? 'page' : undefined}>{label}</a>
                        ))}
                    </nav>
                    {acct.localStudio ? <span className="pg-navkey">Local studio</span> : acct.signedIn ? (
                        <a className="pg-navkey is-signed" href="/account" aria-current={currentPath === '/account' ? 'page' : undefined}>
                            <i className="pg-avatar" aria-hidden="true">{initial}</i><span>Account</span>
                        </a>
                    ) : (
                        <button type="button" className="pg-navkey" onClick={() => openAccount('signin')}>
                            <UserCircle size={16} weight="bold" aria-hidden="true"/><span>Sign in</span>
                        </button>
                    )}
                    <button type="button" className="btn call sm" onClick={openStudio}>Open the studio</button>
                    <button type="button" ref={menuButtonRef} className="iconbtn pg-menubtn" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu}>
                        <List size={20} weight="bold" aria-hidden="true"/>
                    </button>
                </header>

                {children}

                <footer className="pg-footer gl deep">
                    <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
                        <FooterBadge/>
                        <a className="pg-brand" href="/" style={{ color: '#fff' }}><b>Keystone</b><span>AI</span></a>
                        <p style={{ maxWidth: '34ch' }}>Concept floor plans for people who are not architects.</p>
                    </div>
                    <div>
                        <h2>Read next</h2>
                        <ul>{[...NAV.filter(([, href]) => !acct.localStudio || href !== '/pricing'), ['Privacy', '/privacy'], ['Terms', '/terms']].map(([l, h]) => <li key={h}><a href={h}>{l}</a></li>)}</ul>
                    </div>
                    <div>
                        <h2>Get started</h2>
                        <ul>
                            <li><button type="button" className="linklike" onClick={openStudio}>Open the studio</button></li>
                            {acct.localStudio ? <li><button type="button" className="linklike" onClick={openStudio}>Open local studio</button></li> : acct.signedIn
                                ? <li><a href="/account">Your account</a></li>
                                : <>
                                    <li><button type="button" className="linklike" onClick={() => openAccount('signup')}>Create a free account</button></li>
                                    <li><button type="button" className="linklike" onClick={() => openAccount('signin')}>Sign in</button></li>
                                </>}
                        </ul>
                        <h2 style={{ marginTop: 16 }}>Contact</h2>
                        <p className="mono" style={{ fontSize: 13, userSelect: 'all' }}>{CONTACT_EMAIL}</p>
                    </div>
                    <div className="legal"><span>© 2026 Keystone AI</span><span>Concept aids only. Not construction documents.</span></div>
                </footer>

                {menu && (
                    <div className="pg-sheetmenu gl" role="dialog" aria-modal="true" aria-label="Menu" ref={menuRef}>
                        <header>
                            <span className="pg-brand"><Mark/><b>Keystone</b><span>AI</span></span>
                            <button type="button" className="iconbtn" onClick={() => setMenu(false)} aria-label="Close menu" autoFocus><X size={20} weight="bold" aria-hidden="true"/></button>
                        </header>
                        <nav aria-label="Main">{NAV.filter(([, href]) => !acct.localStudio || href !== '/pricing').map(([l, h]) => <a key={h} href={h}>{l}</a>)}</nav>
                        <button type="button" className="btn call" style={{ marginTop: 14 }} onClick={() => { setMenu(false); openStudio(); }}>Open the studio</button>
                        {acct.localStudio ? null : acct.signedIn
                            ? <a className="btn glass" style={{ marginTop: 8 }} href="/account">Your account</a>
                            : <button type="button" className="btn glass" style={{ marginTop: 8 }} onClick={() => openAccount('signin')}>Sign in</button>}
                    </div>
                )}

                {!acct.localStudio && <AccountDialog open={dialog?.kind === 'account'} mode={dialog?.mode} reason={dialog?.reason} onClose={closeDialog}/>}
                {!acct.localStudio && <UpgradeDialog open={dialog?.kind === 'upgrade'} reason={dialog?.reason} onClose={closeDialog}/>}
            </div>
            {/* Rendered outside .pg so the glass styles cannot reach the studio. */}
            {outside}
        </SiteCtx.Provider>
    );
};
