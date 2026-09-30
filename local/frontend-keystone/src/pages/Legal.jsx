import React from 'react';
import { CONTACT_EMAIL, LEGAL_UPDATED_AT } from '../data/brand.js';
import { useRouteMeta } from '../hooks/useRouteMeta.js';
import { getCurrentPath } from '../lib/routing.js';
import { PageHead, Subpage } from '../site/Subpage.jsx';

/* One reading column. The old layout set legal text in two columns, which
   sends the reader back up the page at the end of every column. */
export const LegalPage = ({ title, intro, sections }) => {
    useRouteMeta(getCurrentPath());
    return (
        <Subpage>
            <PageHead title={title} actions={false}>{intro}</PageHead>
            <div className="pg-wrap" style={{ paddingTop: 16 }}>
                <dl className="pg-facts gl" style={{ maxWidth: 820, marginBottom: 12 }}>
                    <div><dt>Last updated</dt><dd>{LEGAL_UPDATED_AT}</dd></div>
                    <div><dt>Contact</dt><dd className="mono" style={{ userSelect: 'all' }}>{CONTACT_EMAIL}</dd></div>
                    <div><dt>Status</dt><dd>Starter draft. These pages use the public brand name Keystone AI while the formal legal entity details are finalized.</dd></div>
                </dl>
                <article className="pg-legal gl">
                    {sections.map((section) => (
                        <section key={section.title}>
                            <h2>{section.title}</h2>
                            {section.body.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                        </section>
                    ))}
                </article>
            </div>
        </Subpage>
    );
};

export const PrivacyPage = () => (
    <LegalPage
        title="A plain-language privacy draft for an early-stage studio product."
        intro="This page explains how Keystone AI handles information today, in straightforward terms. It will be tightened as the business structure is formalized."
        sections={[
            { title: 'Information we collect', body: [
                'We may collect contact details you send through access forms, project brief information submitted through the product, and the outputs generated from those inputs.',
                'We may also collect limited technical data such as basic usage logs, browser information, and service diagnostics needed to keep the product working.',
            ] },
            { title: 'How the information is used', body: [
                'We use information to operate Keystone AI, respond to access requests, improve output quality, maintain security, and understand whether the product is reliable for real homeowner use.',
                'We do not treat your project data as public marketing material without permission.',
            ] },
            { title: 'Sharing and service providers', body: [
                'Keystone AI relies on hosted infrastructure and model providers to generate outputs and deliver the service. Information may be processed by those providers as part of normal operation.',
                'We do not sell personal information. We share data only as needed to run, secure, or improve the service.',
            ] },
            { title: 'Retention', body: [
                'We retain information for as long as reasonably necessary to operate the product, support users, evaluate product quality, and comply with legal obligations.',
                'If you need a deletion request reviewed, contact us at the email listed on this page and we will handle it where reasonably possible.',
            ] },
            { title: 'Your choices', body: [
                'You can choose not to submit forms or project details, though that may limit access to Keystone AI.',
                'You may also contact us to ask questions about access, stored contact details, submitted project data, or deletion requests.',
            ] },
            { title: 'Important note', body: [
                'Keystone AI is an early-stage product. This privacy page is a starter draft designed to be transparent while the formal company structure is still being finalized.',
            ] },
        ]}
    />
);

export const TermsPage = () => (
    <LegalPage
        title="Interim terms for using Keystone AI responsibly."
        intro="These terms match the current reality of the product: an early-stage studio tool for first conversations, not a substitute for professional design responsibility."
        sections={[
            { title: 'Nature of the service', body: [
                'Keystone AI is an early-stage home design and discovery product. It helps people describe what they want in a house, generate conceptual floor plans, prepare elevations and a concept-level cost estimate, create downloadable images and DXF exports, and produce exterior renders from project briefs.',
                'The service is offered on an early-stage basis and may evolve, change, pause, or improve over time.',
            ] },
            { title: 'Professional responsibility', body: [
                'Keystone AI does not replace licensed design professionals. All outputs must be reviewed, interpreted, and validated by qualified professionals before they are used in any meaningful project context.',
                'You are responsible for how you use outputs inside your own planning, budgeting, or design process.',
            ] },
            { title: 'Not construction documents', body: [
                'Keystone AI outputs are conceptual only. They are not permit-ready drawings, engineering documents, code compliance confirmations, or final construction instructions.',
                'You must not rely on Keystone AI outputs as final technical documents without further professional development and review.',
            ] },
            { title: 'User responsibilities', body: [
                'You agree to provide information you have the right to use and to avoid unlawful, infringing, or harmful inputs.',
                'If Keystone AI access is private or code-based, you are responsible for safeguarding that access and sharing it only as intended.',
            ] },
            { title: 'Payments and availability', body: [
                'Pricing, access policies, and demo eligibility may change as the product evolves. Guided sessions or free demos may be limited or discontinued.',
                'We do not guarantee uninterrupted availability, and we may suspend or modify access when needed for reliability or safety.',
            ] },
            { title: 'Warranty and liability', body: [
                'Keystone AI is provided as-is to the fullest extent permitted by law. We make no guarantee that outputs will be accurate for every project, complete for every use case, or uninterrupted at all times.',
                'To the fullest extent permitted by law, Keystone AI is not liable for project losses, downstream design decisions, construction reliance, or other damages arising from use of conceptual outputs.',
            ] },
        ]}
    />
);
