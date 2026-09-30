import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { X as XIcon } from '@phosphor-icons/react';
import { useRouteMeta } from '../hooks/useRouteMeta.js';
// The studio (survey, drawing, 3D) is its own chunk: most visitors read the page
// first, so it loads when the browser is idle after the page, or on first open.
const loadStudio = () => import('../studio/DesignGenerator.jsx');
const DesignGenerator = lazy(() => loadStudio().then((m) => ({ default: m.DesignGenerator })));
import { SiteShell, useSite } from '../site/SiteShell.jsx';
import { HeroHouse } from '../site/HeroHouse.jsx';
import { Story } from '../site/Story.jsx';
import { EngineLedger, Outputs, PriceAnchor } from '../site/HomeSections.jsx';
import { Mark } from '../site/Mark.jsx';
import { useAccount } from '../lib/account.jsx';

const Hero = () => {
    const { openStudio, openAccount } = useSite();
    const acct = useAccount();
    return (
        <section className="pg-wrap pg-hero" aria-labelledby="hero-title">
            <div className="pg-hero-grid">
                <div className="pg-hero-card gl pg-enter" style={{ '--i': 0 }}>
                    <h1 id="hero-title" className="h-display pg-hero-title"><span>Say it.</span> <span>See it.</span> <span>Build it.</span></h1>
                    <p className="lead">Describe your home in plain words. Keystone AI lays out every room, raises it in 3D and prices it, often in under a minute.</p>
                    <div className="ctas">
                        <button type="button" className="btn call" onClick={openStudio}>Design my house, free <span aria-hidden="true">&rarr;</span></button>
                    </div>
                    <p className="fine">{acct.localStudio ? 'Local testing: no account or payment needed. Nepal brief checks are available in the studio.' : <>Free, no account needed for the floor plan. <button type="button" className="linkbtn" onClick={() => openAccount('signup')}>Create a free account</button> to save it and walk through it in 3D.</>}</p>
                </div>
                <div className="pg-enter" style={{ '--i': 2, minHeight: 0, display: 'grid' }}>
                    <HeroHouse/>
                </div>
            </div>
        </section>
    );
};

/* The studio stays mounted after its first open so work is not lost. It is
   inert while closed, a modal dialog while open, closes on Escape and
   hands focus back to whatever opened it. */
const StudioOverlay = ({ open, mounted, onClose, pendingBrief }) => {
    const { openAccount } = useSite();
    const windowRef = useRef(null);
    const openerRef = useRef(null);

    useEffect(() => {
        if (!open) {
            // After the page UI is visible again (see body.studio-open in glass.css).
            const opener = openerRef.current;
            openerRef.current = null;
            if (opener && document.contains(opener)) requestAnimationFrame(() => opener.focus());
            return undefined;
        }
        if (!openerRef.current && document.activeElement instanceof HTMLElement && !windowRef.current?.contains(document.activeElement)) {
            openerRef.current = document.activeElement;
        }
        const id = requestAnimationFrame(() => {
            if (windowRef.current && !windowRef.current.contains(document.activeElement)) windowRef.current.focus();
        });
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (document.querySelector('[aria-modal="true"]:not(.studio-modal-window)')) return;
            onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => { cancelAnimationFrame(id); document.removeEventListener('keydown', onKey); };
    }, [open, mounted, onClose]);

    if (!mounted) return null;
    return (
        <div className="studio-modal-overlay" inert={!open} aria-hidden={!open}
            style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity 180ms var(--ease)' }}>
            <div className="studio-modal-window" ref={windowRef} role="dialog" aria-modal="true" aria-label="Keystone AI" tabIndex={-1}>
                <div className="studio-modal-topbar">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="studio-lockup"><Mark size={24} tile="#0F1420" ink="#F7F8FA" keystone="#C9A15A"/><b>Keystone</b><span>AI</span></span>
                    </div>
                    <button className="studio-modal-close" onClick={onClose} aria-label="Close studio">
                        <XIcon size={16} weight="bold"/>
                    </button>
                </div>
                <div className="studio-modal-body">
                    <Suspense fallback={<p className="studio-empty-note studio-opening" role="status"><Mark size={48} motion="loop"/><span>Opening the studio…</span></p>}>
                        <DesignGenerator onOpenModal={() => openAccount('signup')} initialBrief={pendingBrief}/>
                    </Suspense>
                </div>
            </div>
        </div>
    );
};

export const DreamApp = () => {
    const [isStudioOpen, setStudioOpen] = useState(false);
    const [hasStudioMounted, setHasStudioMounted] = useState(false);
    const [pendingBrief] = useState(null);
    useRouteMeta('/');

    useEffect(() => {
        const handler = () => setStudioOpen(true);
        document.addEventListener('keystone:open-studio', handler);
        return () => document.removeEventListener('keystone:open-studio', handler);
    }, []);
    useEffect(() => {
        const fromHash = () => { if (window.location.hash === '#generator') setStudioOpen(true); };
        fromHash();
        window.addEventListener('hashchange', fromHash);
        return () => window.removeEventListener('hashchange', fromHash);
    }, []);
    useEffect(() => { if (isStudioOpen) setHasStudioMounted(true); }, [isStudioOpen]);
    // Fetch the studio chunk once the page is idle, so opening it is instant.
    useEffect(() => {
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2000));
        const cancel = window.cancelIdleCallback || clearTimeout;
        const id = idle(() => { loadStudio().catch(() => {}); });
        return () => cancel(id);
    }, []);
    useEffect(() => {
        document.body.classList.toggle('studio-open', isStudioOpen);
        return () => document.body.classList.remove('studio-open');
    }, [isStudioOpen]);

    const close = React.useCallback(() => {
        setStudioOpen(false);
        if (window.location.hash === '#generator') history.replaceState(null, '', window.location.pathname);
    }, []);

    return (
        <SiteShell
            currentPath="/"
            onOpenStudio={() => setStudioOpen(true)}
            outside={<StudioOverlay open={isStudioOpen} mounted={hasStudioMounted} onClose={close} pendingBrief={pendingBrief}/>}
        >
            <main id="main" tabIndex={-1}>
                <Hero/>
                <Story/>
                <Outputs/>
                <EngineLedger/>
                <PriceAnchor/>
            </main>
        </SiteShell>
    );
};
