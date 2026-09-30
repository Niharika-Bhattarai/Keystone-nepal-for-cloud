import React from 'react';
import { useRouteMeta } from '../hooks/useRouteMeta.js';
import { PageHead, Section, Subpage } from '../site/Subpage.jsx';

const LIVE = [
    ['A brief in plain words', 'Type the house you want in a sentence, or answer the guided brief. Either becomes the same structured brief.'],
    ['Floor plans for every level', 'A dimensioned plan for each storey, with furniture, doors and windows. It is shown only after it passes the layout checks, with a score and alternatives.'],
    ['Four elevations', 'Front, rear and both sides, drawn from the same geometry as the plan, so they always agree.'],
    ['3D model in the browser', 'Walk around and through the house in 3D, level by level. Included with a free account.'],
    ['Photoreal 3D house', 'The house built with real materials, furniture and daylight, with a walkthrough and a set of photographs. Pro includes 3 a month.'],
    ['Plain-language changes', 'Ask for a change in words ("make the living room wider") and get a new plan that still passes the checks.'],
    ['Exterior render', 'A picture of the finished outside of the house, early in the conversation.'],
    ['CAD-ready drawings (DXF)', 'Drawing sheets at true scale with dimensions and a door and window schedule, ready to open in any CAD tool.'],
    ['Cost estimate for your area', 'A quantity takeoff and cost range priced for your ZIP code (US), so the plan and the budget are discussed together.'],
];
const NEXT = [
    ['Scheduling', 'A build timeline from the same plan: the phases, what depends on what, and roughly how long each takes.'],
    ['Villas', 'Larger single-family homes: wings, courtyards, more suites and bigger living spaces.'],
    ['Buildings up to 7 storeys', 'Small apartment and mixed-use buildings, with shared cores, stairs and lifts, from the same kind of brief.'],
    ['Landscaping', 'The whole lot, not just the house: driveway, paths, planting and outdoor rooms, in the plan and in 3D.'],
    ['White-labeling', 'Later, let professionals present Keystone AI inside their own brand.'],
];

const Rows = ({ items, tag, cls }) => (
    <ul className="pg-roadmap gl">
        {items.map(([t, b]) => <li key={t}><h3>{t}</h3><p>{b}</p><span className={'tag ' + cls}>{tag}</span></li>)}
    </ul>
);

export const RoadmapPage = () => {
    useRouteMeta('/roadmap');
    return (
        <Subpage>
            <PageHead title="What works today, and what comes next.">
                A strict line between what is live and what is planned. Everything under the first heading works in the studio right now.
            </PageHead>
            <Section id="rm-live" title={`Works today · ${LIVE.length} features`}><Rows items={LIVE} tag="Live" cls="live"/></Section>
            <Section id="rm-next" title="Planned, not available yet"><Rows items={NEXT} tag="Planned" cls=""/></Section>
        </Subpage>
    );
};
