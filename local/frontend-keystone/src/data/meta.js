/* ---------------------------------------------------------------------
   Per-route metadata.

   Before Phase 5 all eight routes served one identical <head>: one title,
   one description, no <link rel="canonical"> anywhere, and og:url /
   og:image pointing at a Cloud Run host that is not even the current one
   (vercel.json rewrites to keystone-api-yhicwzbyja). The referenced
   images/og-preview.png did not exist, so every share card on X, LinkedIn,
   Slack and iMessage rendered imageless.

   SITE_ORIGIN: set VITE_SITE_ORIGIN at build time to the public origin.
   Without it we fall back to the runtime origin, which is always correct
   for canonical but is not visible to scrapers that do not run JS - so
   the build-time value is what makes share cards resolve.
   --------------------------------------------------------------------- */
export const SITE_ORIGIN = (
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SITE_ORIGIN) ||
    (typeof window !== 'undefined' ? window.location.origin : '')
).replace(/\/+$/, '');

export const OG_IMAGE_PATH = '/images/og-preview.png';

export const ROUTE_META = {
    '/': {
        title: 'Keystone AI - Say it. See it. Build it.',
        description: 'Describe your home in plain words. Keystone AI lays out every room, raises it in 3D and prices it, often in under a minute. Floor plans are free.',
    },
    '/how-floor-plans-work': {
        title: 'How Floor Plans Work - Keystone AI',
        description: 'The sequence behind every Keystone AI plan: a guided brief becomes constraints, footprints are explored, a room program is built, then the layout is drawn and checked.',
    },
    '/case-study': {
        title: 'How Floor Plans Work - Keystone AI',
        description: 'The sequence behind every Keystone AI plan: a guided brief becomes constraints, footprints are explored, a room program is built, then the layout is drawn and checked.',
        canonicalPath: '/how-floor-plans-work',
    },
    '/b2b-workflow': {
        title: 'Guided Workflow - Keystone AI',
        description: 'A guided process that gets you to the first design conversation with a real plan, elevations and a CAD export already in hand.',
    },
    '/roadmap': {
        title: 'Roadmap - Keystone AI',
        description: 'What Keystone AI does today and what is planned, with a strict line between the two.',
    },
    '/pricing': {
        title: 'Pricing - Keystone AI',
        description: 'Floor plans are free. A free account saves your houses and adds the 3D walkthrough. Pro is $49 a month with 3 photoreal houses.',
    },
    '/account': {
        title: 'Your account - Keystone AI',
        description: 'Your saved houses, photoreal models, billing and profile.',
    },
    '/faq': {
        title: 'FAQ - Keystone AI',
        description: 'What is free, what Pro adds, and what Keystone AI is not. Answered plainly.',
    },
    '/privacy': {
        title: 'Privacy - Keystone AI',
        description: 'How Keystone AI handles project inputs and generated outputs.',
    },
    '/terms': {
        title: 'Terms - Keystone AI',
        description: 'Terms of use for the Keystone AI during its trial phase.',
    },
};
