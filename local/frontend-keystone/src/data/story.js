/* The homepage house (hero and story). Every value is real engine output for one
   brief. The layout was generated 2026-09-25 (POST /api/plan, then
   /api/plan/presentation for the rendered sheets); regenerated 2026-09-28 with the
   current engine, it is room for room, door for door the same house. The estimate
   is from that 2026-09-28 run, after the foundation-quantity fix (C7). The hero's
   photoreal model is baked from the same plan (backend-keystone
   scripts/build-hero-model.js). Files live in public/story/. The exterior render is
   the site's existing sample image, not generated for this plan. */
export const STORY = {
    brief: '3 bed, 2 story, 2,400 sq ft, 1-car garage and a study',
    sentence: '3 bed, 2 story, 2,400 sq ft, 1-car garage and a study.',
    modelFacts: '2 levels · 21 rooms · 19 doorways · 14 windows',
    score: 100,
    alternatives: [99, 99],
    conditionedSqFt: 2380,
    garageSqFt: 308,
    estimate: {
        low: 360171,
        target: 423728,
        high: 508473,
        psf: [151, 214],
        categories: [
            ['Shell', 173401],
            ['Mechanical', 80412],
            ['Millwork', 63660],
            ['Finishes', 54608],
            ['Site', 27662],
            ['Soft costs', 23985],
        ],
    },
};
