# Thirty-day execution plan

## Contract and dependencies

Day 1 begins after the P0 inputs and professional appointments in [02](02-inputs-and-team.md). These are elapsed project days, not a promise that everyone works 30 consecutive days. Staff the work in parallel, schedule review meetings in advance, and include local nonworking days when assigning dates.

Deliver two connected results: (A) one professionally reviewed KMC pilot submission package, and (B) a Nepal workflow with documented tested support and Pokhara validation fixtures. KMC is a planning assumption pending parcel confirmation. No authority approval date is promised.

The engineering file map is in [04](04-engineering-specification.md). All proposed code files are future work. Do not alter the deployed US application as part of this planning exercise.

## Week 1 — settle the site, rules and engineering route

| Day | Action / owner | Concrete output and acceptance |
|---|---|---|
| 1 | Owner + architect: select parcel and program; engineers: pin repository baselines and establish isolated Nepal branches/worktrees | `pilot-brief.md`, site evidence manifest, named reviewers, rollback plan; baseline test results recorded rather than assumed |
| 2 | Architect: reconcile municipal documents; backend engineer: define rule-pack contract | Rule register has source/page, edition, effective date if known, applicability, units, severity, reviewer and unresolved entries; no invented thresholds |
| 3 | Architect + Vaastu consultant: approve interpretation; structural engineer: define required site inputs and analysis route | Signed-off pilot requirements, Vaastu profile v1, engineering input checklist; confirm investigation is available in time |
| 4 | Backend + CAD engineers: define metric site/building model, level representation and coordinate adapters | Schema and sample valid/invalid payloads; exact unit-roundtrip tests; represent three full levels plus partial fourth without truncation |
| 5 | Backend: implement site preflight; frontend: add staged Nepal site/program intake | Show surveyed parcel, actual buildable envelope, area/FAR accounting and unresolved-rule states; early invalid request explanations |
| 6 | QA + architect: digitize reference fixtures; structural engineer: propose pilot frame and core envelopes | At least 12 annotated site/program fixtures, including negatives; independent expected outcomes and approved preliminary geometry assumptions |
| 7 | Whole team: gate review | **Gate A:** applicable jurisdiction confirmed, critical rules reviewed, site/engineering route viable; select initial supported domain and freeze input contract |

Gate A failure: keep work as concept research and resolve the missing evidence. Do not publish a permit-ready status. If investigation cannot complete this month, rebaseline the actual permit delivery date immediately.

## Week 2 — build feasible Nepal plans

| Day | Action / owner | Concrete output and acceptance |
|---|---|---|
| 8 | Backend: implement engineer-approved candidate RC grid and core placement | Columns, beams, stairs and wet cores constrain rooms from the start; no floating columns or illegal site intersections |
| 9 | Backend: multi-level program allocation and linked access | Explicit per-level use/room counts; partial top floor; stairs connect every occupied level/roof destination required by the brief |
| 10 | CAD/geometry: Nepal stair profile and 3D envelope checks | Profile thresholds traced to reviewed sources; sections show clearances against actual beam/slab envelopes and finished levels |
| 11 | Backend: daylight/opening and boundary constraints; frontend: room-level explanations | No windows claimed as daylight on prohibited/blocked boundaries; shafts/courts persist across levels; privacy and access retained |
| 12 | Backend + architect: Vaastu scoring and candidate diversity | Essential preferences enforced or conflict explained; rank only valid candidates; compare room adjacency, core location and per-level allocation |
| 13 | QA + frontend: real-survey fixture sweep and repairs | JSON/CSV/HTML report with exact payloads, seeds, present/missing requirements, violations and true option count; fix dominant causes |
| 14 | Architect + owner: choose pilot option; QA: gate review | **Gate B:** supported positive fixtures return three valid distinct choices; negative cases explain constraints; pilot scheme approved for engineering |

Gate B failure: narrow the explicitly supported domain, preserve reported failure cases and fix their causes. Never manufacture a third option through colors or camera angles. Owner selection locks the pilot's architectural revision; later engineering changes create new revisions.

## Week 3 — coordinate and produce the submission set

| Day | Action / owner | Concrete output and acceptance |
|---|---|---|
| 15 | Structural engineer: analyze selected pilot; CAD engineer: import approved member envelopes | Versioned structure with assumptions, actual foundations/member sizes and calculation reference; no unexplained placeholder reinforcement |
| 16 | Architect + backend: resolve structural feedback | Doors, furniture, stair headroom, daylight and usable areas revalidated after member changes; every resolved issue has evidence |
| 17 | MEP team: approve services layout; backend: store connected systems | Coordinated water/waste/vent/rainwater/electrical routes and equipment; clashes and maintenance access checked; calculations attached where required |
| 18 | CAD engineer: produce architectural sheets from common model | Site, all levels, roof, elevations, sections, stairs, openings and area schedules agree; model-space units and plotted dimensions verified |
| 19 | Structural/MEP engineers: complete project drawings; frontend: coordinated 3D/materials | Reviewed engineering sheets linked to the same project revision; colors and actual opening positions agree with plans |
| 20 | QS + backend: audit quantities and local estimate evidence | Traceable BOQ, quantity variances and dated NPR price evidence; separate waste/tax/labor/freight; unknown quantities clearly excluded |
| 21 | Whole team: interdisciplinary review | **Gate C:** no unresolved critical design clashes; complete required drawing list and calculations; submission lead accepts package for independent check |

Days 15–21 assume structural engineering began with site/grid review in Week 1. Starting engineering only on Day 15 makes the month fragile. Use the engineer's established licensed analysis/CAD tools; do not build a new structural solver in this sprint.

## Week 4 — prove, correct and issue

| Day | Action / owner | Concrete output and acceptance |
|---|---|---|
| 22 | Independent architect/engineer check | Clause-based checklist, redlines and priorities; no self-certified completeness from software tests alone |
| 23 | Engineers + developer: resolve high-severity issues | Corrections propagate through model, schedules, quantities and sheets; revised calculations if load/member assumptions changed |
| 24 | QA: CAD and PDF verification in target applications | Open/import/plot, layer/lineweight visibility, Devanagari fonts, dimensions, closed geometry and drawing cross-reference checks |
| 25 | QA + architect: Pokhara comparison fixtures | Record portable design behavior separately from local rule differences; no unsupported claim that KMC approval carries to Pokhara |
| 26 | QA: complete declared Nepal matrix and US regression suite | Machine-readable results, failures and support table; Nepal request never silently falls back to US/legacy generation |
| 27 | Local submission lead: completeness/pre-submission check where available | Final municipal checklist, owner/site documents and signatures workflow; record authority feedback if received, otherwise say not yet reviewed |
| 28 | Team: contingency and corrective work | Resolve final blockers; confirm that last geometry changes did not invalidate engineering or quantities |
| 29 | Submission lead + owner: controlled issue | Revision-locked PDF/CAD/calculation package and transmittal; local professionals authorize submission; actual submission only via authorized process |
| 30 | Product lead: handover and release decision | **Gate D:** single-project submission-ready evidence, known limitations, next-month backlog, monitored Nepal pilot and explicit US regression status |

## Scope and release controls

Implement in separate development first. Reuse stable components, but require explicit country/municipality routing and preserve US defaults. A preview release can precede a production release; real permit files must carry their specific review state.

Use status transitions: draft → automated checks passed → architecture reviewed → engineering coordinated → approved for submission → submitted → authority response. Store who approved which content hash/revision. Any geometry, load, occupancy or rule change invalidates dependent approvals automatically.

If the automated generator is late but the professional team can complete the pilot, deliver the reviewed project using documented manual CAD/engineering steps. Label those steps honestly and retain them in the automation backlog. Do not present a manually finished reference project as proof of universal automatic coverage.

## Beyond the month

Expand to a second municipality's real submission; increase supported plot/program families; calibrate daylight and quantity references; automate more reviewed structural data exchange; expand MEP calculations jurisdiction by jurisdiction. Permit-review feedback should drive the order. Universal coverage means a defined supported domain plus honest infeasibility handling, not success for physically contradictory briefs.
