# Nepal backend implementation plan

Prepared 2026-09-30. Milestone B is implemented locally. C-F foundations and focused tests are in progress; their professional/geometry gates are **not complete**. See `C-TO-F-EXECUTION.md` for exact status. Owner decision: develop locally first; retain the existing public Keystone unchanged. Company name, public launch, payments and redesign are later work.

The owner is a Nepal Engineering Council-registered architect/engineer and can review the current working plans directly. The local preview proceeds using the explicit assumptions and calculations in `WORKING-ASSUMPTIONS-AND-CALCULATIONS.md`; permit-readiness checks remain distinct. The review document is `local/runtime/nepal-plan-review/index.html`, and a completed local Studio survey opens the same type of document through **Open working plan review**. No external approval is required to keep iterating locally.

## 1. Starting point and boundaries

The working application has been copied to `local/backend-keystone` and `local/frontend-keystone`. These are independent files with independent dependency installations. `local/COPY-MANIFEST.json` records the original source hashes and commits. Read `local/LOCAL-DEVELOPMENT.md` before starting the application.

This is a working US application baseline, **not a completed Nepal generator**. The Nepal knowledge library provides retrieval and fact evaluation, not geometric measurement or regulatory approval. Do not rename existing US results as Nepal results.

All file paths below are relative to `Keystone Nepal/`. Modify only this workspace. Existing paths are integration seams; paths under `local/backend-keystone/lib/nepal/` are proposed new modules. Do not edit the parent repository's backend/frontend. Never add production secrets, cloud targets, customer data or deployment automation during this phase.

There is no live traffic migration, database migration or deletion. Rollback means stopping the local processes and reverting this copy's changes. Original source snapshots and the knowledge library remain available. Keep local fixtures and experiment outputs under `local/runtime/`; retain durable evidence summaries in this folder.

## 2. Definition of backend success

The initial supported product is a constrained, metric, RC-frame residential generator for verified Kathmandu Valley and Pokhara jurisdiction profiles. Start with one reviewed municipality and site; expand shared rules through explicit overlays. Similar local practices do not prove identical adoption.

For every declared supported feasible test brief, the target is three **spatially different**, valid alternatives that preserve the brief, site, legal limits, stairs and structural reservations. Impossible or unresolved briefs receive an actionable preflight result. Do not promise a house for every numeric input or three alternatives where the site permits only one. Do not count recoloring, furniture movement or renaming as layout variety.

Backend readiness requires:

- Site reconstruction and north provenance; unknown plot geometry is never invented.
- Explicit storeys, including the partial top floor in 2.5/3.5-storey requests.
- A non-overlapping area ledger and locally confirmed coverage/FAR treatment.
- Early Vaastu-driven allocation with visible conflicts, behind mandatory feasibility gates.
- Coordinated columns, beams, stairs, courts, shafts, doors, windows and usable rooms.
- The same building revision driving plans, sections, elevations, CAD, 3D and quantities.
- Reproducible case results, failure reasons and professional review evidence.

Generating submission sheets does not establish structural certification or municipal approval. The first permit project still needs the architect, engineer, survey and municipality-specific submission requirements described in `02-inputs-and-team.md`.

## 3. Architecture and data ownership

Retain the existing renderer, geometry primitives, account shell and export APIs where useful. Add a Nepal pipeline behind an explicit `jurisdiction.country = "NP"` discriminator. Missing jurisdiction continues to identify the copied baseline; it must not silently acquire Nepal rules. Unsupported Nepal requests must never fall back to the US generator.

Use this dependency order:

`survey -> validated brief -> applicable rule pack -> site envelope -> structural/core candidates -> room allocation -> openings/furniture -> measured facts -> eligibility -> Vaastu ranking -> diversity -> canonical building -> drawings/quantities`

Preflight and generation must call the same normalizer and rule resolver. Editing/refinement must return through the same validation stages. Every artifact carries request ID, model revision, rule-pack version and source hashes.

Keep one canonical geometry convention for Nepal, preferably integer millimetres with areas in square metres. Document origin, axes, north rotation, floor elevations, wall reference lines and precision. Existing US geometry uses feet: create explicit adapters at its boundaries; do not reinterpret existing feet values as metres. Store original user units for round-trip display. Avoid copying area calculations into each renderer.

Recommended request sections: `site`, `jurisdiction`, `buildingProgram`, `structureAssumptions`, `stairPreferences`, `vastuProfile`, `openings`, `parking`, `services`, `finishes`, `evidence`. Store required/optional preference status separately. A room has a stable ID, level ID, requested purpose, target/minimum size and adjacency requirements.

## 4. Milestone A — isolated baseline and reproducible development

Status: application copy and local-only startup delivered in this task; comprehensive inherited regression suite is not certified.

Files: `local/tools/local-env.cjs`, `run.cjs`, `backend-boundary.cjs`, `isolation.test.cjs`, copied `server.js`, frontend `vite.config.js` and `scripts/conversion-config.mjs`.

1. Start using `cd "Keystone Nepal/local"; npm run dev` from the parent workspace.
2. Confirm frontend port 5299 and backend port 8299; verify health says local and external services disabled.
3. Retain credential stripping, loopback listeners, outbound restrictions and browser CSP. Local development identity and credits are not production auth.
4. Save one baseline generation and matching GLB. Record Node/Python versions and source fingerprints.
5. Before engine changes, establish a focused, bounded baseline suite. The existing consistency matrix is expensive; run it as a separately timed batch. Do not misreport an interrupted run as passing.
6. Establish independent version control before extended implementation. Do not inherit a production remote. Keep raw books, credentials, dependency folders and generated caches out of any future public repository.

Gate: application builds; local survey generates; matching 3D works; isolation tests pass; original source hashes remain unchanged. Python CAD/XLSX and optional Blender need separately provisioned local dependencies and explicit smoke tests.

## 5. Milestone B — survey contract and Nepal preflight (implemented locally)

Create `lib/nepal/briefSchema.json`, `normalizeBrief.js`, `units.js`, `preflight.js` and focused tests under copied backend `test/nepal-*.test.js`.

Integrate with copied `lib/surveyPreflight.js`, `surveyRequirements.js`, `surveyCapabilities.js`, `surveyFieldRegistry.js`, and `api/plan.js`. Introduce a Nepal API fixture first; make only the minimum frontend changes needed to exercise it later.

1. Accept side lengths with explicit units; support ropani/aana/paisa/daam display through verified conversion constants. Store dimensioned polygon geometry independently of stated cadastral area.
2. Rectangles require enough constraints to justify right angles. For irregular quadrilaterals, request diagonal/angle/bearing data or surveyed coordinates. More than four sides requires a closed survey polygon or equivalent solvable measurements.
3. Reject crossing boundaries, impossible side combinations and unacceptable closure error. Explain missing data precisely. Allow clearly marked approximate concept geometry only in an explicit concept workflow, not permit output.
4. Capture municipality, ward, road edges/width/evidence, true north, setbacks per edge, neighboring walls/heights/openings where known, terrain/plinth/flood context and survey revision.
5. Replace fractional storey arithmetic with a level list: elevations, heights, uses and individual footprints. Record terrace, tank, stair headroom enclosure and partial top floor separately.
6. Capture households/rental units, bedrooms/baths/living rooms/kitchens/attached baths per level, kitchen/puja, balconies, laundry, roof use, bike count, optional car count, access and accessibility needs. The current preflight preserves the input and normalized brief; measured plan fulfillment remains a later generator milestone.
7. Ask whether floors will be rented, how many, and which. Treat each rental floor as an independent unit with its own kitchen, living room, bathroom, bedroom and unit entry. The owner home may span the upper full and partial floors. Preserve the owner room totals and special rooms independently of rental totals. For this first profile, rentals above the owner are marked unsupported. Reserve a continuous stair outside all private units, with its best site side to be solved later. This is a spatial requirement, not a claim that a stair has already been fitted.
8. Default standard wardrobe only to the primary bedroom; other bedroom wardrobes are opt-in. Attached bathrooms are explicit and counted in the bathroom totals.
9. Default stair preference to half-turn with landing; alternative types are explicit choices. Changing a type must change geometry, not just a label.
10. Return structured `missing_information`, `unsupported` or `infeasible_input` outcomes with field-specific messages. A complete brief still returns `unsupported` with `NEPAL_GENERATOR_PENDING` until the Nepal planner is implemented. Unknown requirements must not receive a pass.

Gate met for the local survey/preflight contract: focused fixtures and browser/API smoke pass; malformed and ambiguous plots are rejected before generation; 2.5/3.5 levels are explicit; unsupported Nepal requests cannot reach a US fallback. The plan fulfillment report will be measured only after a Nepal generator exists. See `MILESTONE-B-EXECUTION.md`.

## 6. Milestone C — reviewed rule packs and area ledger

Create `lib/nepal/rules/resolveRulePack.js`, `rules/profiles/`, `areaLedger.js`, `measureFacts.js`. Reuse `knowledge/rules.json`, `knowledge/tools/area_accounting.py` and the evaluator contract as references; avoid two independently maintained normative catalogs.

1. Define a build/import process that pins the knowledge manifest and compiles a small reviewed JSON pack for the backend. Do not ship full books to the browser or invoke an LLM to reinterpret law on every request.
2. Each executable rule needs scope, units, predicate, priority, edition, municipality overlay, citation, review status and effective/review date. Keep manual-review clauses separate from executable checks.
3. Resolve national baseline plus municipality/ward/parcel overlays explicitly. Detect conflicts and unknown adoption. Exclude the older seismic draft commentary from current rules.
4. Review NBC 105:2025 structural planning implications with the engineer. Do not turn seismic requirements into a single arbitrary safety factor. Unknown site class must not be auto-filled from a city name.
5. Implement polygon unions/intersections for plot, footprint, each floor, courts/voids, shafts, stairs, balcony, canopy, roof enclosure and parking. Record gross and net area, coverage numerator and FAR-chargeable area as different quantities.
6. Confirm the resource-book rules locally before activating them. Its page 54 coverage example is not a nationwide hardcoded 70%; its pages 15 and 52 disagree on some basement/balcony treatment. Keep disputed items unresolved until reviewed.
7. Separate vehicle parking geometry from regulatory area treatment. Outdoor, covered, enclosed and cantilever-covered parking may have different treatment; no blanket exemption.
8. Test exact legal limits, just-under/just-over boundaries, overlapping polygons, partial floors and exclusions. Compare three manually calculated reference ledgers with automated output.

Gate: all emitted legal decisions have reviewed applicability and reproducible geometry; unresolved rules block compliance claims. Source drift invalidates affected decisions rather than silently retaining old conclusions.

## 7. Milestone D — site envelope, structural reservations and stacked core

Create `lib/nepal/siteEnvelope.js`, `frameGrid.js`, `levelStack.js`, `corePlanner.js` and candidate fixtures. Review copied `lib/buildingModel.js`, `planEnvelope.js`, `lib/residential/v2/programBuilderV2.js`, `supportMatrix.js` and `realmPlannerV2.js` for reusable pieces; their current limited US typologies are not a multi-storey Nepal implementation.

1. Offset the correct site edges by applicable setbacks and road reservations. Support adjoining sides only under reviewed permission; do not infer zero setback from neighboring construction.
2. Mark legal opening faces independently of facade orientation. Model courts/lightwells and open-to-sky status as real voids through affected levels.
3. Place bike/car parking with gate width, maneuvering, pedestrian entry, rental stair entry and utilities. Parking must not consume the only escape path or hide an unacceptable open ground floor.
4. Generate engineer-configured RC grid candidates within allowable planning spans. Reserve column and beam envelopes and stable grid IDs across levels. Numerical member dimensions remain provisional until engineer supplied.
5. Penalize/flag transfer columns, discontinuous walls/frames, torsional/vertical irregularity, large cantilevers and open-storey conditions for engineering review. Passing these planning checks is not a seismic analysis.
6. Allocate vertically continuous stair/service cores and wet shafts before rooms. For rental briefs, the shared stair remains outside every private flat and reaches the owner's upper home without crossing a rental room. Give each rental floor an independent entrance and reserve separate service/metering routes as required by the project team. Partial upper floors must preserve access, support and roof drainage paths.
7. Maintain per-level usable envelopes after structural reservations. Walls/rooms may not overlap columns just because the plan looks acceptable at room-box scale.

Gate: polygon containment, no illegal openings, connected pedestrian access, continuous reserved load paths and aligned cores across every tested level. Engineer reviews grid families before they become supported defaults.

## 8. Milestone E — Nepal staircase model

Create `lib/nepal/stairProfile.js`; extend copied `lib/stairs/codeProfiles.js`, `stairAssemblySchema.json`, `validateStairAssembly.js`, `validatePlanStairAssemblies.js` and `lib/stairLayout.js` through explicit profile selection.

1. Retrieve the applicable code clauses and verify dimensions from original pages. Do not reuse IRC thresholds under an NBC name or invent numbers from customary practice.
2. Solve integer riser counts against exact floor-to-floor height. Derive tread runs, landing levels and stair well from the selected half-turn topology and structural reservations.
3. Represent each flight, riser, tread, landing, slab/waist allowance, rail/guard, handrail, floor opening and headroom volume. Record provisional structural thickness separately from confirmed details.
4. Check both directions of travel, arrival access, door swing interference, beam/soffit headroom, unequal risers, floor-cut continuity, rail gaps and top-level headroom enclosure. For rental houses, validate the whole continuous stair stack and every independent floor entry as one assembly.
5. Generate plan cut conventions, UP/DN arrows, flight labels, dimensions and section from this assembly. Draw hidden continuation distinctly. Use the same assembly for 3D, CAD and quantity takeoff.
6. Alternative stair types get their own fit checks; never resize a symbol to imply a physically fitting stair. Return required space or alternative core choices when fit fails.

Gate: manually checked half-turn fixture at every supported storey count, beam-interference failures, top-floor cut validation, matching plan/section/3D geometry and architect/engineer review of the assembly assumptions.

## 9. Milestone F — Vaastu-led rooms, light and genuine alternatives

Create `lib/nepal/vastuDomains.js`, `vastuAllocator.js`, `roomPlanner.js`, `candidateSearch.js`, `rankCandidates.js`, `validateNepalPlan.js`.

Use `knowledge/DESIGN-PRINCIPLES.md` and `knowledge/INTEGRATION.md`. The library ranks supplied facts; new geometry code must measure those facts honestly.

1. Implement separate site/building/floor/room/fixture domains, true-north transforms, clipped zones and uncertainty. The proposed 3x3 convention requires consultant sign-off; do not present it as universal doctrine.
2. Seed kitchen, puja, primary bedroom, toilets, stair and entry choices from the selected Vaastu profile before allocation. Preserve source conflicts and user-approved alternatives.
3. Allocate around the site, structural grid, cores and light reservations. Prefer compact orthogonal construction initially. Preserve required room sizes, adjacency, privacy and access across households.
4. Place actual beds, wardrobes, kitchen counters/stove, WC/basin/shower and circulation clearances. Fixture orientation and the user's facing direction are distinct measurements.
5. Give each habitable room a traceable legal daylight/ventilation strategy. A window facing a forbidden boundary or closed shaft is not a valid solution. Separate geometric aperture checks from any future daylight simulation claim.
6. Reject mandatory failures before ranking. Rank core Vaastu first, detailed Vaastu next, then architecture/efficiency. Decorative improvements cannot compensate for a failed core requirement.
7. Search across meaningful core position, court arrangement, public/private zoning and room adjacency families. Compare room topology and normalized geometry. Keep a pairwise variation explanation for the selected alternatives.
8. Explain unmet optional requests, unresolved review items and allowed tradeoffs. Never drop puja, parking, a bedroom or a floor merely to reach three outputs.

Gate: independent room usability checks, fact tests under 0/90/180/270-degree rotations, strict mandatory filtering, deterministic reproducibility and three substantively different valid plans for declared positive fixtures. Constrained exceptions are explicit and excluded from the three-option claim.

## 10. Milestone G — refinement and canonical output

Review copied `api/plan_refine.js`, `lib/planEdit/`, `lib/validateEditedPlan.js`, `lib/refinementResize.js`, `lib/placeOpenings.js`, `lib/furnitureGeometry.js`, `lib/closetGeometry.js` and actual route names before editing.

1. Allow local deterministic edits first: resize/move an allowed partition or room, choose a candidate, change fixture orientation, change a supported preference.
2. Lock surveyed boundaries, adopted setbacks, structural reservations and shared core geometry unless the user explicitly starts a coordinated redesign.
3. Rebuild dependent openings, furniture, measured facts, area ledger and scores after each edit. Recheck every affected level and connected core.
4. On invalid edits, preserve the last valid revision and return a precise conflict. Do not charge local credits or require a remote LLM to perform a deterministic change.
5. Version the canonical model and invalidate drawings/estimates when geometry changes. Downstream renderers must not independently invent walls, columns or stairs.

Gate: valid edit updates all artifacts; invalid edit preserves the prior revision; stair/core edits cannot silently corrupt other floors.

## 11. Milestone H — drawings, quantities and MEP reservations

Existing seams: `lib/renderPlanSvg.js`, `renderElevationSvg.js`, `lib/model3d/`, `lib/cad/buildDxf.js`, `api/plan_model.js`, `lib/estimate/`, `api/estimate.js`, `api/estimate_xlsx.js`. Inspect exporter Python call sites and use a local virtual environment for required libraries.

1. Add dimensioned site plan, all floor/roof plans, consistent sections through stairs, elevations, grid/column tags, door/window schedules and area schedules. Use metric CAD units, meaningful layers, lineweights and closed wall outlines.
2. Coordinate RC reservations, plastered brick infill, slabs, openings and roof details. Separate architectural intent from engineer-approved reinforcement/member schedules.
3. Add Nepal material assemblies and NPR rate provenance. Quantities come from geometry: net wall areas and openings, concrete reserved/approved volumes, finish surfaces, stairs, doors/windows. Waste factors are separate. Do not estimate final reinforcement from an unengineered structural layout.
4. Compare each measurable category with a manual reference takeoff, target <=5% discrepancy where sufficient detail exists, and report errors per category. A good total must not conceal cancelling errors. Cost accuracy needs dated local quotes, labor, taxes and project assumptions; do not guarantee 5% from placeholder rates.
5. Reserve plumbing shafts, wet stacks, water tanks/pumps, rainwater discharge, septic/sewer interface, electrical risers/panels and ventilation routes. Coordinate required clearances and penetrations with structure.
6. For MEP, distinguish coordinated routes/reservations from professionally sized systems. Never fabricate pipe/cable sizes, protective-device selections or system certification. Follow `05-mep-roadmap.md` for engineering ownership.
7. Support multi-color plaster/exterior finishes as explicit material zones after geometry is correct. Ensure 2D and 3D use the same openings and building revision.

Gate: CAD reopen test, geometry/schedule cross-check, matching sections and 3D, reviewed manual quantity benchmark and no unresolved critical service/structure collision. Permit sheet completeness is checked against the selected municipality's actual checklist.

## 12. Milestone I — coverage, review and backend release gate

Create `local/scripts/nepal-coverage.cjs`, versioned `local/backend-keystone/test/fixtures/nepal/`, and a report under `local/runtime/nepal-coverage/`.

Start with a finite reviewed matrix, not an assertion that continuous inputs have been exhaustively tested. Extend the earlier verification plan with explicit case IDs. Cover rectangles and surveyed irregular sites; small/medium/large feasible areas; road orientations; zero/one/two opening-restricted edges; each supported level stack; household/room programs; no parking/bikes/car; Vaastu profiles; stair choices and rule-pack overlays. Add boundary and intentionally infeasible cases. Pairwise coverage supplements focused high-risk combinations; it does not prove all combinations.

CSV columns: case ID, seed, input hash, survey fields, municipality/ward, source/rule-pack/model version, expected result, preflight result, generation time, candidate count, valid option count, unmet requirements, mandatory failures, unresolved checks, core/detail Vaastu outcomes, coverage/FAR and limits, stair/core issues, daylight/access issues, pairwise diversity, export status, manual-review status and artifact paths.

Run in bounded batches with timeout and progress checkpoints. Persist failed inputs for replay. Fix common causes at their responsible layer; do not weaken validators to make counts green. Add a regression case for every fix. Retest only changed neighborhoods first, then run the release matrix. Preserve failed and successful evidence.

Release gate is local backend readiness, not publication: all supported positive cases satisfy requirements; negative cases fail before generation where predictable; no unexpected exceptions; declared diversity target met; reviewed artifacts agree; US-copy regression controls remain stable; no remote requests; unresolved engineering matters are listed. A professional-reviewed real pilot is required before calling any output permit-ready.

## 13. Schedule and dependencies

| Period | Main work | Exit evidence |
|---|---|---|
| Week 1 | A/B/C; real site and municipal review | Local baseline, schema fixtures, reviewed rule applicability and area ledgers |
| Week 2 | D/E and initial F | Site/grid/core families, fitted half-turn stairs, usable first Nepal plans |
| Week 3 | F/G/H | Distinct valid alternatives, safe edits, coordinated sheets and preliminary quantities |
| Week 4 | H/I and professional corrections | Coverage report, reference takeoffs, reviewed pilot drawing package and remaining issue register |

This is a conditional four-week pilot schedule, not a commitment to universal coverage or all MEP engineering. Missing survey/local rules/engineer inputs move the permit milestone. Shared work across Kathmandu and Pokhara can proceed, but do not claim both jurisdictions validated from a single municipality's approval.

Owner inputs needed now: one real surveyed plot with north/road/ward; current applicable municipal instrument and submission checklist; at least one approved local architectural/structural drawing set; architect and structural engineer reviewers; chosen Vaastu interpretation; actual household/parking brief. Later: engineer-approved sections and loads, local dated material/labor rates, utility/service information and MEP reviewers. Books already supplied do not need resending.

## 14. Exact next implementation task and handover discipline

Begin **Milestone C** with reviewed municipality/ward rule applicability and polygon area accounting. The four Milestone B fixtures are a rectangular 2.5-storey site, a surveyed irregular 3.5-storey site, a two-rental-floor 3.5-storey house with an upper owner home, and ambiguous side-length-only input that must request more information. The Nepal API currently stops before generating any floor plan, including rental cases. The local no-account mode is guarded by `NEPAL_LOCAL_STUDIO=1`, set only by the isolated launcher; keep it outside any public build.

After every milestone append to `EXECUTION-LOG.md`: files changed; behavior delivered; evidence/commands/results; what was learned; unresolved assumptions; next exact task. Record incomplete tests, source conflicts and provisional structure honestly. Update this plan when evidence changes the sequence. Keep production unchanged throughout.
