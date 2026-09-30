---
version: 1
slug: "src-pages-home-jsx"
primary_target: "src/pages/Home.jsx"
related_targets: ["src/studio/DesignGenerator.jsx"]
---

# Surface: Keystone AI marketing site + studio

Mode: Persuade (home, subpages); Operate (studio).
Audience and job: homeowners who can't draw a house want a real first plan to react to. Action: open the studio; secondary: enter or request a passkey.
Proof: live engine plans, the demo brief's real score/alternatives/estimate, engine facts in PRODUCT.md. No invented testimonials or claims.
Constraints: keep all studio behavior, routes, API calls and passkey flow; safeSvg for every drawing; CSP-safe (no inline script); build on Vite/React in frontend-revamp.
Reference: approved prototype https://claude.ai/artifact/AVQcrN4pj8MdyirzQFyoxJ (v4).

## Direction contract

THESIS: The house is the interface's backdrop and the drawing is the headline. Refuses the category default of a stock-photo hero with feature cards: the first thing a visitor sees is a real plan drawing itself, and every page sits on imagery of the house.

OWN-WORLD: Slightly frosted glass over the exterior render: three tint levels (clear 50% white/blur 14, frost 62%/blur 18, deep 64% ink/blur 18), ink #0F1420, secondary #34404F, Keystone AI blue #1C5A8C, live green #1F7A4C as a dot only. Onest for type, JetBrains Mono only for measurements and briefs. Pill controls, 24–32px panel radii, inner light rim, soft offset shadow. Drawings always on paper, never on glass.

STORY: The visitor sees a plan draw from a real brief, can replay or step through eleven, then scrolls one brief into plan, 3D, elevations, render and cost. They learn what is free and what a passkey unlocks, see the engine behind it, and open the studio.

FIRST VIEWPORT: Exactly one screen under the floating glass nav. Left (~38%): frost card with the h1 "Say the house. Watch it get drawn.", one lead line, Open the studio (primary) and Follow one brief, then "Free, no account needed. Have a passkey? Enter it". Right (~62%): clear-glass live panel: brief chip, prev / count / next, Draw another, the drawing cropped to its own proportion, a draw-progress bar, Replay, and a row of brief chips. Phone: headline card above a shorter live panel, both still inside one screen.

FORM: Code-led rebuild of the user-approved Liquid Glass direction (direction 6 of 6 on the options board; pinned by the user, so no roll was run). Seed key: none (user-pinned). Signature interaction: the replayable plan draw sequence, carried into the scroll story and the studio. Motion grammar: panels settle in from a soft blur once per page, the backdrop drifts slowly, light follows the pointer on glass, and reduced motion resolves everything instantly.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
