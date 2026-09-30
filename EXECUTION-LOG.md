# Keystone Nepal â€” execution and handover log

## 2026-09-30 â€” research and one-month plan

### Request and decisions

- Owner requested a separate Nepal folder, deep research and a month-long transition plan; Kathmandu Valley and Pokhara Valley are the target markets.
- Owner confirmed the month-one objective is permit-submission drawings for one municipality. Plan assumes KMC first, pending actual parcel confirmation; Pokhara is the second validation jurisdiction.
- Owner clarified that users start with side lengths in the survey and final drawings are professionally verified. Adopted approximate/measured/verified geometry states; irregular shapes need additional shape-defining information.
- Owner requested half-turn stairs with a landing as the default, with alternatives selectable. Added this to the survey and model specifications.

### Work performed

- Used the lean-build skill for scope, reuse seams and acceptance gates.
- Inspected current repository seams in `backend-keystone` and `frontend-keystone`; recorded HEADs `763f2b3` and `5e93363` respectively.
- Confirmed current support matrix rejects above two storeys and the stair-profile baseline contains IRC dimensions. A Nepal route needs substantive model/validation changes.
- Researched DUDBC/KMC/Pokhara primary references, professional registration, US MEP publishers and connected-services/daylight references.
- Created this planning folder and eight supporting Markdown documents (README plus numbered documents 01â€“07), with a daily schedule, file map, input list, source limitations and release criteria.
- No application code, environment, account, production deployment or existing US behavior changed. No generation tests were run because this task produced a plan, not engine changes.
- Verified all local Markdown links resolve. Backend/frontend working trees remained clean after the planning work.

### Findings and limits

- NBC 105:2025 and NBC 206:2024 are officially listed; permit applicability must still be confirmed locally.
- 70% coverage, flush boundaries and excluded parking are not verified universal rules.
- Current engine requires explicit support for partial third/fourth levels, RC member envelopes, local stairs and services.
- Online government PDFs had intermittent timeouts; a complete numerical code review is outstanding, clearly identified in the source register.
- One month can target one professionally reviewed submission project with a staffed team and early site evidence. It cannot credibly promise all-plot automated permit designs across both valleys.

### Next agent: exact starting point

1. Read README, owner-input checklist and daily plan. Preserve the latest owner clarifications above.
2. Confirm the actual permit municipality/ward/parcel and local reviewing professionals. Do not assume â€œKathmandu Valleyâ€ uniquely selects KMC.
3. Obtain current local rule documents, one approved complete drawing set, actual site information and preferred Vaastu reference. Users can explore with side lengths; the real permit project needs verified evidence.
4. Start a rule register with the schema in `04-engineering-specification.md`; mark unresolved values, never invent them.
5. Recheck current repository HEADs/status before isolated development. Capture actual baseline tests and active data-flow routes.
6. Follow Day 1 onward in `03-thirty-day-plan.md`; record actions, decisions, evidence, failures and next steps in this log on each implementation step.

No implementation is claimed complete. Future agents should not mistake proposed module names, test counts, staff estimates or daily tasks for delivered capabilities.

## 2026-09-30 â€” supplied-reference knowledge system

### Owner instructions incorporated

- Read/convert `Design Files`, distill Vaastu house-design principles and make references retrievable for future floor-plan work.
- Vaastu is highest among design preferences; mandatory safety/legal and essential program constraints remain eligibility gates.
- Owner added NBC 105:2025 during work, followed by the June 2023 MoFAGA/PLGSP building-bylaws/permit resource book. Both are included.
- Share national principles across Kathmandu Valley, but retain municipality/ward for local adoption, soil and site-specific rules. No exact pilot parcel is confirmed by this task.

### Delivered

- `knowledge/sources/`: all 15 supplied documents converted to page/EPUB-section Markdown; original files preserved. EPUB illustrations extracted and linked.
- Source manifest/hashes, SQLite full-text index, source index, local JSON query CLI and Python functions. Old draft seismic commentary excluded from default search.
- `DESIGN-PRINCIPLES.md` and generated `RULE-CATALOG.md`/`rules.json`: 93 rules spanning safety/code, current seismic reference, area/bylaws, Vaastu core/details and architecture.
- `knowledge/tools/knowledge.py`: retrieval, context assembly, conservative fact checks and lexicographic Vaastu ranking. Missing facts/manual checks prevent a false complete result; no raw-polygon geometry evaluator is claimed.
- `area_accounting.py`: separate FAR/coverage arithmetic with explicit inclusion evidence, unknown propagation, duplicate checks and a labeled coverage-threshold candidate from the resource book.
- `INTEGRATION.md`, `CODE-REVIEW.md`, local `AGENTS.md`: retrieval instructions, source conflicts, exact next engine seams and limits.

### Evidence and what was learned

- Visually checked NBC 206 physical pages 14â€“17, NBC 205 page 16, Chakrabarti page 140, selected NBC 105:2025 cover/preface/soil/irregularity/separation pages, and resource-book pages 15/51/52/54. Rendered evidence is under `knowledge/review/`.
- NBC 105:2025 has sparse/scanned pages. Ran local RapidOCR on 15 flagged pages and preserved unverified supplements in `knowledge/ocr/nbc105-2025.json`; Nepali/equations/table order still require original-page review.
- Resource-book page 54 describes residential/mixed coverage 70% up to 250mÂ² and 60% above. Page 15 and page 52 conflict on basement/balcony floor-area inclusion. Catalog preserves conflict rather than silently adopting either. Local instrument confirmation remains required.
- NBC 205's bare-frame treatment does not mean that no brick walls exist; actual infill treatment requires engineering. NBC 105:2025 includes municipality/ward-specific soil context.
- Vaastu sources conflict on stairs, children rooms, dining and entry; Jain itself contradicts its S/W entry guidance. Chosen default is explicitly Jain-led with conflicts and alternatives, not a fabricated universal consensus.
- Source conversion does not establish complete diagram understanding or a complete current legal review. This pass read relevant architectural/area/Vaastu sections and indexed all supplied material for continued targeted use.

### Tests and environment

- 28 focused unittest checks pass, covering all-input coverage, citation validity, latest-code retrieval, old-commentary exclusion, source drift, unknown/applicability behavior, numeric boundaries, mandatory gates, preference ranking, and area-ledger arithmetic.
- Rebuilt twice successfully after fixing Windows SQLite replacement failure: Python sqlite context managers do not close connections; used explicit `closing` for all read handles.
- The all-input test caught the resource book newly arriving during work; added it to the source registry and rebuilt.
- Python 3.13 environment had pypdf 6.16.2. Optional OCR dependencies installed only under `tmp/nepal-ocr-tools`: PyMuPDF 1.28.2, RapidOCR 3.9.2, ONNX Runtime 1.30.0 (plus dependencies). No production package manifests changed.
- Backend/frontend working trees remained clean. No website deployment, production routing or generation behavior changed.

### Next agent

1. Start at `knowledge/README.md`, query rules/source pages for the active topic and inspect `CODE-REVIEW.md` before numeric enforcement.
2. Confirm selected Vaastu interpretation and implement reviewed coordinate domains/polygon classifiers in an isolated Nepal engine. The current evaluator consumes supplied facts; it does not measure them.
3. Resolve current local area-accounting definitions and exemptions; implement non-overlapping polygon ledgers before using the arithmetic utility on real models.
4. Connect code/essential requirements to feasibility and Vaastu to early candidate allocation plus ranking. Preserve source/rule/model revision evidence and per-room explanations.
5. Keep professional review and unresolved source clauses explicit; never turn manual-review items into passes just to allow ranking.

## 2026-09-30 â€” independent local website and backend execution plan

### Delivered

- Copied 654 tracked source, test, script and asset files from the active backend-keystone and frontend-keystone into Keystone Nepal/local. COPY-MANIFEST.json records original SHA-256 hashes, commits and 14 explicit exclusions. Excluded deployment configuration, credentials, environments, Git metadata and generated/dependency folders; installed independent dependencies afterward.
- Active backend already includes the generator, furniture, CAD, estimates, quick 3D and account code. Earlier alternate service repositories are not dependencies of this version and were not substituted for it.
- Added local startup tools, allowlisted environment, cloud-start refusal, backend outbound TCP guard, loopback ports 5299/8299, frontend same-origin policy, and noindex. Removed external font requests. Frontend preview conversion is refused. Backend security policy export and applied headers now agree.
- Added LOCAL-DEVELOPMENT.md and BACKEND-EXECUTION-PLAN.md, and updated README. Detailed plan covers schema, plot reconstruction, rule adoption, area ledger, RC reservations, multi-level cores, NBC stairs, Vaastu allocation, diversity, refinement, consistent exports, quantities, MEP and coverage evidence. No Nepal generation behavior was implemented in this copy/setup task.

### Verification and findings

- npm ci completed in both independent folders. Workstation Node 24.19.0 differs from inherited backend requirement 20.x; record and resolve runtime parity before release testing.
- npm run build: passed, final build 2.12 seconds; inherited large-bundle warning remains.
- npm run test:isolation: 4/4 passed (credentials/preload isolation, blocked outbound TCP, rejected cloud startup, independent dependency directories).
- Edge browser smoke: local landing rendered, body text present, no JavaScript errors and no remote requests observed. Screenshot: local/runtime-home.png. Initial smoke exposed Vite development preamble CSP blocking and Google Fonts requests; allowed inline scripts only in the development-server policy and removed remote font links. Built backend policy retains same-origin scripts.
- GET /api/health through frontend proxy: 200, runtime local, externalServicesEnabled false, photoreal off, automaticRepair off.
- POST /api/plan: 200; baseline 1800 sqft two-storey US brief returned a plan with two alternatives. This verifies local wiring, not Nepal coverage or a new independent diversity audit. Response: local/runtime/smoke-plan.json.
- GET /api/me with a local development identity: 200. POST /api/plan/model with that identity and the same generated plan: 200, valid glTF header, 1,160,112 bytes. Artifact: local/runtime/smoke-house.glb. Anonymous model request correctly returned 401 before the authenticated check.
- Attempted full inherited backend suite; stopped after several minutes inside architect-v2-consistency-matrix.test.js. Partial log: local/backend-tests.log. No full-suite pass is claimed. Run bounded baseline groups before Nepal engine changes and schedule the large matrix separately.
- Rehashed all 654 original source files: zero changes. Both original backend/frontend git status outputs clean. No deployment, live account integration or public routing changes.

### Limits and continuation

- Accounts/projects/credits are in-memory and reset with the backend. Development key is a local nonsecret test convenience, never a future production credential.
- Remote Gemini/photoreal/billing/email remain disabled; Blender assets/executable and dedicated Python CAD/XLSX environment are not provisioned or smoke-tested in this task. Code is retained; external dependencies require separate local setup.
- Network guard is defense in the Node entrypoint, not an OS sandbox for future Python binaries or shell commands. Preserve the no-production-contact rule.
- Local server was left running on 5299/8299 at handover. Restart it after backend changes. No new Git repository or commit was created; source provenance is in COPY-MANIFEST.json. Establish independent version control without a production remote before extended implementation.
- Next exact task: Milestone B in BACKEND-EXECUTION-PLAN.md. Add Nepal schema, explicit units/levels, plot sufficiency checks and three fixtures (rectangular 2.5-storey, surveyed irregular 3.5-storey, ambiguous plot rejection). Then implement reviewed rule-pack applicability and polygon area accounting. Keep the main product untouched; branding, publication and payments remain deferred.

## 2026-09-30 â€” Milestone B: Nepal brief, rental program and account-free local testing

### Delivered

- Added `local/backend-keystone/lib/nepal/briefSchema.json`, `units.js`, `normalizeBrief.js`, `preflight.js` and `localAccess.js`. Metric, square-foot and ropani/aana/paisa/daam inputs normalize to millimetres/square metres. The governmental construction handbook conversion table is cited in `MILESTONE-B-EXECUTION.md`.
- Site contract records municipality/ward, rectangle or surveyed polygon, measured sides, true-north evidence, frontage/road width, neighboring edge context, optional proposed setbacks, survey revision, terrain/plinth/flood/access notes and declared plot area. It refuses ambiguous irregular side lengths, crossed polygons, inconsistent measurements and missing evidence. The input-quality tolerances are provisional checks, not code provisions.
- House program stores explicit full/partial levels for 2.5 and 3.5 storeys; per-level bedrooms/bathrooms/living rooms/kitchens/attached baths/special rooms; parking, stair, laundry/roof/balcony and accessibility/utility notes. Owner brief is distinct from rental floors. Added user-requested independent rental flat counts, self-sufficiency checks and continuous shared stair access outside each private unit. Default wardrobe is for the primary bedroom only; other bedrooms are opt-in.
- `/api/plan/preflight` routes Nepal-shaped briefs to Nepal validation. `/api/plan` stops them with a clear `NEPAL_GENERATOR_PENDING` response after a complete brief (or specific missing/conflicting fields before that). This prevents an inaccurate US plan from being represented as Nepal-compliant. A complete input is not a validated legal or structural design.
- Added `frontend-keystone/src/studio/NepalBrief.jsx`. It is the default local Studio mode with a switch to the copied Existing engine. The Nepal form checks inputs and explains why generation is pending. Rental intent opens floor counts, floor ownership, rental flat and owner home questions.
- The local launcher sets `NEPAL_LOCAL_STUDIO=1`; the backend supplies a fixed in-memory local identity and full available-feature access, while the frontend uses the same identity automatically. No login, payment or developer key is needed. This flag is restricted to the local runtime; inherited account tests run with it off. Available downloads, quick 3D, editing and local projects no longer require credentials. Photoreal/Gemini stay unavailable because the local renderer/assets were not provisioned; the UI says so rather than prompting for an account.
- Hid account/pricing prompts from the local landing, navigation, FAQ, pricing and projects views. The copied US backend remains available for local comparison and exports. No main Keystone source, deployment or cloud account was changed.

### Verification and lessons

- 8/8 Nepal focused tests pass; 4/4 local isolation tests pass; isolated frontend build passes.
- Headless Edge local smoke passes: no sign-in prompt, missing site evidence shown, completed brief accepted, rental controls visible, Existing engine switch works, zero runtime errors and zero remote requests observed.
- No-credential API smoke: three complete Nepal fixtures reach preflight then stop before candidate generation; ambiguous irregular plot asks for surveyed coordinates; local project creation returns 201; existing US engine returns a plan and two alternatives. GLB, DXF, XLSX exports return 200 without a token. DXF opens with ezdxf AC1024 and has zero audit errors/fixes.
- Selected inherited tests: 20 passed, one stale DXF smoke failed because it references `local/frontend/app.jsx`, a legacy frontend file outside the active copied website. Direct active DXF API/audit passed. Full inherited backend suite remains unfinished; see preceding entry.
- Rental access is a saved requirement, not installed physical stair geometry. The future planner must reserve a continuous stair outside units, verify every entry, place it on a feasible side and check egress, setbacks and structural continuity. Owner upper floors are one home; rental flats are independent. The first profile marks rental above owner and separate rental on a partial top floor unsupported with clear messages.

### Exact next work

- Begin Milestone C in `BACKEND-EXECUTION-PLAN.md`: bind reviewed national and municipality/ward rules to a site, resolve current floor-area treatment, and implement non-overlapping polygon area/coverage/FAR ledgers. Do not replace the `NEPAL_GENERATOR_PENDING` gate until rule and site/structure/core validators actually exist.
- Keep test fixtures for rectangle 2.5, irregular 3.5, two-rental-floor 3.5, ambiguous irregular survey and invalid rental flat. When design begins, add rental circulation/core geometry tests and a measured fulfillment report for every input selection.
- Establish separate local version control before extended engine work. Repair or retire the inherited legacy DXF smoke path and run the large inherited consistency matrix as a bounded separate batch. Node runtime parity remains a release gate. Local projects are ephemeral; persistent storage is later work.

### Final verification and smoke reliability

- Re-ran 8 focused Nepal tests and 4 isolation tests: all passed. The isolated frontend build passed. `briefSchema.json` parsed successfully.
- Re-ran the headless Edge Studio flow: no sign-in prompt, ward/north preflight guidance, completed Nepal brief, rental controls and existing-engine switch all passed, with zero browser runtime errors and zero remote requests. The smoke now clears its own persisted Nepal draft before starting; an earlier rerun had inherited the previous smoke run's rental toggle and falsely expected the default non-rental brief.
- Rehashed all 654 manifest source paths: zero original files changed or missing. The original backend and frontend Git trees are clean.

## 2026-09-30 - Milestones C-F foundations, rectangular survey and reservoir

### C: rule and area work

- Added source-hash-checked catalog builder and compiled 92 current operational rules. The older seismic commentary rule is documented as an exclusion, never imported as a live numeric threshold. Added a Kathmandu-only profile with official eBPS/NBC references, including 2082 and 2083 amendment PDFs downloaded under `local/runtime/reference-review/` and pinned by SHA-256 in the profile. The 2083 amendment changes selected parking/FAR treatment and requires a recharge pit for plots above four aana. This is evidence that a blanket 70% plot rule and a single valley-wide profile would be unsafe. Exact adopted parcel parameters remain null pending architect review.
- Added `areaLedger.js` for non-overlapping orthogonal categories, union, voids, outside-site checks, independent coverage/FAR and exact-limit evaluation. Synthetic boundary tests and measured L/court cases pass. This does not resolve legal inclusions/exclusions.

### D: footprint, frame and core

- Added `siteEnvelope.js` with explicit four-edge setbacks and rectangular, two L and U/court house footprints on a rectangular plot. No legal zero-setback inference. Added `frameGrid.js` planning axes and stable column IDs, plus `corePlanner.js` east/west shared stair reservation across levels. The underground reservoir is reserved below the stair with 8,000 L effective default, 5,000 L minimum and calculated wet depth. Above available depth, the search rejects it rather than squeezing the tank. These are planning reservations, not a structural design.
- Viewed multiple provided reference PDF sheets. Newplans sheets 2-3 show a surveyed irregular parcel but a rectilinear framed and stepped house, a court/open zone and parking; other sheets show different cores, roofs and formal schedules. The site input was simplified to rectangle, not the house massing grammar.

### E: stair assembly

- Added `stairProfile.js` with NBC 206:2024 residential numeric thresholds as a provisional scope-labeled profile, exact rise division into two flights, tread runs, landing geometry and required core dimensions. Tested even and odd riser totals. Headroom under real beams, slab opening, doors, occupant-load sizing, handrails and 3D/CAD parity remain unverified and block validation.

### F: directional facts and spatial hypotheses

- Added `vastuDomains.js`, `vastuAllocator.js`, `roomPlanner.js`, `candidateSearch.js` and `validateNepalPlan.js`. Directional zones use true-north transforms and polygon clipping; missing L corners are not counted as built area. Search tries massing, core side and room order, rejects non-fitting rooms, and ranks core Vaastu preferences before smaller preferences. The 3x3 method remains a consultant-review convention.
- A two-rental-floor 3.5-storey fixture yields three different spatial hypotheses, with bedrooms, bathrooms, kitchens, living rooms, puja and guest bedroom retained. Dense program makes L/U layouts reject rather than silently drop rooms. Each hypothesis has unresolved legal, structure, daylight/opening, stair headroom, door/wall/egress and reservoir-detail blockers. They are not released as architectural floor plans. `/api/plan` continues to return an explicit unsupported result.

### UI and verification

- Simplified `NepalBrief.jsx`: rectangular width/depth plot, collapsed optional site/level/service panels, program totals derived from per-floor entries and editable reservoir capacity. Local sign-in-free Studio browser smoke passed with no remote requests or runtime errors. Focused B/C/D-E/F tests passed (24 total at this point); isolated frontend build passed. New API preflight returns `KMC_RULE_REVIEW_REQUIRED` for a complete Kathmandu brief while keeping `contractReady=true` and an 8,000 L reservoir in the normalized brief.
- Current exact checklist and remaining gate work: `C-TO-F-EXECUTION.md`. None of C-F is certified permit-ready. Main public backend/frontend were not edited or deployed.


### Subsequent visual and adversarial review

- Added `local/tools/nepal-hypothesis-gallery.cjs` and rendered `local/runtime/nepal-hypotheses/index.html` plus a local PNG preview. The visual audit showed that dense rental/owner programs currently select only rectangular full-floor massing; three hypotheses differ mainly by east/west core and room ordering. The L/U families correctly reject where bathrooms, corridor or owner program do not fit, but the result does not meet the desired architectural variety or drawing-level quality.
- Added explicit validation blockers for attached-bath access, bike/car parking and gate, ground-rental RC configuration, room dimensions, and room openings. The search must not hide these missing physical facts behind a Vaastu score.
- Added an overconstrained 8 m? partial-top fixture: all 24 search attempts reject with reasons and zero candidates. No floor is dropped. Current focused Nepal suite: 24/24; isolation: 4/4; frontend build and headless browser smoke passed.


### Compatibility check

- Ran selected inherited US survey, stair and preflight contract tests in the copied backend: 32/32 passed. This is a bounded regression check, not a full inherited-suite pass. The complete expensive consistency matrix remains a separate gate.
- Source-drift checking now verifies the compiled rule and manifest hashes plus original source-file hashes at runtime (cached by file metadata). The area ledger now counts a roofed court in coverage while preserving its floor void. U-court concepts reserve at least 3 m x 3 m clear court geometry before any daylight claim.

### Subsequent opening and area-accounting pass

- Added `local/backend-keystone/lib/nepal/spatialReservations.js`. Each proposed room door now needs a real shared boundary and at least 900 mm clear width with corner margins (800 mm for the provisional bathroom door). A 900 mm unit entry is reserved at the shared core/corridor boundary. These are abstract wall-line intervals; actual wall construction, door swings, fire separation, landing alignment and egress are still unverified.
- Checked windows against exposed faces of the actual footprint slab union. A room cannot claim an exterior opening on a wall backed by another slab. The provisional clear width derives from the existing NBC 206:2024 hilly-region opening-area demand and an explicit assumed 1,200 mm clear opening height; no legal exposure or daylight performance is claimed. North/south end walls are searched when an east/west side is blocked.
- This caught an owner-floor layout flaw: the requested puja enclosure takes the living room's side façade. The `living-first` layout can reserve the living-room window on the physically exposed south face; `bedrooms-south` can use the north face. `kitchen-south` still lacks a physical living-room window and now carries `NO_PHYSICAL_EXTERIOR_WINDOW_RESERVATION`. Search ranks such known physical-placement defects below candidates without them, before Vaastu preference scoring; it does not call any candidate valid.
- Corrected the area ledger to union overlapping rectangles **within** one regulatory category while still rejecting overlaps between different categories. The earlier implementation contradicted its exact-union contract for one-category overlapping slab pieces.
- Updated the local review gallery to display door (brown) and window (blue) reservations. Regenerated `local/runtime/nepal-hypotheses/index.html` and visually inspected the Edge screenshot `preview.png`. The three selected results still have rectangular massing; architectural variety remains an open gate.
- Focused Nepal suite: 29/29 passing including stepped exposure, real shared doors, exterior end-wall fallback, room opening reservations and same-category area union. Local isolation: 4/4 passing. Both original backend/frontend Git trees are clean. The Nepal generator still returns `NEPAL_GENERATOR_PENDING` and requires adopted municipal rules, engineer/architect review, walls, door swings, services, parking and export parity before enablement.

## 2026-09-30 — owner architect review path and measured working plans

- Owner clarified that they are a Nepal Engineering Council-registered architect/engineer and want to inspect the designs now. Reframed C-F gates as permit/verified-design gates, not a reason to suppress local review. Documented every accepted working assumption and example calculation in `WORKING-ASSUMPTIONS-AND-CALCULATIONS.md`: 1 m default setbacks, owner-provided 70% provisional coverage cap, no claimed FAR limit, 3 m stair rise, 8,000 L tank, aperture sizing, 300 mm planning columns and true-north convention.
- Visual inspection of the earlier room-box gallery exposed a real stair error: the entry reservation was at the +1.5 m intermediate landing. `stairProfile.js` now has 1 m lower/upper floor-level arrival pads; the 900 mm door is constrained to that plan interval. The 3 m example requires 16 × 187.5 mm risers, two 8-riser flights, 1,890 mm run each, 1,000 mm mid landing, 1,000 mm floor pad and 4,290 mm minimum working core length within the 5,200 mm reservation. Vertical clearance, slabs and swings still need detailing.
- The previous regular 300 mm column grid placed columns *inside* the 1 m unit corridor. `frameGrid.js` now anchors column boxes outside the corridor clear rectangle and retains stable axes for all full levels. This avoids an obvious circulation obstruction but does not certify the resulting 5.35 m planning bay or seismic response.
- Added `workingAssumptions.js`, a concept-only 70% coverage check in candidate search, and `reviewSheet.js`. The review document measures the 11.25 m reference plot at 126.5625 m²; 1 m per-edge working setbacks leave an 85.5625 m² rectangle (67.60% coverage). It shows all floors, rooms, areas, windows, stair treads/pads, tank and provisional columns. The sum of floor *envelopes* is 221.125 m² for the 2.5-storey fixture and 296.6875 m² for the 3.5-storey rental fixture; no legal FAR is inferred.
- Added `POST /api/nepal/concepts`, available only in the isolated local runtime, and the Studio **Open working plan review** button. A completed user survey now opens its own review HTML in a new tab without account, credit, cloud or external call. The existing Nepal `/api/plan` remains blocked because drawings/3D/CAD/structure and permit assumptions are not yet coordinated. Static two-fixture review: `local/runtime/nepal-plan-review/index.html`; JSON summary and an A3 PDF are alongside it. The printable PDF spans multiple pages; HTML is the primary detailed review medium.
- Verification: 32/32 focused Nepal tests; 4/4 isolation tests; local frontend build passed (existing generated CommonJS/chunk-size warnings); static review visually inspected in Edge; local API returned 200 HTML for the rental fixture; Playwright Studio flow opened a review tab with three options and nine floor diagrams for the default 2.5-storey brief, zero runtime errors and zero remote requests. Main Keystone backend/frontend remain unchanged.
- Immediate architectural issues visible in the review: overlarge bathrooms/puja and kitchen in some options, narrow un-finished corridor, only rectangular selected massing, no actual wall thickness, attached-bath access, bike parking/gate, wet shafts, beam/soffit headroom, slab openings or elevations/sections. The owner can annotate fixture/option/floor/room IDs; those corrections should drive the next planning iteration.

## 2026-09-30 — Nepal residential details and ten numbered architect-review plans

- The owner specified preferred 10–14 ft bays, nominal 350 × 350 mm columns, 102 mm inner and 229 mm outer brick walls, one four-column cell per bedroom/kitchen where feasible, and combined kitchen/dining by default. The local grid now caps adjacent axes at 4,267 mm, draws 350 mm columns and nominal brick wall bands, coordinates door/window voids away from columns, labels nominal clear room sizes, and flags rather than hides main-room grid crossings and columns entirely within clear rooms. The 11.25 m reference plot still cannot fit two preferred 10 ft cells beside the 2.6 m stair core and 1.102 m wall-line corridor: 6.096 + 2.600 + 1.102 = 9.798 m required against 9.250 m available, short **548 mm**. Red-outlined in-room columns are visible in the ten-plan drawings. This is an unresolved topology defect, not an approved exception.
- User-supplied domestic conventions are now data in `local/backend-keystone/lib/nepal/residentialDetails.js`: 914–1,219 mm kitchen balcony depth preference, conditional bedroom balcony and top-level tulsi muth, plaster/putty/paint, carpet/parquet or tile finish intent, seven-seat corner sofa/TV/coffee table, 1,000 mm kitchen counter and cabinet/appliance intent, no default bathtub, 1,500 mm bathroom wall tile and full-height shower wall. A 305–610 mm non-flush-side rain chajja preference was added. **None of these furniture, finish buildup, balconies or chajjas is physically drawn or quantity-measured.** Requested balcony levels produce `REQUESTED_BALCONY_NOT_PLACED`, rather than being silently ignored. The exact matrix and next implementation files are in `RESIDENTIAL-DESIGN-CONTRACT.md`.
- New local Studio drafts put the puja room on the partial top owner floor; existing saved survey choices stay intact. The room planner now permits a puja-only owner partial floor with an area-matched deeper partial footprint. The ten-plan review tool moves each fixture's puja to its partial top floor without altering the historic regression fixtures. The room is behind a reserved owner unit entry; privacy lock/control and roof-terrace enclosure remain explicitly unverified. This is a review convention, not a universal rule requiring every user to select that floor.
- Reserved the owner's door hierarchy: a 1,200 mm double-leaf wooden outside entry to the ground stair, a 1,000 mm single-leaf wood unit-floor entry, 900 mm single-leaf wood ordinary room entries, **750 mm** single-leaf wood bathrooms and 1,200 mm leafless kitchen portals with optional decorative arch. The 750 mm bath size supersedes the owner's approximate 700 mm after retrieving supplied NBC 206:2024 section 2.2.1 A, physical PDF page 12, which permits 0.75 m for toilets/verandahs. The wider floor door required a **1,400 mm floor-level arrival pad**: `1,400 + 1,890 flight run + 1,000 intermediate landing + 400 edge allowances = 4,690 mm` working core length inside a 5,200 mm reservation. Real door leaves, swing arcs, exterior landing, egress and fire/privacy separation are still unverified.
- `local/tools/nepal-ten-plan-review.cjs` creates `local/runtime/nepal-ten-plan-review/index.html`, `review-plans.pdf`, `summary.csv` and `summary.json`. Plans 1–4 are the 2.5-storey owner brief; Plans 5–10 are the 3.5-storey two-rental-plus-owner brief. All ten have distinct measured geometry hashes. Four rental options (5–8) have no column box entirely inside a nominal clear room; 5–6 also align entries opposite living. The other six have 2–3 interior-column findings each. **All ten still have main-room grid-cell exceptions and only rectangular full-floor massing**, so they are critique prototypes, not ten successful architectural designs. The exact per-plan metrics are in `TEN-PLAN-ARCHITECT-REVIEW.md` and the CSV.
- What this revealed: minimizing actual in-room columns can coexist with planning axes crossing rooms because some columns sit at room boundaries; that distinction needs an engineer-reviewed wall/beam scheme. Moving puja to the partial top creates a second issue: the current partial slab outline does not separate enclosed volume from open roof terrace. Validation now reports `PARTIAL_TOP_TERRACE_ENCLOSURE_UNVERIFIED`. The next structural/architectural iteration should fix topology and terrace enclosure before furniture or 3D styling. The Nepal generation endpoint remains intentionally gated; the local review endpoint remains available without accounts.
- A further geometry pass added `rainChajja.js`: it draws a provisional 305–610 mm edge projection only where its bounding box stays inside the measured parcel and does not collide with a slab. With a 1 m working setback on the 11.25 m sample plot, 610 mm overhang leaves 390 mm to the plot line. This proves only site containment; it does **not** establish local permission to occupy a setback or cover/projection accounting. The preferred 914–1,219 mm kitchen balcony cannot simply be hung from a wall 1 m inside the plot: the 1,219 mm end would project **219 mm beyond the lot line**. Balcony location/footprint change and legal/structural review remain necessary.
- Final verification after rain-projection and bathroom-width edits: focused Nepal suite **48/48** passing; the ten-plan generator checks the expected 4 + 6 count and ten unique geometry hashes and regenerates its A3 PDF with `--pdf`; Plan 5 was visually inspected with the pale-blue projected chajja. Local frontend build passed with existing generated CommonJS/chunk warnings; isolation **4/4** passed; the local backend/frontend were restarted and Playwright Studio smoke opened three options and nine floor diagrams without runtime errors or remote requests. Original backend/frontend Git trees were clean at the earlier check; no files in them were edited during this pass. The local dev server remains available at `127.0.0.1:5299` and `127.0.0.1:8299`.

## 2026-09-30 — Plan 1 and Plan 5 architect-feedback iteration

- Inspected supplied Nepal reference PDF plans for compact W/Cs and parking/living arrangements (Jivendra p. 2, compiled 2.5.2020 p. 2, FEB 3 p. 1). Used those as dimensional precedents, while keeping owner preferences and source-linked NBC checks separate from adopted municipal law. The MoFAGA/PLGSP resource book physical PDF p. 56 indicates a 1.5 m neighbor-opening-side reference in its illustrated guidance; default 1 m review setbacks are therefore marked as an opening-clearance shortfall, not accepted as a legal window location. KMC site, road and height applicability still require the adopted rule.
- Rebuilt the rectangular core reservation into a dedicated 2,600 × 4,585 mm half-turn stair bay with four corner planning axes and a 4,235 mm corner-axis span. The 8,000 L target reservoir uses a 2,100 × 3,900 mm internal bay and 977 mm wet depth (8,001.63 L net) within this core. Both are planning geometry, with frame/tank/headroom detailing outstanding.
- For the 2.5-storey owner example, shortened the full rectangle to 9.25 × 8.85 m so the selected review has 12 column boxes rather than 16 and remains below the working coverage cap. The ground floor now has an open 2.85 × 4.585 m two-bike bay at the front, floor entry to living, open kitchen/dining suite, a compact shared W/C and service room. The first floor now has a common family landing and cross hall, direct primary-bedroom attached bath, two more near-3 × 3 m bedrooms and a family balcony entered from the common hall. These choices reduce but do not eliminate all main-room grid-cell exceptions or confirm bike-gate manoeuvring.
- A later Plan 1 pass reserved a separate 900 mm rear service exit from the open kitchen/dining annex, preserving the kitchen's daylight window on its narrower rear wall and avoiding planning columns. The available rear service strip is 1.4 m on this sample; door swing, legal boundary treatment and a continuous route to that exit are explicitly unverified. Other owner ground layouts report the missing exit rather than silently implying it exists.
- For the dense two-rental-floor example, made living and combined kitchen/dining adjacent in the front structural row, two bedrooms off a short cross hall, and a 2,600 × 1,525 mm nominal shared bath off the hall. A narrow longitudinal service corridor initially passed a column and left less than 1 m clear: visual inspection exposed that error. Removed it; the remaining rear bay is an explicit optional 6.6 m² service niche entered from the adjoining bedroom. Added a circulation-column obstruction validator so this error is reported and ranked as a physical defect if it recurs.
- Updated horizontal shared-edge door reservation, coordinated multi-window placement, wall/open-zone geometry, review rendering, per-plan CSV metrics and targeted tests. Regenerated `local/runtime/nepal-ten-plan-review/` with ten distinct geometry hashes and inspected the Plan 1 and Plan 5 PDF sheets. `TEN-PLAN-ARCHITECT-REVIEW.md` is the current review key; the older working-calculations document is explicitly marked as a historical geometry snapshot.
- The open issues are material: dense rental Plan 5 still has no requested parking bay, and its owner level has no direct attached bath or family balcony. Both programs use red-marked 1 m boundary windows that fall short of the cited 1.5 m reference guidance. Full-floor massing remains rectangular, partial-top terrace enclosure is unresolved, and all frame/egress/tank/fixtures and adopted municipal checks remain unverified. Therefore no option is released as a permit or construction drawing. The original public Keystone source was not changed.
- Verification for this iteration: **53/53** focused Nepal tests and **4/4** isolation tests pass. Ten-plan HTML/CSV/PDF regenerated with ten distinct layouts. An attempted full inherited backend run was stopped because it stalled beyond the focused pass with no further test output; it is not claimed as passed. The local PDF sheets for Plan 1 and Plan 5 were visually inspected after the final corridor change.
- Restarted only the isolated Nepal local launcher after the code changes; backend health and frontend root both returned HTTP 200 at `127.0.0.1:8299` and `127.0.0.1:5299`. Current local launcher PID was 35172 at this check. No deployment was attempted.
- After adding the rear kitchen-suite service exit and its drawing label, regenerated the ten-plan PDF again and reran the focused suite: **53/53 passed**. Restarted the isolated local launcher once more (PID **17700** at final check); both local endpoints again returned HTTP 200. The earlier 35172 PID was superseded.

## 2026-09-30 — deeper Nepal precedent study and drawing communication

- Applied investigate-first: the unreadable doors were opening intervals rendered as colored lines; the missing chajja corners were absent geometry from independently generated edge strips. Added single/double proposed door leaves and dashed swing arcs with a main-entry label in `reviewSheet.js`. They show a proposed inward swing, not a collision-verified door assembly. Kitchen open portals retain leafless symbols.
- `rainChajja.js` now joins perpendicular exposed strips at convex corners only when the corner box stays inside the parcel and outside floor slabs. Existing strip API remains intact; corner reservations are separate. Tests measure the complete rectangular projection-ring area and prove no corner extension at omitted flush/too-narrow faces.
- Re-inspected supplied Mandip/newplans p. 3, compiled Baluwatar pp. 2–3, Jivendra pp. 2–3 and Madhav p. 1, including raster visual review of the first three. Identified usable lessons and incompatible precedents (larger floor sizes, 19 ft bay and internal family-room column). Do not indiscriminately import those into the small-plot owner constraints.
- Researched architects' primary project accounts (Studio NEBA S Residence and Brownstone), EERI/IAEE traditional Newar housing report 99, the SpaceLayoutGym PPO paper, and OR-Tools CP-SAT documentation. Findings and links are in `NEPAL-SPATIAL-PLANNING-RESEARCH.md`. Retrieved NBC 206:2024 physical p. 17: a habitable-room internal court reference of 3 × 3 m, daylight distance and opening-area requirements. Bathroom shafts remain a separate unverified scope.
- Specified a coupled topology/geometry/structure/void model, hard constraints, objective tiers, polygon/furniture/access validators, benchmark and optional later RL policy. The present strip generator cannot produce the needed search space. **No learned agent, polygon-room solver, or general projecting balcony was implemented in this pass.** Those are explicit next implementation steps, starting with space boundary classification and furnished/door-clearance validation. Asked whether the living/balcony connection should be closable glazed or permanently open; no answer was available during this pass.
- Focused Nepal tests passed **53/53**; regenerated ten-plan HTML/CSV/PDF and visually inspected Plan 1's main entrance, door symbols and joined overhang. Source changes remain isolated to Nepal. Review artifact: `local/runtime/nepal-deep-review/updated-plan1.png`; research precedents rendered beside it.

## 2026-09-30 — projecting balconies, coordinated courts and polygon-room studies

- Added the isolated Python/Shapely geometry worker, bounded court-first repartition, projecting balcony/access/guard reservations, polygon wall/aperture rendering, Node adapter and an account-free Studio study button. Full file map, assumptions, calculations, reproducible commands and next steps are in `POLYGON-SPATIAL-EXECUTION.md`.
- Five generated cases / seventeen floor diagrams are in `local/runtime/nepal-polygon-study/`, with HTML, CSV, JSON and PDF. All five gain one projecting balcony under their supplied working coverage cap. The enlarged 16 m plot has a continuous 3 m clear court and three irregular rooms. The four small cases still have no court solution in this bounded search; that is not a mathematical infeasibility proof.
- Visual inspection revealed columns inside newly partitioned rooms. Added an explicit per-room diagnostic and regression assertion. Final enlarged case has thirteen new findings, including seven interior-column findings; rental cases have five each. Unassigned space is visibly peach. These are review prototypes, not accepted finished houses. The next priority is structural-bay-aware partitioning and compact room/adjacency optimization.
- Passed 55 focused Nepal Node tests, 8 Python tests, 4 isolation tests and frontend build; reran both polygon integration tests after the final column diagnostic. Existing build warnings remain. Local API and frontend return 200; isolated launcher restarted as PID 34096. Main Keystone backend/frontend Git status remained clean; no deployment.
- Current limits: fixed frame, no furnished path/swing proof, no engineered balcony or court drainage, no automatic permit validity, no arbitrary irregular parcel generator, and no polygon export to normal CAD/3D yet. Source NBC 206:2024 p.17 remains a cited reference with adoption status unchanged. No source books/rules were modified.

## 2026-09-30 — grid-aware rejection and 4.5 ft bathroom/service shaft

- Added structural-axis partition cuts and rejected new court-first rooms that enclose complete column boxes. This correctly withdraws the previous enlarged court layout; fallback original defects remain explicit. Precomputed column geometry and bounded partition nodes at 160 per floor/proposal.
- Added a separate owner-proposed 4.5 ft square clear service-shaft search, including bathroom-corner seeds and mandatory bathroom aperture adjacency. It uses the same continuous vertical void checks. Shaft windows are labelled distinctly and never credited as habitable-room daylight. Retrieved NBC 206:2024 p.17 and checked the official DUDBC publication; no bathroom-shaft minimum was established by the retrieved text. Municipal approval remains unknown, not prohibited by assumption.
- Updated HTML/CSV classification and documented calculations/limits in POLYGON-SPATIAL-EXECUTION.md. All five real benchmark cases still have no feasible void found; the former enlarged court proposal is no longer retained. Bathroom/shaft joint replanning and grid-first room topology remain outstanding.
- Verification: 55 focused Nepal tests and 9 Python geometry tests passed. The new test proves supplementary shaft glazing contributes zero habitable daylight credit; integration proves the bad column-containing repartition is rejected while retaining the room program. No main Keystone edits or deployment.

## 2026-09-30 — joint neighboring-room/shaft repair

- Added `repair_shaft_neighbors` in `local/planner/spatial_study.py`. The search can redivide a pair of adjoining rooms around a continuous shaft, retaining all room IDs and minimum functional zones. It prioritizes utility/alcove annexes, tries grid and size-derived splits, and rejects complete columns inside repaired rooms.
- Door reservations can move along existing circulation/access boundaries; attached bathroom access remains tied to its primary bedroom. A final check rejects lost shared access and column clashes. Protected circulation/parking/stair conflicts are checked across all floors before expensive repair. Fixed candidate budgeting so protected shafts do not consume the four-proposal repair budget.
- Added an analytical regression in `local/planner/test_spatial_study.py`: direct shaft subtraction fails a narrow bathroom, while joint bathroom/utility partitioning succeeds across three levels without dropping rooms. This is geometry proof, not a new successful residential benchmark. Existing five real review cases still have no accepted void solution; their fixed circulation and stacked room assignments need a broader topology change.
- Search work is bounded to four shaft repair proposals, with 160 functional-fit checks per floor; cached per-floor wall/column obstacles reduce repeated geometry work. Raised the local adapter timeout from 45 to 90 seconds because the larger repair search exceeded the previous aggregate limit. This remains a local study, not a production latency target.
- Verification: focused Nepal suite 55/55 and Python geometry suite 10/10 passed before the final fit-budget optimization; the positive repair test passed again after it. Final audit/check results follow below. No public deployment or main Keystone changes.
- Final bounded-search audit completed successfully and regenerated HTML/CSV/JSON; all five real cases still have no accepted void. Final Python suite passed 10/10 after budgeting. Local launcher restarted as PID 37688; main source trees remain clean. The next unresolved task is multi-floor wet-zone/circulation topology, not further two-room repair.

## 2026-09-30 — line-ending-independent catalog pins

- **Defect.** `verifyCatalog` in `resolveRulePack.js` compared raw-byte SHA-256 hashes of `knowledge/rules.json` and `knowledge/manifest.json` with `knowledgeRulesSha256` and `knowledgeManifestSha256` in `catalog.json`. Those pins had been computed on Windows over CRLF bytes. The root `.gitattributes` (`* text=auto`) stores these files with LF (`git ls-files --eol`: `i/lf w/lf`). So `RULE_SOURCE_DRIFT` fired on every non-Windows checkout, even when the original PDFs were present.
- **Evidence.** The checked-out `rules.json` has raw LF SHA-256 `0948fa20…f961`. After `\n`→`\r\n` it gives `69bfa946…cff5`, the old pin. The checked-out `manifest.json` has raw LF SHA-256 `c1978dc1…ff1e`. After CRLF conversion it gives `1f392d40…0cbf`, the old pin. Neither file contains a CR. So the committed content is exactly the content that was pinned and reviewed. Only the line endings differ.
- **Fix chosen: normalize, don't pin bytes.** The alternative was marking these files `-text` and committing CRLF bytes. That was rejected because the pin would still depend on byte transport: an LF write by a Linux tool, an editor, or a `buildCatalog.js` run on another OS would break it again. `normalizedTextSha256`, exported from `buildCatalog.js` to keep the cloud copy within its file cap, hashes UTF-8 content after `\r\n`→`\n`. `buildCatalog.js` and `verifyCatalog` both use it, for the two knowledge JSON files only.
- **Unchanged.** Original PDF/EPUB source checks still hash raw bytes against the manifest `sha256`, in both `verifyCatalog` and `buildCatalog.js`. The manifest, `rules.json`, source IDs, source hashes, citations and review statuses were not modified.
- **Catalog update.** Only the two pins in `catalog.json` changed, from `69bfa946d3ec725e2084641ae816dc070406cbd92fff1ba1eedf9da8cececff5` to `0948fa2020e00dea0d19561a23f84aadd5a959056f4265449bf841bcd028f961` (rules) and from `1f392d40de2782bc0aaf5e47c6d342684a9085b8661e59609d255da001740cbf` to `c1978dc1a66b87a24841783ca88713dc7da096e5b6f32a292e8ccd1efaa2ff1e` (manifest). A full `buildCatalog.js` run was not possible here because it correctly refuses to build without the original PDFs. A dry rebuild of `sources` and `rules` from the current knowledge files matched the committed `catalog.json` exactly. The normalized hash is the same for the LF file and for a CRLF-converted copy.
- **Side effect.** `resolveRulePack().catalogVersion`, and the rule-pack `version` derived from it, now report the normalized rules hash. No test or stored artifact in this copy pins the old value.
- **Verification (cloud copy, Linux).** Ran `npm install` and `node --test test/nepal-*.test.js`. First run: 52/55, because Python Shapely was not installed and the two polygon-study tests failed with "Polygon study unavailable". After `pip install -r local/planner/requirements.txt`: **54/55**. The only failure is `nepal-milestone-c` "Kathmandu overlay is explicit and unreviewed…", which gets `RULE_SOURCE_DRIFT` instead of `KMC_RULE_REVIEW_REQUIRED`. A direct check confirmed both knowledge pins now match and that none of the 15 manifest `original` files exist under `Design Files/`. That missing-source check is the sole remaining cause, and it is intentional in this trimmed copy.
- **Next step.** Run the suite in the full repository with `Design Files/` present. That run should reach 55/55 and would confirm the PDF hashes end to end. If `rules.json` or `manifest.json` changes, rerun `buildCatalog.js` there.
