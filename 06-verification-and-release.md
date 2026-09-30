# Verification, reporting and permit release

## 1. Define the supported domain honestly

Day 7 must freeze the supported plot/program domain after architect/engineer review. Do not claim every combination of continuous plot dimensions, setbacks, preferences and rooms can be exhaustively tested or physically accommodated.

Cover selected finite fixtures exhaustively; add pairwise and boundary/property tests for broader interactions. Report counts separately for feasible, infeasible, unsupported and unknown-rule cases. A clean early rejection is correct for an impossible brief, but is not a successful generated design.

## 2. Proposed generation matrix

Use **96 core requests**: four representative plot shapes × three level programs × four north orientations × two parking programs. Shapes: near-square, narrow/deep rectangle, wide/shallow rectangle, and a surveyed convex irregular quadrilateral. Level programs: 2.5, 3 and 3.5 storeys with explicit partial polygons. Orientations: north at 0/90/180/270 degrees relative to the drawing. Parking programs: two motorcycles; two motorcycles plus an actual-size car.

Assign architect-reviewed dimensions and a feasible room program to each positive fixture; a four-aana label alone does not establish feasibility. Run each request with three deterministic seeds, giving **288 generation runs**. Record up to three valid options per run; seeds are not a substitute for three distinct options returned to a user.

Add **24 boundary/conflict requests**: 12 negative cases below and 12 near-limit positive counterparts selected by the architect. Test just below/at/above limits where applicable, with tolerances tied to model precision. Add **12 measurement/provenance requests** for side lengths, ambiguous shapes, mixed units, north and later survey corrections. This makes **132 declared requests**, before seed repetitions. Expand the corpus when defects appear; publish the actual count run, not merely this target.

Run a separate Pokhara validation subset of at least 12 reviewed requests against its verified rules. If that pack remains incomplete, report it as an unresolved research result, not a passing jurisdiction.

## 3. Required failure cases

| Case | Expected behavior |
|---|---|
| Four irregular side lengths with no shape-defining information | Ask for sufficient diagonal/angle/sketch information or clearly label an approximate assumption; no false exact area |
| Plot dimensions cannot form the entered polygon | Explain inconsistent measurements before generation |
| Site has no legal buildable envelope | Show which site/rule constraints conflict; do not shrink setbacks silently |
| Unknown coverage/parking accounting rule | Mark unresolved and prevent permit-compliance status |
| Excess program on small plot | Explain floor/room/parking constraints and suggest user-approved changes |
| Essential Vaastu conflicts with legal opening/site constraints | Explain conflict without violating either silently |
| North missing or uncertain | Vaastu checks unevaluated; exploratory geometry remains possible |
| Neighbor-blocked or prohibited boundary windows | No daylight credit from those openings; use a feasible alternative or report failure |
| Beam intersects stair clearance or landing | Reject candidate; show geometry and required correction |
| Column discontinuity or unreviewed transfer configuration | Require engineered resolution; no “earthquake-safe” badge |
| Car fits rectangle but cannot enter/maneuver | Parking fails until access path is feasible |
| Partial top floor disconnects stairs, services or load path | Reject affected candidate or request review, with explicit issue IDs |

## 4. Product and geometric acceptance

For each declared supported positive fixture:

- Preserve every required room/count, level assignment, opening-width selection, essential Vaastu rule and parking requirement, or report failure explicitly.
- Return three independently valid options with meaningful differences in access/core position, room adjacency or per-level allocation. Compare canonical geometry and room graphs; exclude furniture-only, color-only and camera-only variants. Use architect review to establish useful diversity thresholds before freezing numeric scores.
- Validate room accessibility/privacy, clearances, actual usable area after structure/finishes, legal exterior openings, stairs and wet-core continuity.
- Every critical mandatory rule has a pass or an explicit manual-review finding; no unknown result treated as pass.
- Every exported/model view uses the same building revision and units. A correction to a window or stair must appear everywhere.
- Every unsupported request receives an explanation before a chargeable generation job where discoverable in preflight. For later discovered failures, follow the existing transparent credit-restoration workflow; verify rather than assume it covers the Nepal route.

Add invariance tests: unit roundtrip; moving local origin; rotating site and north together; opening geometry on host walls; edits/save/reload preserving metadata; one storey's change invalidating affected engineering approvals. Rotation tests must preserve real north semantics rather than rotate rooms into different Vaastu outcomes unintentionally.

## 5. Quantities and precision

Agree independent QS reference quantities and measurement conventions first. For each selected measurable item, calculate signed error and absolute percentage error against its reference. Show item-level errors rather than letting large concrete quantities hide a bad door count.

Target ≤5% for each agreed geometric quantity on pilot references, and exact counts for scheduled discrete objects. Zero/near-zero reference quantities need absolute tolerances. Reinforcement is compared only after the engineer supplies an approved schedule. Distinguish geometric volume, ordering/waste and priced quantity. Report exclusions, assumptions and reference uncertainty.

Do not use an area-based cost heuristic as the ground truth for quantities. Cost validation needs dated comparable quotes/BOQs with consistent scope; no ±5% total-cost promise is made by this plan.

## 6. CSV and evidence artifacts

Each implementation run should save `manifest.json`, exact request JSON, result JSON, `results.csv`, an HTML comparison gallery, and relevant plan/section/3D artifacts. Manifest includes repo commits, rule-pack hashes, fixture version, timestamps, seeds and reviewer status. Exclude personal property/owner data from public reports.

Recommended CSV columns:

`case_id, jurisdiction, ward_fixture, site_fixture, geometry_status, plot_area_m2, buildable_area_m2, north_deg, level_program, stair_type, bedrooms_requested, bathrooms_requested, bike_count, car_count, vaastu_profile, seed, expected_outcome, preflight_outcome, generated_count, valid_count, distinct_count, present_requirements, missing_requirements, mandatory_violations, vaastu_conflicts, manual_reviews, structural_conflicts, mep_conflicts, quantity_max_error_pct, duration_ms, model_revision, rule_pack_version, backend_commit, artifact_path`

Summary tables: outcomes by plot family, level count, parking and municipality; most frequent errors; diversity distribution; requirement fidelity; quantity variance; runtime. Record repaired cases and regression comparisons. Never merge “not run” with “passed.”

## 7. Proposed permit drawing package

Final requirements come from the specific municipality/project checklist. This is a coordination baseline, not a claim that each sheet is universally required or sufficient.

| Discipline | Proposed content | Responsibility |
|---|---|---|
| Cover/site | Drawing index, owner/site identification in controlled copy, location/site plan, survey reference, north, access/ROW/setbacks, area/FAR/coverage calculations and rule editions | Architect/surveyor |
| Architecture | Dimensioned plans for every full/partial level and roof; room uses, openings, shafts, grids, furniture reference, levels and material notes | Architect |
| Elevations/sections | Required elevations; sections through stairs and critical levels; roof/parapet/drainage, overall height and adjacent conditions as required | Architect coordinated with engineers |
| Stair/details | Flight/landing dimensions, risers, finished levels, clearances, guard/handrail and waterproofing/interface details | Architect + structural engineer |
| Schedules | Door/window IDs and counts by level and overall; dimensions, type/material and references; finishes where required | Architect |
| Structure | Design basis/calculations, foundation layout/details, column/beam/slab/stair schedules, reinforcement and connections, tank/roof provisions | Structural engineer; no generated placeholder engineering |
| Services | Required water/sanitary/rainwater/electrical/mechanical plans, risers, schedules and calculations | Relevant engineer/reviewer |
| Supporting records | Required ownership/site approvals, forms, professional credentials/signatures and other authority-required reports | Submission lead + owner |

Export architecture in editable layered CAD plus plotted PDF; supply native DWG if required through a validated conversion workflow. Retain distinct cut/projection/overhead/hidden/center/dimension/hatch/structural/service layers and meaningful plotted lineweights. Check closed wall/room boundaries, junction connectivity, duplicate segments, dimension consistency, Unicode font embedding and sheet readability at intended scale.

## 8. Release gate

Before “approved for submission”: all required documents present, no unresolved critical issues, professional reviews cover the exact revision, calculations match geometry, and actual target CAD/PDF checks pass. Submission and municipal approval are separate states. Do not add simulated stamps, signatures or approval numbers.

Keep the US production release unchanged until tested shared changes are intentionally released. Record deployment and rollback separately from professional approval of an individual project's drawings.
