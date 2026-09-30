import React, { useMemo } from 'react';
import { useRouteMeta } from '../hooks/useRouteMeta.js';
import { Faq, Subpage } from '../site/Subpage.jsx';
import { useSite } from '../site/SiteShell.jsx';
import { useAccount } from '../lib/account.jsx';

const ITEMS = [
    ['What is live in Keystone AI right now?', 'Guided brief capture, floor plan generation, elevation views, a concept-level cost estimate workbook, CAD export (DXF), high-resolution plan downloads, and exterior renders from the same brief. A 3D preview of the plan is in the studio, labelled Preview.'],
    ['Who is Keystone AI for?', 'Homeowners and first-time home builders who want to describe the house they want without needing technical drafting knowledge.'],
    ['Do I need a technical background to use it?', 'No. That is the point of the guided brief. You talk about your rooms, priorities and preferences in plain language.'],
    ['What do I get for free?', 'Floor plans for every level, with no account. A free account also keeps every house you design and lets you walk through it in 3D.'],
    ['What does Pro add?', 'For $49 a month: 3 photoreal 3D houses a month, the four elevations, plain-language changes, the exterior render, the cost estimate for your area, and the downloads (high-resolution plan, CAD-ready DXF and the estimate workbook).'],
    ['Does Keystone AI replace an architect or builder?', 'No. It is an early design and discovery tool. It helps you arrive with a clearer starting point, but professional design judgment still matters for any real project.'],
    ['Are these outputs construction documents?', 'No. Outputs are concept aids only. They are not permit-ready drawings, stamped documents, engineering deliverables, or final construction instructions.'],
    ['Are CAD files and cost estimates live today?', 'Yes, with Pro. The DXF is a set of drawing sheets at true scale, and the estimate is priced for your ZIP code (US). Native DWG and construction scheduling are planned.'],
        ['How long does it take?', 'The first floor plan often arrives in under a minute. Exterior renders take longer, but still fit inside one early design session.'],
    ['What happens to my data?', 'Project inputs and generated outputs are used to run the service, handle access requests and improve quality. The privacy page explains the current policy.'],
];
const LOCAL_ITEMS = [
    ['Do I need an account?', 'No. This local development copy opens the studio, downloads, edits and quick 3D without sign-in or payment.'],
    ['Can it generate Nepal plans yet?', 'The Nepal brief checks plot, floors and rental layout inputs. Nepal-specific plan generation is still being built; the existing US engine is available separately for testing.'],
    ['Are the output drawings permit ready?', 'No. Nepal legal, structural, Vaastu and professional review work remains. The existing generator produces architectural concepts only.'],
    ['Can I make photoreal renders?', 'Photoreal rendering needs Blender and local assets. The quick 3D model is available from a generated plan.'],
];

const Side = () => {
    const { openStudio, openAccount } = useSite();
    const acct = useAccount();
    return (
        <div className="side pg-head gl pg-enter" style={{ '--i': 0, marginBottom: 0 }}>
            <h1 className="h-page">Questions, answered plainly.</h1>
            <p className="lead">Open only what you need. Nothing here has to be read in order.</p>
            <div className="pg-actions">
                <button type="button" className="btn primary" onClick={openStudio}>Open the studio</button>
                {!acct.localStudio && <button type="button" className="btn glass" onClick={() => openAccount('signup')}>Create a free account</button>}
            </div>
        </div>
    );
};

export const FAQPage = () => {
    const acct = useAccount();
    const questions = acct.localStudio ? LOCAL_ITEMS : ITEMS;
    const ld = useMemo(() => ({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: questions.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    }), [acct.localStudio]);
    useRouteMeta('/faq', ld);
    return (
        <Subpage>
            <div className="pg-wrap pg-faqlay" style={{ paddingTop: 40 }}>
                <Side/>
                <section aria-label="Frequently asked questions"><Faq items={questions}/></section>
            </div>
        </Subpage>
    );
};
