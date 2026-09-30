import React from 'react';
import { Check } from '@phosphor-icons/react';
import { useRouteMeta } from '../hooks/useRouteMeta.js';
import { PageHead, Section, Subpage } from '../site/Subpage.jsx';

const STAGES = [
    ['Step 1', 'You open the guided brief', 'A survey written for normal people, so the process begins with clarity instead of technical guesswork.'],
    ['Step 2', 'You fill in what you want', 'Room needs, lot cues, light preferences and style arrive in a format you, your family and any professional you bring in can review later.'],
    ['Step 3', 'A plan, elevations and a DXF come back', 'The generated plan becomes something you can download as a blueprint image, with matching elevations and a DXF, before the next design conversation even begins.'],
    ['Step 4', 'The next conversation starts ahead', 'An optional exterior render helps everyone picture the same house. The deeper win is simpler: the process starts with more clarity and less drift.'],
];

const BENEFITS = [
    'A clearer first design conversation',
    'An easier handoff into professional design work later',
    'A stronger concept to discuss with family, review and budget against',
];

export const B2BWorkflowPage = () => {
    useRouteMeta('/b2b-workflow');
    return (
        <Subpage>
            <PageHead title="Arrive at the first design conversation already ahead.">
                A guided process, not a lead form. It gives you something real to react to before anyone starts drawing.
            </PageHead>
            <Section id="wf-steps" title="How it goes">
                <ol className="pg-timeline">
                    {STAGES.map(([st, t, b]) => (
                        <li key={t} className="pg-tl gl"><p className="st">{st}</p><h3>{t}</h3><p>{b}</p></li>
                    ))}
                </ol>
            </Section>
            <Section id="wf-value" title="What you walk away with">
                <ul className="pg-list gl">{BENEFITS.map((b) => <li key={b}><Check size={18} weight="bold" aria-hidden="true"/>{b}</li>)}</ul>
            </Section>
            <Section id="wf-proof" title="The output, from one real brief">
                <div className="pg-figs">
                    <figure className="pg-fig gl">
                        <div className="peek" style={{ background: '#535f64' }}><img src="/story/plan-r.svg" alt="Rendered floor plan for both levels, with room names and dimensions" loading="lazy"/></div>
                        <figcaption><b>Floor plan.</b> Every level, dimensioned and labelled.</figcaption>
                    </figure>
                    <figure className="pg-fig gl">
                        <div className="peek" style={{ background: '#e9e4d8' }}><img src="/story/elev-front-r.svg" alt="Front elevation of the same house" loading="lazy"/></div>
                        <figcaption><b>Elevations.</b> All four sides, from the same geometry.</figcaption>
                    </figure>
                    <figure className="pg-fig gl">
                        <div className="peek" style={{ background: '#0F1420' }}><img src="/story/plan.svg" alt="Line drawing of the plan, as it opens in a CAD tool" loading="lazy" style={{ filter: 'grayscale(1) invert(1) contrast(1.6)' }}/></div>
                        <figcaption><b>CAD export.</b> A DXF a designer can open directly.</figcaption>
                    </figure>
                </div>
            </Section>
        </Subpage>
    );
};
