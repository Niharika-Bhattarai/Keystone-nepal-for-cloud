import React from 'react';
import { SiteShell, useSite } from './SiteShell.jsx';
import { getCurrentPath } from '../lib/routing.js';
import { useAccount } from '../lib/account.jsx';

/* Frame for every page other than home: the glass shell over a softened
   view of the house, so long reading stays comfortable. */
export const Subpage = ({ children }) => (
    <SiteShell currentPath={getCurrentPath()} sceneTone="soft">
        <main id="main" tabIndex={-1} className="pg-page">{children}</main>
    </SiteShell>
);

export const PageHead = ({ title, children, actions = true, wide = false }) => {
    const { openStudio, openAccount } = useSite();
    const acct = useAccount();
    return (
        <header className={'pg-wrap pg-pagehead' + (wide ? ' is-wide' : '')}>
            <div className="pg-head gl pg-enter" style={{ '--i': 0 }}>
                <h1 className="h-page">{title}</h1>
                {children && <div className="lead">{children}</div>}
                {actions && (
                    <div className="pg-actions">
                        <button type="button" className="btn primary" onClick={openStudio}>Open the studio</button>
                        {!acct.localStudio && <button type="button" className="btn glass" onClick={() => openAccount('signup')}>Create a free account</button>}
                    </div>
                )}
            </div>
        </header>
    );
};

export const Section = ({ id, title, children, hideTitle = false }) => (
    <section className="pg-wrap pg-block" aria-labelledby={id}>
        <h2 id={id} className={hideTitle ? 'sr-only' : 'pg-block-title gl clear'}>{title}</h2>
        {children}
    </section>
);

export const Faq = ({ items, openFirst = false }) => (
    <div className="pg-faq gl">
        {items.map(([q, a], i) => (
            <details key={q} open={openFirst && i === 0}>
                <summary><span>{q}</span><span className="pg-faq-sign" aria-hidden="true"/></summary>
                <p>{a}</p>
            </details>
        ))}
    </div>
);
