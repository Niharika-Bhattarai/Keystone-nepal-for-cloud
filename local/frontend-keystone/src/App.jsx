import React from 'react';
import { getCurrentPath } from './lib/routing.js';
import { DreamApp } from './pages/Home.jsx';
import { CaseStudyPage, HowFloorPlansWorkPage } from './pages/HowFloorPlansWork.jsx';
import { B2BWorkflowPage } from './pages/B2BWorkflow.jsx';
import { RoadmapPage } from './pages/Roadmap.jsx';
import { FAQPage } from './pages/FAQ.jsx';
import { PricingPage } from './pages/Pricing.jsx';
import { PrivacyPage, TermsPage } from './pages/Legal.jsx';
import { AccountPage } from './pages/Account.jsx';

/* Path-matched routing, mirroring the page list in backend-keystone/app.js
   (Vercel passes every path through to it). Kept explicit rather than a catch-all so
   an unknown path still reaches a real 404 at the server. */
const ROUTES = {
    '/how-floor-plans-work': HowFloorPlansWorkPage,
    '/case-study': CaseStudyPage,
    '/b2b-workflow': B2BWorkflowPage,
    '/roadmap': RoadmapPage,
    '/pricing': PricingPage,
    '/faq': FAQPage,
    '/privacy': PrivacyPage,
    '/terms': TermsPage,
    '/account': AccountPage,
    '/signin': AccountPage,
};

export const AppRouter = () => {
    const Page = ROUTES[getCurrentPath()] || DreamApp;
    return <Page/>;
};
