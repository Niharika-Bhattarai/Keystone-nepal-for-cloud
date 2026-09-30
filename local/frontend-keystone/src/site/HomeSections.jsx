import React from 'react';
import { Check, Minus } from '@phosphor-icons/react';
import { useSite } from './SiteShell.jsx';
import { useAccount } from '../lib/account.jsx';
import { STORY } from '../data/story.js';

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

export const EngineLedger = () => (
    <section className="pg-wrap pg-sect" aria-labelledby="eng-h" style={{ paddingTop: 0 }}>
        <div className="pg-head gl">
            <h2 className="h-sec" id="eng-h">What runs behind one sentence.</h2>
            <p className="lead">A plan that passes its checks takes a lot of work. This is what does it.</p>
        </div>
        <ul className="pg-ledger gl">
            <li><h3>A layout has to pass before you see it</h3><p>Every plan goes through 12 validators: every room reachable from the entry, the room count you asked for, bathroom access for each bedroom, no hallway bloat, stairs that land where they should. The sample house on this page passed all of them and scored 100.</p></li>
            <li><h3>One engine, not a picture generator</h3><p>About 36,000 lines across 153 modules turn a brief into a room program, a footprint, a zoned layout, stairs, openings, furniture, elevations and a takeoff, checked by 552 automated tests.</p></li>
            <li><h3>A budget from the plan's own quantities</h3><p>The concept estimate prices 28 line items low, target and high, from site grading to kitchen countertops, using the same geometry as the drawings.</p></li>
            <li>
                <h3>Rules from the books architects train on</h3>
                <div><p>The layout rules are drawn from the texts architects train on.</p>
                    <div className="pg-books"><span>A Pattern Language</span><span>The Timeless Way of Building</span><span>Architects' Data</span><span>Architectural Graphic Standards</span><span>The Interior Design Reference</span></div>
                </div>
            </li>
        </ul>
    </section>
);

const Free = () => <span className="tag live">Free</span>;
const Keyed = () => <span className="tag key">Pro</span>;

export const Outputs = () => (
    <section className="pg-wrap pg-sect" aria-labelledby="out-h" style={{ paddingTop: 0 }}>
        <div className="pg-head gl"><h2 className="h-sec" id="out-h">Six things from every session.</h2></div>
        <div className="pg-outputs">
            <article className="pg-output gl">
                <div className="peek brief" aria-hidden="true">&gt; {STORY.sentence}</div>
                <h3>Plain-language brief <Free/></h3><p>A sentence or the guided survey. No dimensions to guess at.</p>
            </article>
            <article className="pg-output gl">
                <div className="peek"><img src="/story/plan-r.svg" alt="" loading="lazy" style={{ transform: 'scale(2)', transformOrigin: '24% 50%' }}/></div>
                <h3>Dimensioned floor plan <Free/></h3><p>Every level, with room names, areas, doors, windows and overall dimensions.</p>
            </article>
            <article className="pg-output gl">
                <div className="peek" style={{ background: '#e9e4d8' }}><img src="/story/elev-front-r.svg" alt="" loading="lazy" style={{ objectFit: 'contain' }}/></div>
                <h3>All four elevations <Free/></h3><p>Front, rear, left and right, from the same geometry as the plan.</p>
            </article>
            <article className="pg-output gl">
                <div className="peek"><img src="/story/render.jpg" alt="" loading="lazy"/></div>
                <h3>Exterior render <Keyed/></h3><p>A photorealistic view of the house from your brief.</p>
            </article>
            <article className="pg-output gl">
                {/* Sheet A101 of this house's DXF (the CAD export), rendered black on white. */}
                <div className="peek" style={{ background: '#FFFFFF' }}><img src="/story/cad-sheet-a101.webp" alt="" loading="lazy" style={{ transform: 'scale(1.5)', transformOrigin: '48% 46%' }}/></div>
                <h3>CAD-ready DXF <Keyed/></h3><p>Drawing sheets at true scale, with dimensions and a door and window schedule. Open them in any CAD tool.</p>
            </article>
            <article className="pg-output gl">
                <div className="peek cost" aria-hidden="true">
                    <span className="num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em' }}>{money(STORY.estimate.low)} – {money(STORY.estimate.high)}</span>
                </div>
                <h3>Concept cost range <Keyed/></h3><p>A quantity takeoff and a first budget, so geometry and money are discussed together.</p>
            </article>
        </div>
    </section>
);

export const PriceAnchor = () => {
    const { openStudio, openAccount } = useSite();
    const acct = useAccount();
    if (acct.localStudio) return <section className="pg-wrap pg-sect"><div className="pg-head gl">
      <h2 className="h-sec">Explore the local studio</h2>
      <p className="lead">Use the Nepal plot brief and test the existing generator without an account. Nepal generation is in development.</p>
      <button type="button" className="btn call" onClick={openStudio}>Open the studio</button>
    </div></section>;
    return (
        <section className="pg-wrap pg-sect" aria-labelledby="val-h" style={{ paddingTop: 0 }}>
            <div className="pg-head gl">
                <h2 className="h-sec" id="val-h">Start where a drafter would, for a fraction of it.</h2>
                <p className="lead">Keystone AI does not replace an architect. It gets you to your first meeting with the plan, the elevations and a budget already on the table.</p>
            </div>
            <div className="pg-anchor">
                <div className="gl">
                    <h3>Hiring a drafter or buying plans</h3>
                    <p className="price num">$2,000–$10,000<small>for custom house plans</small></p>
                    <ul>
                        <li><Minus size={18} weight="bold" aria-hidden="true"/>Weeks of back and forth before a first drawing</li>
                        <li><Minus size={18} weight="bold" aria-hidden="true"/>Pre-drawn stock plans run $700–$1,500 and are not yours</li>
                    </ul>
                    <p className="src">Typical 2026 US ranges, <a href="https://homeguide.com/costs/blueprints-house-plans-cost" target="_blank" rel="noopener noreferrer">HomeGuide</a>.</p>
                </div>
                <div className="gl deep">
                    <h3>With Keystone AI</h3>
                    <p className="price num">$49<small>a month for Pro · cancel any time</small></p>
                    <ul>
                        <li><Check size={18} weight="bold" aria-hidden="true"/>3 photoreal 3D houses every month</li>
                        <li><Check size={18} weight="bold" aria-hidden="true"/>Elevations, exterior render, CAD-ready DXF and cost estimate</li>
                        <li><Check size={18} weight="bold" aria-hidden="true"/>Floor plans stay free, no account needed</li>
                    </ul>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button type="button" className="btn glass" onClick={openStudio}>Open the studio</button>
                        <button type="button" className="btn glass" onClick={() => openAccount('signup')}>Create a free account</button>
                        <a className="btn glass" href="/pricing">See pricing</a>
                    </div>
                    <p className="src">Concept drawings, not construction documents.</p>
                </div>
            </div>
        </section>
    );
};
