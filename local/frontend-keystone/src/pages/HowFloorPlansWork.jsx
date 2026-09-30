import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, Cube, FileText, Image as ImageIcon, Ruler, Table } from '@phosphor-icons/react';
import { useRouteMeta } from '../hooks/useRouteMeta.js';
import { getCurrentPath } from '../lib/routing.js';
import { prefersReducedMotion } from '../lib/planSequence.js';
import { Faq, PageHead, Section, Subpage } from '../site/Subpage.jsx';
import { drawPlan } from '../site/drawPlan.js';

const FACTS = [
    ['Input', 'Guided home brief, or one plain sentence'],
    ['Core engine', 'Deterministic layout and validation, not an image model'],
    ['Output', 'Plan, elevations, DXF, cost range and an optional render'],
    ['Boundary', 'Concept study, not permit documents'],
];

const ROOMS = [['Kitchen', 256], ['Dining room', 192], ['Living room', 140], ['Garage', 308], ['Stairs', 112], ['Stair hall', 80], ['Bathroom 1', 64], ['Mudroom', 48], ['Laundry', 80], ['Entry', 64], ['Primary bedroom', 336], ['Study', 224], ['Bedroom 2', 208], ['Bedroom 3', 140], ['Primary bath', 80], ['Bathroom 2', 60], ['Storage', 70], ['Landing hall', 66]];

const DrawnPlan = () => {
    const ref = useRef(null);
    useEffect(() => {
        if (ref.current) drawPlan(ref.current, '/story/plan-r.svg', { scope: 'how-plan', label: 'The laid-out plan for the example brief', speed: 3 }).catch(() => {});
        return () => ref.current?._cancel?.();
    }, []);
    return <div className="sheet" ref={ref}><div className="surface"/></div>;
};

const Footprints = () => {
    const [best, setBest] = useState(prefersReducedMotion());
    useEffect(() => { const t = setTimeout(() => setBest(true), 1300); return () => clearTimeout(t); }, []);
    return (
        <div className="pg-fps" aria-label="Four footprint candidates; 42 by 32 feet fits best">
            {[[150, 96, '46×30'], [134, 102, '42×32'], [118, 118, '37×37'], [170, 86, '52×27']].map(([w, h, l], i) => (
                <div key={l} className={best && i === 1 ? 'best' : ''} style={{ width: w, height: h }}>{l}</div>
            ))}
        </div>
    );
};

const STAGES = [
    {
        title: 'The survey is normalized into a usable brief',
        body: 'Your answers do not stay as loose text. They become structured constraints: story count, area target, garage type, primary-suite level, bathroom rules, frontage and lot context.',
        vis: () => <div className="pg-tokens">{['stories: 2', 'area: 2,400 sq ft', 'bedrooms: 3', 'baths: 3', 'private baths: 1', 'garage: 1 car', 'primary suite: level 2', 'front faces: south', 'kitchen: rear', 'laundry: level 1', 'extras: study', 'budget: mid'].map((t, i) => <span key={t} style={{ '--i': i }}>{t}</span>)}</div>,
    },
    {
        title: 'Multiple footprint candidates are explored',
        body: 'Rectangular footprints are tested against the requested size, number of stories, garage needs and lot assumptions, so the plan never starts from one arbitrary box.',
        vis: () => <Footprints/>,
    },
    {
        title: 'A room program is built before geometry',
        body: 'Bedrooms, bathrooms, public rooms, stairs, circulation, mudroom, laundry and extras become a room program with target areas and adjacency intent, before any layout begins.',
        vis: () => <div className="pg-rooms">{ROOMS.map(([n, a], i) => <span key={n} style={{ '--i': i }}>{n}<b>{a}</b></span>)}</div>,
    },
    {
        title: 'The plan is laid out on a tile grid',
        body: 'The program is placed into public, private, service and circulation zones, then turned into a floor plan with dimensions, story alignment and a stair core.',
        vis: () => <DrawnPlan/>,
        long: true,
    },
    {
        title: 'Openings and circulation are validated',
        body: 'Doors, windows and entries are added once the geometry exists. Then the plan is checked for connectivity, room count, bathroom logic, hallway bloat and other quality gates.',
        vis: () => (
            <div className="pg-checks">
                {['Every room reachable from the entry', 'Room count matches the brief', 'Each bedroom has bath access', 'Hallways under the bloat limit', '14 windows and 19 doorways placed'].map((t, i) => (
                    <span key={t} className="chip" style={{ '--i': i }}><CheckCircle size={16} weight="fill" aria-hidden="true"/>{t}</span>
                ))}
                <p className="mono" style={{ fontSize: 12, marginTop: 6 }}>LAYOUT SCORE 100 · TWO ALTERNATIVES AT 99</p>
            </div>
        ),
    },
    {
        title: 'The concept package is exported',
        body: 'The plan, the elevation set and the DXF come first. The exterior render is an optional image layer on top of the approved geometry, not a replacement for it.',
        vis: () => (
            <div className="pg-files">
                {[[Ruler, 'Floor plan', 'PNG'], [ImageIcon, 'Elevations', 'PNG'], [FileText, 'CAD', 'DXF'], [Table, 'Estimate', 'XLSX'], [Cube, '3D preview', 'Studio']].map(([Icon, n, f], i) => (
                    <div key={n} style={{ '--i': i }}><Icon size={26} aria-hidden="true"/><b>{n}</b><span className="tag">{f}</span></div>
                ))}
            </div>
        ),
    },
];

const Walkthrough = () => {
    const [idx, setIdx] = useState(0);
    const [paused, setPaused] = useState(prefersReducedMotion());
    useEffect(() => {
        if (paused) return undefined;
        const t = setTimeout(() => setIdx((i) => (i + 1) % STAGES.length), STAGES[idx].long ? 8000 : 6000);
        return () => clearTimeout(t);
    }, [idx, paused]);
    const pick = (i) => { setPaused(true); setIdx(i); };
    const onKey = (e) => {
        if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
        e.preventDefault();
        const next = (idx + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + STAGES.length) % STAGES.length;
        pick(next);
        e.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
    };
    const s = STAGES[idx];
    return (
        <div className={'pg-how' + (paused ? ' is-paused' : '')}>
            <div className="pg-stages gl" role="tablist" aria-label="Stages" aria-orientation="vertical" onKeyDown={onKey}>
                {STAGES.map((st, i) => (
                    <button type="button" role="tab" key={st.title} id={`stage-${i}`} aria-selected={i === idx} aria-controls="stage-panel" tabIndex={i === idx ? 0 : -1} onClick={() => pick(i)}>
                        <span className="n">{`0${i + 1}`}</span><span className="t">{st.title}</span>
                        <span className="bar" aria-hidden="true"><i key={`${idx}-${paused}`} style={{ animationDuration: s.long ? '8s' : '6s' }}/></span>
                    </button>
                ))}
            </div>
            <div className="pg-stageview gl" role="tabpanel" id="stage-panel" aria-labelledby={`stage-${idx}`}>
                <div className="vis" key={idx}>{s.vis()}</div>
                <div className="cap"><h2>{s.title}</h2><p>{s.body}</p></div>
            </div>
        </div>
    );
};

export const HowFloorPlansWorkPage = () => {
    useRouteMeta(getCurrentPath());
    return (
        <Subpage>
            <PageHead title="How a sentence becomes a working floor plan.">
                Six stages, in order. Each one hands the next a stricter version of the house, until there is a plan that passes the checks.
            </PageHead>
            <Section id="how-stages" title="The six stages"><Walkthrough/></Section>
            <Section id="how-glance" title="At a glance">
                <dl className="pg-facts gl">{FACTS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            </Section>
            <Section id="how-stop" title="Where it stops">
                <div className="pg-callout gl">
                    <p>The output is a concept aid for discovery and a first meeting. It is not a permit-ready drawing set, not a stamped document, and not a substitute for architect, engineer or builder review.</p>
                </div>
                <Faq items={[
                    ['Why a deterministic engine and not an image model?', 'An image model paints something that looks like a plan. The engine builds one: rooms with real areas, walls that meet, doors that connect, stairs that land. That is why the elevations, the cost range and the 3D preview can all come from the same geometry.'],
                    ['What if my brief has no valid layout?', 'The studio tells you plainly and lists what failed, instead of showing a plan that breaks the rules. Some very large or unusual briefs are outside what the engine supports today.'],
                ]}/>
            </Section>
        </Subpage>
    );
};

export const CaseStudyPage = () => <HowFloorPlansWorkPage/>;
