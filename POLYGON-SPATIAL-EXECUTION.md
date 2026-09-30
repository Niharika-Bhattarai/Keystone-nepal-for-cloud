# Polygon planning execution — 30 September 2026

## Follow-up: grid constraint and smaller service shafts

The table below records the previous iteration and is **superseded by the latest results.csv**. Grid-axis split candidates are now included, and new court-first partitions enclosing a whole column inside a room are rejected. This withdraws the earlier 16 m court solution: it was geometrically measurable but architecturally defective. Existing fallback rooms can still have interior-column findings; no accepted-design claim is made. Partition budget is now 160 nodes per floor for each of eight eligible proposals, to bound local response time.

A separate 1,371.6 mm (4.5 ft) square **clear bathroom/service shaft** is tried after the larger court search. Its 229 mm perimeter reservation makes the overall reserved square 1,829.6 mm; clear area is 1.88128656 m?, total reservation approximately 3.3474 m?. This wall assumption is deliberately retained for now and can materially constrain small plots. Search includes bathroom-corner seeds, requires bathroom aperture adjacency, protects all existing floors/core/columns/access, and preserves required rooms. It does not yet repartition bathrooms around the smaller shaft. All five real benchmark cases still fail to place a shaft/court in the current search.

The 4.5 ft square is an interpretation of the owner's professional precedent, not a verified legal minimum. NBC 206:2024 physical page 17 distinguishes a courtyard used for habitable-room light; physical page 5 excludes bathrooms/toilets from habitable rooms. Neither retrieved passage establishes approval of this shaft size. Other adjoining rooms may have supplementary shaft-facing openings, but these contribute zero to their credited daylight area. Bathroom ventilation performance, shaft height effects, privacy, drainage and cleaning access remain unverified. Official reference: https://dudbc.gov.np/content/13278/nepali-national-building-code-nbc-206--2024/ ; local source hash and adoption status unchanged.

Regression evidence: 55 Nepal Node tests and 9 Python tests pass. New Python test checks exact 4.5 ft clear geometry and proves shaft-facing kitchen windows receive no habitable daylight credit. Integration test now verifies rejection of the formerly column-obstructed court partition without dropping required rooms. This is constraint and search improvement, not successful compact-house synthesis. Next: allocate wet rooms and shaft jointly, and generate grid-cell room topology before corridor routing, instead of cutting a complete strip layout.

## Status and review entry

Implemented a local, opt-in spatial study for projecting balconies, continuous courts and polygon rooms. This is a geometry/search foundation, not a completed architectural planner. The original small-house layouts still need better topology. No public Keystone source or deployment was changed.

In the Nepal Studio, complete the brief and choose **Explore balconies, lightwells and irregular rooms**. Existing working-plan review remains available. The new request is `POST /api/nepal/concepts` with `{surveyData, spatialStudy:true}`. No account is needed in the isolated runtime.

Review `local/runtime/nepal-polygon-study/index.html`, `review-plans.pdf`, `results.csv` and `results.json`. HTML is the most legible format. Peach regions are unassigned space; they are not quietly claimed as useful rooms. Original candidate findings are expandable below each case. An optional analytical fixture is separate from actual generated cases.

## Implemented

1. **Polygon worker:** `local/planner/spatial_study.py`, using pinned Shapely 2.1.2. JSON input/output in millimetres; true polygon area, boundary and containment operations. Rejects invalid, disconnected or overlapping room geometry. Clear room area accounts for nominal partitions, exterior/court walls and columns. A sampled functional rectangle is evidence of one usable zone, not full furniture/access validation.
2. **Projecting balconies:** searches exposed upper-floor room edges, retains a real access opening and guard-edge geometry, avoids column clashes, checks containment and the supplied working coverage cap. Depth candidates are 1,200, 1,000 and 914 mm. Proposed 1,600 mm glazed access is closable; permanent-open living access has not been selected by the owner. A wholly replaced window is recorded, and proposed glazing contributes to preliminary aperture area. Cantilever reinforcement, permission, guard height and openable ventilation are unresolved.
3. **Coordinated court:** searches a 3,000 × 3,000 mm clear core plus a 229 mm surrounding wall reservation, with rectangular or beveled outer boundaries. The same void is removed through all occupied levels. Protects the stair, access reservations, parking and column zones. This follows the supplied NBC 206:2024 physical page 17 reference for a habitable-room court; municipal adoption remains unverified. Smaller bathroom ventilation shafts are a separate future rule family.
4. **Court-first partition:** if subtracting a court destroys required rooms/access, tries repartitioning around a court corridor, preserving required room IDs and types. Bounded search: first eight eligible court proposals, up to 900 partition nodes per floor and twelve candidate cuts per step. Nonrectangular rooms and source polygons can pass through geometry, wall and opening export. This is not an exhaustive feasibility proof or reinforcement-learning model.
5. **Measured findings:** missing attachments, changed entry/privacy relationship, insufficient reserved glazing, failed sampled functional rectangles and columns wholly inside rooms are surfaced. Original issues remain applicable. The search currently reports some defects rather than using all of them as generation rejection gates; therefore its results are explicitly studies.
6. **Local integration:** Node worker adapter in `local/backend-keystone/lib/nepal/spatialStudy.js`, route in `api/nepal_concepts.js`, frontend entry in `local/frontend-keystone/src/studio/NepalBrief.jsx`. Python has a time/output limit. Empty starting candidate sets return an actionable error. `candidateSearch.js` carries the actual working coverage cap into the study.
7. **Review renderer:** actual polygon wall solids and aperture cuts, window/access lines, stair tread lines, projected guards, unassigned areas and slab-intersecting columns. Door swings, furnished rooms, annotations and export parity are not completed in this renderer.

## Current generated results

| Case | Projecting balconies | Continuous court | Irregular rooms | Working projected coverage | New findings |
|---|---:|---|---:|---:|---:|
| Small owner / west | 1 | Not found | 0 | 67.17% | 0 |
| Small owner / east | 1 | Not found | 0 | 67.17% | 0 |
| Small rental / east | 1 | Not found | 0 | 69.50% | 5 |
| Small rental / west | 1 | Not found | 0 | 69.50% | 5 |
| Enlarged 16 m owner study | 1 | Yes | 3 | 62.36% | 13 |

Zero **new** findings does not clear original defects. The 16 m case has seven interior-column findings, three access/privacy review findings, two glazing findings and one missing attached-bath connection. Visual review also shows oversized rooms and substantial unassigned space. It demonstrates the polygon machinery, not a good finished house.

Coverage here is the union of the ground slab and all projecting balcony footprints divided by plot area. It is a conservative working metric, not an adopted legal floor-area/coverage interpretation. Original small plots are 126.5625 m²; owner projection is 85.0125 m² and rental projection is 87.96175 m². Enlarged plot is 256 m², projection 159.631836 m². Court clear area is 9 m²; its reserved perimeter consumes additional space.

## Verification and reproduction

From `Keystone Nepal/local`:

```powershell
python -m pip install -r planner/requirements.txt
node --test backend-keystone/test/nepal*.test.js
python -m unittest discover -s planner -p test_spatial_study.py
node --test tools/isolation.test.cjs
npm run build
node tools/nepal-polygon-study.cjs
```

Verified: 55 Nepal Node tests, 8 Python geometry tests, 4 isolation tests and frontend build. After adding the interior-column diagnostic, both polygon integration tests were rerun and passed. Build retains existing CommonJS/chunk-size warnings. Local API returned 200 with the study HTML; frontend returned 200. Edge rendered all five cases / seventeen floor diagrams; enlarged case was visually inspected. Main backend and frontend Git trees remained clean. This does not claim the full inherited backend suite passed.

## Exact next work

1. In `spatial_study.py` / `repartition_with_court`, partition main rooms against structural bays before area optimization. Make interior columns a rejection condition for selected results; keep rejected studies available for diagnosis. Test both large and small plots without removing required rooms.
2. Replace largest-first area allocation with bounded target intervals for each room, compact WC rectangles, direct living entry, and primary-bedroom/bath adjacency. Preserve rental isolation. Measure unassigned area and circulation length; do not reward a large living room at the expense of unusable leftovers.
3. Search court placement jointly with frame alternatives and unit topology. Current fixed-frame search cannot solve the four small cases. Any changed axes must retain continuity, stair support and the owner's preferred maximum 14 ft beam spans. Extra axes/columns must be explicit, not inferred from polygon corners.
4. Add smaller, source-linked wet-service shafts as a separate option. Do not substitute a tiny shaft for a habitable-room court. Validate stack alignment, maintenance access, drainage and aperture performance across every floor.
5. Validate real furniture paths and door swings; optimize windows on actual available facades. Enforce flush-side no-openings and adopted setbacks through the same boundary classification. Preserve architectural ownership of balcony access (family balcony versus a private bedroom balcony).
6. Feed accepted polygon geometry into normal plan/SVG, CAD, 3D and quantities. Currently this feature is an opt-in review endpoint; default production generation and those exports do not consume its polygons.
7. Add more architect-reviewed compact cases before enlarging the search or considering RL. Irregular **room polygons on rectangular parcels** are supported here; arbitrary surveyed irregular parcels and engineered irregular frame design are not completed.

Keep all follow-up work inside the Nepal copy. Update this document and EXECUTION-LOG.md with actual outcomes rather than marking unresolved planning gates complete.

## Joint repair follow-up

`repair_shaft_neighbors` now implements the first bathroom/shaft joint repair stage. It changes shared partitions and permitted entry intervals across neighboring room pairs, with no room deletion. All floors must retain the same void, protected zones, usable space and valid access. Four non-protected proposals are considered, with 160 fit checks per floor. The analytical regression proves a previously unusable bathroom can be repaired by borrowing and reshaping an adjacent utility zone. The five generated houses still do not pass shaft placement. Next work must replace fixed corridor topology and jointly assign wet zones over the floor stack; further small-room trimming is not an adequate replacement for that change. The local study worker has a 90-second aggregate timeout. This is an explicit unfinished architectural outcome, despite passing geometry regressions.
