import React from 'react';
import { Check, Minus } from '@phosphor-icons/react';
import { useRouteMeta } from '../hooks/useRouteMeta.js';
import { Faq, PageHead, Section, Subpage } from '../site/Subpage.jsx';
import { useSite } from '../site/SiteShell.jsx';
import { useAccount } from '../lib/account.jsx';

/* Pricing (owner decision, 2026-09-26): floor plans need no account; a free
   account adds saved projects and the 3D walkthrough; Pro is $49 a month
   and includes 3 photoreal houses a month. */
const TIERS = [
    { key: 'anonymous', name: 'Try it', price: '$0', note: 'no account' },
    { key: 'free', name: 'Free account', price: '$0', note: 'with an email' },
    { key: 'pro', name: 'Pro', price: '$49', note: 'a month · cancel any time', feature: true },
];
const ROWS = [
    ['Floor plan, every level', true, true, true],
    ['Save and reopen your houses', false, true, true],
    ['3D walkthrough', false, 'Watermarked', true],
    ['All four exterior elevations', false, false, true],
    ['Exterior renders', false, false, true],
    ['Refinements in plain language', false, false, true],
    ['Cost estimate workbook', false, false, true],
    ['Downloads: PDF, DXF, 3D model', false, false, true],
    ['Photoreal houses, delivered to your account', false, false, '3 a month'],
];
const QUESTIONS = [
    ['What can I do without an account?', 'Answer the questions and see the floor plan for every level. Nothing is saved and nothing downloads.'],
    ['What does the free account add?', 'Your houses are saved, so you can come back to them, and you can walk through each one in 3D.'],
    ['What is a photoreal house?', 'We build your house in full on our servers: real materials, furniture, every light switched on, and sunlight bouncing through the rooms. It takes about half an hour. You get an email when it is ready, with a walkthrough you can explore and a set of photographs, all kept in your account.'],
    ['What if I need more than 3 photoreal houses in a month?', 'The allowance resets every month on your billing date. Unused houses do not roll over.'],
    ['How does that compare with hiring a drafter?', 'Custom house plans typically cost $2,000 to $10,000 in the US (HomeGuide, 2026). Keystone AI gives you a concept set to start that conversation with, not construction documents.'],
    ['How do I cancel?', 'From Billing in your account, any time. Pro stays on until the end of the month you paid for.'],
];

const Cell = ({ v }) => {
    if (v === true) return <dd><Check size={18} weight="bold" aria-hidden="true"/><span className="sr-only">Included</span></dd>;
    if (v === false) return <dd className="no"><Minus size={18} aria-hidden="true"/><span className="sr-only">Not included</span></dd>;
    return <dd>{v}</dd>;
};

const PricingContent = () => {
    const { openStudio, openAccount, openUpgrade } = useSite();
    const acct = useAccount();
    if (acct.localStudio) return <>
      <PageHead title="Local development access" actions={false}>The Nepal studio runs locally without accounts or payment. The existing generator, downloads and quick 3D are available for testing.</PageHead>
      <Section id="local-pricing" title="Open the studio"><button type="button" className="btn primary" onClick={openStudio}>Open the studio</button>
        <p>Photoreal rendering needs a separate local Blender setup. Nepal generation is still under development.</p></Section>
    </>;
    const action = (t) => {
        if (t.key === 'anonymous') return <button type="button" className="btn glass" onClick={openStudio}>Open the studio</button>;
        if (t.key === 'free') {
            return acct.signedIn
                ? <a className="btn glass" href="/account">Your account</a>
                : <button type="button" className="btn glass" onClick={() => openAccount('signup')}>Create a free account</button>;
        }
        if (acct.tier === 'pro') return <a className="btn primary" href="/account?tab=billing">You are on Pro</a>;
        return <button type="button" className="btn primary" onClick={() => (acct.signedIn ? openUpgrade() : openAccount('signup'))}>Get Pro</button>;
    };
    return (
        <>
            <PageHead title="Floor plans are free. Pro is $49 a month." actions={false}>
                Try the studio without an account. Make a free account to keep your houses and walk through them. Go Pro for the drawings, the downloads and photoreal houses.
            </PageHead>
            <Section id="plans" title="Plans and what each one includes" hideTitle>
                <div className="pg-tiers">
                    {TIERS.map((t, c) => (
                        <section key={t.key} className={'pg-tier gl pg-enter' + (t.feature ? ' is-feature' : '')} style={{ '--i': c + 1 }} aria-labelledby={`tier-${t.key}`}>
                            <header><h2 id={`tier-${t.key}`}>{t.name}</h2>{acct.tier === t.key && <span className="tag live">Your plan</span>}</header>
                            <p className="price num">{t.price}<small>{t.note}</small></p>
                            <dl>{ROWS.map(([label, ...cells]) => <div key={label}><dt>{label}</dt><Cell v={cells[c]}/></div>)}</dl>
                            {action(t)}
                        </section>
                    ))}
                </div>
                <p className="pg-footnote gl clear">Prices in US dollars. Payments are handled by Stripe.</p>
            </Section>
            <Section id="pricing-q" title="Before you ask"><Faq items={QUESTIONS} openFirst/></Section>
        </>
    );
};

export const PricingPage = () => {
    useRouteMeta('/pricing');
    return <Subpage><PricingContent/></Subpage>;
};
