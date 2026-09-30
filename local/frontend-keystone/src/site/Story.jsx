import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { cropToDrawing, prepareSequence, prefersReducedMotion, scrubSequence } from '../lib/planSequence.js';
import { safeSvg } from '../lib/safeSvg.js';
import { STORY } from '../data/story.js';

const House3D = lazy(() => import('./House3D.jsx'));

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);

const STEPS = [
    ['It starts with one sentence.', 'No drafting vocabulary. The same words you would use with a friend.'],
    ['The engine draws the plan.', 'Outer walls, partitions, stairs, openings, furniture, names and dimensions, in the order an architect reads a building.'],
    ['Every wall is real geometry.', 'The same rooms, doors and windows stand up as a model: two levels, stacked where the stairs land.'],
    ['And what it might cost.', 'A quantity takeoff priced low, target and high across 28 line items, before anyone has quoted.'],
];
const FADE = 0.14; // share of a step spent cross-fading into the next

/* One brief, told by scrolling. The section is several screens tall and its
   stage is sticky. Scroll sets a target; a single animation frame loop eases
   the shown progress toward it, and every visual reads that one smoothed
   value by writing to the DOM directly. React only re-renders when the step
   (and so the heading) changes, which keeps the scroll free of jank. */
export const Story = () => {
    const sectionRef = useRef(null);
    const sheetRef = useRef(null);
    const viewRefs = useRef([]);
    const barRef = useRef(null);
    const briefRef = useRef(null);
    const totalRef = useRef(null);
    const barsRef = useRef(null);
    const seq = useRef(null);
    const house = useRef(null);
    const fullBox = useRef(null);
    const stepRef = useRef(0);
    const [step, setStep] = useState(0);
    const [geometry, setGeometry] = useState(null);
    const [near, setNear] = useState(false);
    const [level, setLevel] = useState(1);
    // three.js starts when the reader reaches the plan step; the 3D is the step after it.
    const [show3d, setShow3d] = useState(false);
    useEffect(() => { if (step >= 1) setShow3d(true); }, [step]);

    // Phone: the two storeys side by side are illegible, so show one at a time.
    const applyLevel = (lv = level) => {
        const q = seq.current, box = fullBox.current;
        if (!q || !box) return;
        const [x, y, w, h] = box.split(/\s+/).map(Number);
        const narrow = window.matchMedia('(max-width: 699px)').matches;
        q.svg.setAttribute('viewBox', narrow ? `${lv === 1 ? x : x + w / 2} ${y} ${w / 2} ${h}` : box);
    };
    useEffect(() => {
        applyLevel(level);
        const mq = window.matchMedia('(max-width: 699px)');
        const on = () => applyLevel(level);
        mq.addEventListener('change', on);
        return () => mq.removeEventListener('change', on);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [level]);

    useEffect(() => {
        const el = sectionRef.current;
        if (!el) return undefined;
        // The story starts one screen down, so a positive margin made it "near" at load
        // and its plan and 3D work (about a second on a slow phone, C7) competed with the
        // hero. It now starts once the story's top is in the upper three quarters of the
        // screen; its first step is the brief, so the plan is ready before it is shown.
        const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: '0px 0px -25% 0px' });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    useEffect(() => {
        if (!near) return undefined;
        let alive = true;
        fetch('/story/plan-r.svg').then((r) => r.text()).then((text) => {
            const surface = sheetRef.current?.querySelector('.surface');
            if (!alive || !surface) return;
            surface.innerHTML = safeSvg(text, 'story-plan');
            const svg = surface.querySelector('svg');
            if (!svg) return;
            svg.removeAttribute('width'); svg.removeAttribute('height');
            svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', `Rendered floor plan for ${STORY.brief}`);
            // Drawings sit on paper: the slate presentation ground becomes white.
            const ground = svg.querySelector('rect');
            if (ground) ground.setAttribute('fill', '#FFFFFF');
            const beats = prepareSequence(svg).beats;
            if (ground) ground.dataset.origFill = '#FFFFFF';
            cropToDrawing(svg, 0.015);
            fullBox.current = svg.getAttribute('viewBox');
            seq.current = { svg, beats, shown: -1 };
            applyLevel();
        }).catch(() => {});
        fetch('/story/house.json').then((r) => r.json()).then((g) => { if (alive) setGeometry(g); }).catch(() => {});
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [near]);

    useEffect(() => {
        const reduce = prefersReducedMotion();
        const maxCat = STORY.estimate.categories[0][1];
        let target = 0, shown = 0, raf = 0, lastSeg = -1;

        const readTarget = () => {
            const el = sectionRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            const total = el.offsetHeight - window.innerHeight;
            target = clamp(-r.top / Math.max(1, total));
        };

        const paint = (prog) => {
            const seg = prog * STEPS.length;
            const s = Math.min(STEPS.length - 1, Math.floor(seg));
            const l = clamp(seg - s);
            if (s !== stepRef.current) { stepRef.current = s; setStep(s); }
            barRef.current?.style.setProperty('--p', prog.toFixed(4));

            // Cross-fade every view from the one smoothed position.
            viewRefs.current.forEach((v, i) => {
                if (!v) return;
                const fadeIn = i === 0 ? 1 : clamp((seg - i + FADE) / (FADE * 2));
                const fadeOut = i === STEPS.length - 1 ? 1 : clamp((i + 1 + FADE - seg) / (FADE * 2));
                const o = Math.min(fadeIn, fadeOut);
                v.style.opacity = o.toFixed(3);
                v.style.transform = `translateY(${((1 - o) * (seg < i + 0.5 ? 18 : -18)).toFixed(1)}px) scale(${(0.985 + 0.015 * o).toFixed(4)})`;
                v.style.visibility = o < 0.01 ? 'hidden' : 'visible';
                v.setAttribute('aria-hidden', o < 0.5 ? 'true' : 'false');
            });

            // 1. the sentence types itself
            if (briefRef.current) {
                const n = s > 0 ? STORY.sentence.length : Math.round(STORY.sentence.length * ease(l * 1.3));
                briefRef.current.firstChild.textContent = STORY.sentence.slice(0, n);
                briefRef.current.lastChild.textContent = STORY.sentence.slice(n);
            }
            // 2. the plan draws, beat by beat
            const q = seq.current;
            if (q) {
                const k = reduce || s > 1 ? q.beats.length : s < 1 ? 0 : Math.round(q.beats.length * clamp(l * 1.2));
                if (k !== q.shown) {
                    q.shown = k;
                    scrubSequence(q.svg, q.beats, k);
                    sheetRef.current?.classList.toggle('seq-dark', k > 0 && k < q.beats.length);
                }
            }
            // 3. the walls rise
            house.current?.setProgress(s < 2 ? 0 : s > 2 ? 1 : ease(l * 1.15));
            // 4. the budget counts up and the bars grow
            const c = s < 3 ? 0 : ease(l * 1.6);
            if (totalRef.current) totalRef.current.textContent = money(STORY.estimate.target * c);
            if (barsRef.current) {
                [...barsRef.current.querySelectorAll('.track i')].forEach((bar, i) => {
                    const v = STORY.estimate.categories[i][1] / maxCat;
                    const stagger = clamp(c * 1.4 - i * 0.08);
                    bar.style.transform = `scaleX(${(v * ease(stagger)).toFixed(4)})`;
                });
            }
            lastSeg = seg;
        };

        const loop = () => {
            raf = 0;
            const d = target - shown;
            shown = reduce || Math.abs(d) < 0.0004 ? target : shown + d * 0.14;
            paint(shown);
            if (shown !== target) raf = requestAnimationFrame(loop);
        };
        const kick = () => { readTarget(); if (!raf) raf = requestAnimationFrame(loop); };

        readTarget(); shown = target; paint(shown);
        window.addEventListener('scroll', kick, { passive: true });
        window.addEventListener('resize', kick);
        return () => { window.removeEventListener('scroll', kick); window.removeEventListener('resize', kick); cancelAnimationFrame(raf); };
    }, []);

    const setView = (i) => (el) => { viewRefs.current[i] = el; };

    return (
        <section className="pg-story" id="story" ref={sectionRef} aria-label="One brief becomes a house">
            <div className="pg-story-stage">
                <div className="pg-story-copy gl">
                    <h2 key={step} className="pg-story-h">{STEPS[step][0]}</h2>
                    <p className="body">{STEPS[step][1]}</p>
                    <div className="pg-story-bar" aria-hidden="true"><i ref={barRef}/></div>
                </div>
                <div className="pg-story-view gl clear">
                    <div className="pg-sv pg-sv-brief" ref={setView(0)}>
                        <p ref={briefRef}><span/><span className="t">{STORY.sentence}</span></p>
                    </div>
                    <div className="pg-sv pg-sv-plan" ref={setView(1)}>
                        <div className="sheet" ref={sheetRef}><div className="surface"/></div>
                        <div className="pg-levels" role="group" aria-label="Level">
                            {[1, 2].map((lv) => <button type="button" key={lv} aria-pressed={level === lv} onClick={() => setLevel(lv)}>Level {lv}</button>)}
                        </div>
                    </div>
                    <div className="pg-sv pg-sv-3d" ref={setView(2)}>
                        {show3d && geometry && (
                            <Suspense fallback={null}>
                                <House3D geometry={geometry} progress={0} autoRotate={false}
                                    onApi={(api) => { house.current = api; }}
                                    label={`3D study model of the plan for ${STORY.brief}`}/>
                            </Suspense>
                        )}
                        <div className="pg-sv-cap"><span className="chip">3D preview from the real plan geometry</span><span className="chip">{STORY.modelFacts}</span></div>
                    </div>
                    <div className="pg-sv pg-sv-est" ref={setView(3)}>
                        <div>
                            <p className="total num" ref={totalRef}>$0</p>
                            <small className="num">Target for a mid budget · {money(STORY.estimate.low)} low · {money(STORY.estimate.high)} high · ${STORY.estimate.psf[0]}–${STORY.estimate.psf[1]} per conditioned sq ft</small>
                            <div className="pg-bars" ref={barsRef} aria-label="Target cost by category">
                                {STORY.estimate.categories.map(([k, v]) => (
                                    <div className="pg-bar" key={k}><span>{k}</span><span className="track"><i/></span><span>{money(v)}</span></div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};
