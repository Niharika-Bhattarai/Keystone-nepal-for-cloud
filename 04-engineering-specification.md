# Engineering specification and implementation map

Planning only. Existing paths were checked on 2026-09-30. Backend HEAD was `763f2b3`; frontend HEAD was `5e93363`. Recheck both before implementation: other agents may advance them. Proposed modules below do not yet exist.

## 1. Isolation and reuse

Keep this folder as the Nepal planning/evidence root. When implementation starts, create named Nepal branches or worktrees of `backend-keystone` and `frontend-keystone`; record exact commits and working directories here. Do not clone secrets, production databases or billing state. Share maintained engine code through reviewed seams; avoid a permanent untracked copy of the entire US application.

Introduce an explicit jurisdiction context selected at request entry. Missing jurisdiction preserves existing US behavior for existing clients; Nepal survey requests must explicitly set country and municipality. A Nepal validation failure must never enter an American legacy fallback. Unknown municipality or unreviewed rule pack can support clearly labeled exploratory work but not permit status.

## 2. Existing seams and proposed ownership

Paths in this table are relative to the indicated repository. New names are recommendations, not claims of implemented modules.

| Existing seam | What to inspect/change in isolated development | Proposed Nepal module/tests |
|---|---|---|
| Backend `api/plan.js`, `api/plan_preflight.js` | Resolve jurisdiction before normalization and generation; consistent preflight/error contract | `lib/nepal/index.js`, `preflight.js`; `test/nepal-preflight.test.js` |
| Backend `lib/tile/normalizeBrief.js`, `lib/planSchema.json` | Preserve side lengths, geometry evidence, per-level program, Vaastu, parking and jurisdiction; no US coercion | `lib/nepal/normalizeBrief.js`, `brief.schema.json`; roundtrip tests |
| Backend `lib/residential/v2/supportMatrix.js` | Current `stories_out_of_range` check rejects above two storeys; do not just remove it and assume builders work | Nepal `supportMatrix.js`, `generate.js`, tested-domain manifest |
| Backend `lib/residential/v2/candidateFootprintsV2.js`, `orthogonalAssembler.js` | Reuse proven geometric operations where suitable; replace US area-first assumptions for Nepal | `siteEnvelope.js`, `frameCandidates.js`, `levelProgram.js`, `candidateRanking.js` |
| Backend `lib/buildingModel.js` | Preserve structural and service objects through drawing/model transformations | `buildingContract.js`, `units.js`, `coordinateAdapters.js`; model consistency tests |
| Backend `lib/stairs/codeProfiles.js`, `stairLayout.js`, `lib/stairs/validateStairAssembly.js` | Existing profile contains IRC dimensions; add reviewed Nepal profile and explicit profile selection | `lib/nepal/stairProfile.js`; metric, landing and beam-headroom fixtures |
| Backend `lib/placeOpenings.js` and opening validators | Boundary permissions, obstruction, column/beam collisions and actual requested opening size | `lib/nepal/openingConstraints.js`, `daylightChecks.js` |
| Backend `lib/model3d/buildModel.js`, `meshBuilder.js`, `materials.js` | Render same multilevel geometry, member envelopes, shafts, roof and materials | Nepal fixtures for partial top floors and multicolor plaster assemblies |
| Backend `api/plan_dxf.js`, `scripts/export/build_concept_dxf.py`, `cad_details.py`, `cad_elevations.py`, `cad_plot_style.py` | Explicit metric export, grid and member objects, true sections, permit-sheet data and revision status | Nepal CAD fixtures and export manifest; do not relabel concept exporter as certified |
| Backend `lib/estimate/computeTakeoff.js`, `materialSpecLibrary.js`, `materialCostEngine.js`, `unitPrices.js` | Country-specific assemblies/rates; concrete junction rules; member-schedule quantities | `lib/nepal/assemblies.js`, `data/nepal-unit-prices.csv`, quantity audit fixtures |
| Backend `scripts/benchmark/studio-full-coverage.cjs`, `coverage-report.cjs`, `compare-coverage.cjs` | Reuse reporting and replay pattern; create real Nepal payload corpus | `scripts/benchmark/nepal-coverage.cjs`; CSV/JSON/HTML report |
| Frontend `src/studio/SurveyForm.jsx`, `DesignGenerator.jsx` | Nepal site sketch, side lengths, levels, default half-turn stair, Vaastu priorities, early constraints and review states | `src/studio/nepal/PlotSurvey.jsx`, `NepalProgram.jsx`, `ReviewStatus.jsx` |
| Frontend `src/studio/LocatedEstimate.jsx` | Country/municipality/ward, NPR, price date and uncertainty; do not key Nepal cost only by ZIP | Nepal estimate display fixtures |

Inspect current edit/save/refinement routes and persisted model versions as well: new geometry fields must survive a save/reload and an edit. Pin the exact route map in the implementation log after tracing it; this planning review did not audit every persistence path.

## 3. Plot survey: owner's clarified starting point

The owner confirmed users will enter **side lengths in the survey**, and professionals verify the final drawings. Do not require a surveyed CAD upload to try the product. Distinguish the accessible starting workflow from the evidence required for a real permit submission.

1. Choose plot type: rectangular, four-sided irregular, or drawn polygon.
2. Enter lengths with explicit units (feet/metres); show aana and square-foot area as derived values, with source labels.
3. For a rectangle, width/depth plus orientation determine the model; show the assumed right angles.
4. Four side lengths alone do not uniquely determine a general quadrilateral. Request one suitable diagonal with convexity/vertex order confirmation, or sufficient corner angles/coordinates. For larger polygons, require enough shape information to determine all vertices. Check triangle inequalities and self-intersections.
5. Let users draw an approximate sketch when extra measurements are unavailable. Label assumed angles/shape and require user confirmation; never silently invent a precise surveyed boundary.
6. Identify frontage, access road, north direction, neighboring obstructions and available dimensions. Keep plot edges in clockwise order with stable IDs.
7. Allow a later architect/surveyor correction or CAD/coordinate import. Show changed envelope/area and regenerate dependent plans; invalidate approvals when geometry changes.

Persist `geometryStatus` such as `user_approximate`, `user_measured`, `survey_verified`; record per-measurement source and date. A user-entered accurate number is not automatically legally verified. Missing north permits an exploratory layout but Vaastu direction checks remain unevaluated until supplied.

## 4. Units and common model

Use explicit metric units for Nepal geometry (recommended integer millimetres locally; square metres for reporting). Preserve surveyed precision independently. Existing feet/inch/tick modules need typed, tested adapters; changing global constants risks US regressions. Use a local origin plus georeference rather than large geographic coordinates for CAD/mesh geometry.

Minimum model records:

- `site`: ordered polygon, edge IDs, dimensions/evidence, north angle, frontage, road/ROW, municipality/ward, constraints and adjacent obstructions.
- `levels[]`: ID, use, finished elevation, slab/finish build-up, actual polygon, counted areas, roof/terrace boundaries.
- `structure`: grid axes, column/beam/slab/foundation envelopes, material and analysis reference, engineer/revision/status. Preliminary reservations are explicitly preliminary.
- `rooms/openings/stairs`: stable IDs, real usable geometry, intended use, opening dimensions and host, linked stairs between levels.
- `services`: equipment, connection ports, routes, shafts, required access zones, calculation/review references.
- `rules`: rule-pack/version, evaluated rules and outcomes, source clauses, manual-review requirements.
- `approvals`: discipline, reviewer, timestamp, covered model hash/revision, invalidation reason.

Every plan, section, elevation, schedule, 3D model and estimate reads the same versioned building data. Do not derive dimensions from generated images. Preserve graph connectivity and geometry IDs in refinements.

## 5. Generation sequence and conflicts

1. Normalize inputs without dropping survey choices; report unknowns and contradictions.
2. Resolve applicable reviewed rules, compute site envelope and area accounting.
3. Allocate floors and program, reserving legal access, a stair core, daylight spaces and services.
4. Generate engineer-reviewed RC grid configurations; fit rooms to usable space after member and finish envelopes.
5. Place half-turn stairs and other requested supported types; fit linked landings and slab openings.
6. Place rooms, doors, windows, furniture and parking with hard constraints enforced.
7. Validate geometry, program fidelity, circulation, boundary/light constraints, vertical continuity and service routes.
8. Apply essential Vaastu rules and rank remaining preferences, usability, compactness and diversity.
9. Select three valid distinct candidates when the supported brief allows them; otherwise report actual count and reason. Never mark a contradictory brief supported just to meet a quota.
10. Engineer/architect review selected candidate; changes rerun all dependent checks before issue.

Hard constraints include applicable mandatory rules and declared essential user requirements. If these conflict, return a minimal useful explanation and specific editable inputs. Advisory preferences affect ranking, not legality. Preflight is a feasibility screen; retain final validators because not all geometric contradictions are knowable before solving.

## 6. Stair default and alternatives

The owner selected **half-turn (U-shaped) stairs with an intermediate landing** as the Nepal default. Survey alternative choices can include straight and quarter-turn stairs once validated. Winders/spirals require separate rule and geometry support; show them as review-only until implemented.

Half-turn configuration includes two flights, landing, gap/newel zone as designed, rails/guards, true slab opening and structural support. Reserve usable width after plaster/rails. Compute flight rises from actual finished levels; check riser consistency, tread/landing depth, doors at landings and headroom over the entire travel path, including intermediate landings and beams. Do not copy IRC dimensions into a Nepal profile.

The engineer supplies stair slab/support/detailing for the pilot. Draw lower/upper flight cut/projection conventions consistently across levels and show upward travel, riser counts, elevations and section references. Check roof stair enclosure, rain protection and exit to terrace where relevant.

## 7. Rule register and control

Each rule record: `id`, jurisdiction, document/edition, source URL/file hash, clause/page, applicability predicate, value/unit, exceptions, severity, test fixture IDs, reviewer, review date, status and supersession link.

Statuses: `located`, `extracted_unreviewed`, `reviewed_applicable`, `not_applicable`, `superseded`, `unresolved`. Only reviewed applicable values can produce a rule-compliance result. Preserve manual findings for provisions that cannot be automated. A missing rule does not mean pass.

Example topics requiring reviewed values: coverage/FAR; road and boundary setbacks; room/opening/ventilation criteria; stairs; height and partial-level accounting; roof/parapet; parking accounting; separation; service/drainage requirements. These are topics, not numerical rules already established by this research.

## 8. Verification commands and release proof

Existing backend package defines `npm test`, `npm run smoke:dxf`, and `npm run audit:architecture`; frontend defines `npm run build`. Run them in isolated worktrees and record failures before changes. Add focused Nepal Node tests and CAD checks before broad runs. Confirm external dependencies/fixtures before invoking costly or remote integrations.

Baseline and post-change US payloads must preserve behavior within documented tolerances. Test Nepal request serialization, editing, saving, reloading, exports and rendering. Review required permit sheets in the architect's actual CAD application, not only a screenshot viewer. A passing test suite alone cannot establish permit readiness.
