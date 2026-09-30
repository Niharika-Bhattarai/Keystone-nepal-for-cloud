import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, Cube } from '@phosphor-icons/react';
import { cropToDrawing, finishSequence, playSequence, prefersReducedMotion, prepareSequence } from '../lib/planSequence.js';
import { safeSvg } from '../lib/safeSvg.js';
import { STORY } from '../data/story.js';
import { Mark } from './Mark.jsx';

/* The hero: one house, one view at a time.
   1. The engine's plan for the homepage brief draws itself (both levels).
   2. "Building the photoreal 3D model": at least a moment, however fast it loads.
   3. The photoreal model of the same plan takes the stage, roof off; its upper floor
      lifts so both floors show, and it turns.
   4. After one full turn (or as soon as the visitor touches it), a switch lets them
      go between the floor plan and the 3D.
   The model (about 2 MB plus three.js) loads only once the drawing is done, and waits
   for a tap on data-saver connections. Replay does it all again. */

const HeroModel = lazy(() => import('./HeroModel.jsx'));
const PLAN = '/story/plan.svg';
const MODEL = '/story/model.glb';
const SPEED = 3.6;       // the drawing, about 3.5 s
const BUILD_MS = 1400;   // the shortest "building" moment before the model shows

const saveData = () => {
    const c = typeof navigator !== 'undefined' ? navigator.connection : null;
    return Boolean(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
};

export const HeroHouse = () => {
    const boxRef = useRef(null);
    const sheetRef = useRef(null);
    const cancelRef = useRef(null);
    const [run, setRun] = useState(0);
    const [ratio, setRatio] = useState(2.27);
    const [beat, setBeat] = useState({ text: 'Loading the engine’s plan…', done: false });
    const [progress, setProgress] = useState(0);
    const [dark, setDark] = useState(true);
    const [stage, setStage] = useState('drawing'); // drawing | building | ready
    const [view, setView] = useState('plan');      // plan | 3d (what is on the stage)
    const [built, setBuilt] = useState(0);         // counts finished drawings: each one lifts the floor again
    const [wantModel, setWantModel] = useState(false);
    const [model, setModel] = useState('idle');    // idle | loading | ready | error
    const [minDone, setMinDone] = useState(false);
    const [canSwitch, setCanSwitch] = useState(false);
    const [askFirst] = useState(saveData);

    const fit = useCallback(() => {
        const box = boxRef.current, sheet = sheetRef.current;
        if (!box || !sheet) return;
        const W = box.clientWidth, H = box.clientHeight;
        if (!W || !H) return;
        const w = Math.min(W, H * ratio);
        sheet.style.width = `${w}px`;
        sheet.style.height = `${w / ratio}px`;
    }, [ratio]);
    useEffect(() => {
        fit();
        const ro = new ResizeObserver(fit);
        if (boxRef.current) ro.observe(boxRef.current);
        return () => ro.disconnect();
    }, [fit]);

    // 1. Draw the plan.
    useEffect(() => {
        let alive = true;
        cancelRef.current?.(); cancelRef.current = null;
        setDark(true); setProgress(0);
        setBeat({ text: 'Drawing…', done: false });
        const finish = () => {
            setDark(false); setProgress(1);
            setBuilt((n) => n + 1);
            if (askFirst && model !== 'ready') { setStage('ready'); setBeat({ text: 'Drawn by the engine · real output', done: true }); return; }
            setStage('building'); setMinDone(false); setWantModel(true);
            setBeat({ text: 'Building the photoreal 3D model…', done: false });
        };
        fetch(PLAN).then((r) => r.text()).then((text) => {
            const surface = sheetRef.current?.querySelector('.surface');
            if (!alive || !surface) return;
            surface.innerHTML = safeSvg(text, 'hero-plan');
            const svg = surface.querySelector('svg');
            if (!svg) return;
            svg.removeAttribute('width'); svg.removeAttribute('height');
            svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', `Generated floor plan, both levels, for ${STORY.brief}`);
            const ground = svg.querySelector('rect')?.getAttribute('fill') || '#FFFFFF';
            const beats = prepareSequence(svg).beats;
            const r = cropToDrawing(svg);
            if (r) setRatio(r);
            sheetRef.current.style.setProperty('--sheet-bg', ground);
            if (prefersReducedMotion()) { finishSequence(svg, beats); finish(); return; }
            void svg.getBoundingClientRect();
            cancelRef.current = playSequence(svg, beats, {
                speed: SPEED,
                revealMs: 700,
                onBeat: (i, b) => { if (!alive) return; setBeat({ text: `Drawing ${b.label}… ${i + 1}/${beats.length}`, done: false }); setProgress((i + 1) / beats.length); },
                onReveal: () => { if (alive) finish(); },
            });
        }).catch(() => { if (alive) { setDark(false); setBeat({ text: 'The plan could not load.', done: true }); } });
        return () => { alive = false; cancelRef.current?.(); cancelRef.current = null; };
    }, [run, askFirst]); // eslint-disable-line react-hooks/exhaustive-deps -- model is read at the end of a drawing only

    // 2. The building moment lasts at least BUILD_MS, even when the model is already here.
    useEffect(() => {
        if (stage !== 'building') return undefined;
        const id = setTimeout(() => setMinDone(true), prefersReducedMotion() ? 0 : BUILD_MS);
        return () => clearTimeout(id);
    }, [stage, built]);

    // 3. Then the model takes the stage (or the plan stays, if the model failed).
    useEffect(() => {
        if (stage !== 'building' || !minDone) return;
        if (model === 'ready') {
            setView('3d'); setStage('ready');
            setBeat({ text: 'Drawn and built by the engine · real output', done: true });
        } else if (model === 'error') {
            setStage('ready');
            setBeat({ text: 'Drawn by the engine · the 3D model could not load', done: true });
        }
    }, [stage, minDone, model]);

    const replay = () => { setView('plan'); setStage('drawing'); setRun((n) => n + 1); };
    const show = (v) => setView(v);
    const on3d = view === '3d' && model === 'ready';

    return (
        <figure className="pg-live pg-hero-house gl clear" aria-label="One house, drawn by the engine and built in 3D">
            <div className="pg-live-top">
                <p className="pg-live-brief"><b>BRIEF</b><span title={STORY.brief}>{STORY.brief}</span></p>
                <button type="button" className="btn glass sm" onClick={replay} aria-label="Replay the drawing and the model"><ArrowClockwise size={16} weight="bold" aria-hidden="true"/><span>Replay</span></button>
            </div>
            <div className={`pg-hero-stage is-${on3d ? '3d' : 'plan'}${stage === 'building' ? ' is-building' : ''}`}>
                <div className="pg-sheetbox pg-hero-plan" ref={boxRef} aria-hidden={on3d || undefined}>
                    <div className={'sheet' + (dark ? ' seq-dark' : '')} ref={sheetRef}><div className="surface"/></div>
                </div>
                <div className={`pg-hero-3d is-${model}`} aria-hidden={!on3d || undefined}>
                    {wantModel && (
                        <Suspense fallback={null}>
                            <HeroModel src={MODEL} run={built} active={on3d} onState={setModel} onTurn={() => setCanSwitch(true)}/>
                        </Suspense>
                    )}
                    {on3d && <span className="pg-hero-3d-tag">Same plan, photoreal · roof off · drag to turn and tilt</span>}
                </div>
                {stage === 'building' && (
                    <p className="pg-hero-building" role="status"><Mark size={44} motion="loop" ink="#0F1420"/><span>Building the photoreal 3D model…</span></p>
                )}
                {stage === 'ready' && askFirst && model === 'idle' && (
                    <button type="button" className="btn glass sm pg-hero-3d-ask" onClick={() => { setStage('building'); setMinDone(false); setWantModel(true); setBeat({ text: 'Building the photoreal 3D model…', done: false }); }}>
                        <Cube size={16} weight="bold" aria-hidden="true"/><span>Show it in 3D (about 2 MB)</span>
                    </button>
                )}
                {canSwitch && model === 'ready' && stage === 'ready' && (
                    <div className="pg-hero-switch" role="group" aria-label="Show">
                        <button type="button" aria-pressed={view === 'plan'} onClick={() => show('plan')}>Floor plan</button>
                        <button type="button" aria-pressed={view === '3d'} onClick={() => show('3d')}>3D</button>
                    </div>
                )}
            </div>
            <div className="pg-live-foot">
                <p className={'beat' + (beat.done ? ' is-done' : '')} aria-live="polite"><span className="pulse" aria-hidden="true"/><span>{beat.text}</span></p>
                <div className="pg-live-prog" aria-hidden="true"><i style={{ '--p': progress.toFixed(3) }}/></div>
            </div>
        </figure>
    );
};
