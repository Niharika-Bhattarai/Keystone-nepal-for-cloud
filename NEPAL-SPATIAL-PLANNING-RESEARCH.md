# Nepal spatial planning: evidence, model defects, and solver design

2026-09-30. Scope: isolated Nepal prototype. This document supersedes the idea that rearranging rectangular room strips is sufficient. It records research and an implementation specification; the proposed solver is **not implemented or trained**.

## Evidence and what it means

| Reference inspected | Observation | Adoptable principle and limit |
|---|---|---|
| Supplied `Reference Drawings/newplans.pdf`, physical p. 3, Mandip Subedi residence | Irregular site/road boundary; regular major room bays, angled edge geometry, a secondary grid line 1′, parking and a 12 × 11 ft 6 in green space; kitchen/dining and living form related spaces | Preserve regular furniture zones while adapting perimeter/service/outdoor geometry. A court must be allocated before rooms. This is a larger 1,494 ft² floor, so do not squeeze the same program into the approximately 881 ft² Plan 1 footprint. The sheet's 19 ft bay is not automatically acceptable under our owner's 14 ft preference. |
| Supplied `COMPLILED PDF 2.5.2020.pdf`, pp. 2–3 | Ground parking, compact W/Cs; first-floor family room as distributor; balcony beyond the enclosed family-room wall, reached through a door | Circulation can share living/family space but needs a measured clear route. Balcony slab, enclosure, railing and access are separate elements. The drawing includes an internal family-room column; our owner specifically disallows that, so it is not a template to copy unquestioningly. |
| Supplied `2.3.2021_Jivendra Residence Design.pdf`, pp. 2–3 | Furnished living/kitchen-dining, porch, explicit double entry, bedrooms and compact W/Cs organized by frame | Check furniture before treating room area as success; show door leaves and stairs in readable architectural symbols. This larger house is not evidence that every small house needs its closets or room areas. |
| Supplied `MADHAVKC RESIDENCE -9.12.2021 A1.pdf`, p. 1 | Compact service spaces, private and communal balconies, upper kitchen/puja/terrace; site-specific setback and public land annotations | Separate road/public-land/neighbor conditions per edge. Floor uses change vertically. A drawn 5 ft setback is precedent-specific, not a universal rule. |
| [Studio NEBA, S Residence](https://studioneba.com/s-residence/) — architect's built-project account | Compact irregular Kathmandu plot; communal lower floor, private upper spaces, flexible family use | Public/private organization and changing household needs belong in the brief; irregular boundaries need usable interiors rather than maximum area alone. Three road edges make this different from a two-party-wall plot. |
| [Studio NEBA, Brownstone](https://studioneba.com/brownstone/) — architect's **concept**, not built-project proof | Patan courtyard setting; independent lower rental levels, upper private home, roof lighting and kitchen terrace | The user's rental/owner arrangement has a relevant local precedent. Preserve separate access and vertically coordinated outdoor/light spaces. Do not transfer heritage-site rules to every municipality. |
| [EERI/IAEE World Housing Encyclopedia, report 99](https://world-housing.net/report-99-traditional-nawari-house-in-kathmandu-valley/) | Traditional Newar housing organized vertically and in rows/courtyard clusters | Support distinct domestic profiles. Traditional masonry room/floor patterns are cultural evidence, not an RC/seismic design specification or a rule for every Nepali household. |

Nepal is not one household pattern. The immediate target is the owner's contemporary urban RC/brick house, often with rental flats, a shared side stair and an owner duplex above. Traditional Newar courtyard organization offers useful privacy and outdoor-space principles. Those principles must not become rigid assumptions about every family, caste, gender, religion or region. Vaastu is an explicitly selected preference; safety, adopted rules and essential user requirements remain feasibility constraints.

## Diagnosis of the current engine

1. `roomPlanner.js` constructs a few prescribed strips and special cases. It cannot freely select adjacency, rooms wrapping a core, several cells per room, non-orthogonal edges or a coordinated lightwell. Increasing the score quality cannot recover layouts never proposed.
2. `candidateSearch.js` adjusts structural row positions after rooms exist. Structure, access and room boundaries should be coupled decisions. No proof of structural adequacy follows from a 14 ft adjacent-axis cap.
3. The slab, occupied interior, balcony and roof outlines are not independent enough. An in-footprint open terrace currently substitutes for a projecting balcony. Partial tops are not fully classified as roof versus enclosed rooms.
4. Openings reserve one-dimensional wall intervals. They lack a final leaf/hinge/sweep, weather boundary, landing obstruction and furnished access check. This iteration adds readable proposed symbols, **not verified swing geometry**.
5. `rainChajja.js` previously generated only four independent edge strips: convex corners were absent. This iteration adds contained corner joins. This remains a projection reservation, not permission to use a setback or a designed RC cantilever.
6. Nominal room dimensions deduct brick, but not all finish build-ups or column intrusions. A column partly entering a room is not counted by the current whole-column-in-room test. Future acceptance needs actual clear usable polygons and furniture, not that limited test.
7. Rankings include invalid candidates because this is an architect review tool. Ten hashes are not ten successful or meaningfully different houses.

## Space and boundary contracts

Create one shared geometry model used by plan, elevation, section, 3D, DXF and quantities:

- Site: surveyed polygon, road edges and widths, north, neighboring built edges, allowed envelope and projection policy with source/review status. Side lengths alone do not determine an irregular polygon.
- Floor: elevation, enclosing footprint, structural slab polygon, voids, balconies, canopies/chajjas and open terraces as distinct non-overlapping area categories where required. A balcony may overlap a roofed footprint in projection across floors; ledgers must union projected coverage correctly.
- Room: simple polygon; type, household/unit, intended uses, net finished area, inscribed furniture zones, required adjacencies, privacy class, accepted dimensions, and doors/windows.
- Boundary: each shared edge interval belongs to exactly two spaces or one space plus exterior/void. Type is solid wall, open internal connection, glazed enclosure, door, window, guard/parapet or no barrier. Resolve junctions once, rather than independently drawing both rooms' walls.
- Structure: column polygons and IDs, supporting beam graph, slab supports and vertical continuity. Added grid lines belong to the building model across floors; they are not decorative columns added to a room.
- Vertical void: common polygon and participating elevations; open-to-sky or roofed, drainage/access and served openings. A void cannot terminate under an opaque slab and still claim sky exposure.

For the user's “disconnected extension,” use a **distinct projecting balcony slab connected to the house** as the working interpretation; an actual structural separation needs a different support/joint design. Do not draw a disconnected floating island. Await the requested clarification of permanently open versus closable living/balcony connection. Working design preference is a wide closable glazed opening with real wall returns, threshold and outer guard. An open living/dining interior does not justify erasing the external weather boundary.

No balcony is “allowed” merely because it fits within the site polygon. Store `geometricallyFits`, `municipalProjectionAllowed`, `structuralSupportReviewed`, `guardAndDrainageResolved`, and `usableAccess` separately. With only 1 m side space, a 1.219 m projection extends 219 mm outside the parcel. Pulling the enclosing wall inward, using an inset terrace, choosing another edge, or changing the footprint are legitimate search moves; shrinking the balcony to an unusable ledge is not fulfillment.

## Lightwell and ventilation rules

Source: supplied NBC 206:2024, section 3.3, physical PDF p. 17; source SHA-256 `8a05ae932cf34394cf082dde0d16abd18044e030c94c89702a305f13fd2e7189`. Retrieved using `knowledge.py page nbc206-2024 page-0017`. Adoption and occupancy applicability remain explicit.

- The supplied normal-rise residential reference gives a **3 × 3 m internal court** for admitting light to a habitable room. A 1 m shaft must not satisfy that test just because a window touches it.
- In the hilly-region reference, natural-light openings are room area/10, kitchen area/8; natural-ventilation openings are room area/16. Glazing area and *effective openable* area are different facts.
- The source limits the part treated as naturally lighted to 7.5 m from the relevant opening. Area ratio alone is insufficient; measure distance within the room and verify actual exterior/open-verandah/court exposure.
- Bathroom/service shafts are a separate category. Their minimum dimensions, exhaust route and permissions require applicable rules; do not invent those by reusing the habitable court threshold or calling all shafts habitable courts.
- Court design must account for roof continuity, neighboring heights, shadow, privacy, rainwater discharge, cleaning access and kitchen exhaust. Geometric compliance is not a daylight/airflow simulation.

Area consequence on Plan 1: 9 m² of court is about **11% of its 81.8625 m² envelope**, before court walls/circulation. The planner must explicitly reallocate bedrooms, parking, living and service area around that loss. It cannot preserve every room size and merely label a residual gap “lightwell.”

## Mathematical formulation and implementation choice

Use a hierarchical constrained search first. This is a recommendation based on the current model deficiencies, not a claim of universal optimality. [OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver) provides integer constraint solving and distinguishes feasible, optimal, infeasible and unknown outcomes. A time-limited unknown result is not proof that the household brief is impossible.

**Decision variables:** footprint family and polygon, core position/orientation, grid axes, room assignment to connected cells, floor/unit membership, court polygon, balcony edge/depth, and opening intervals. Begin with discrete candidate grids and orthogonal cells; add surveyed angled boundary cells with polygon containment checks. Allow a room to be a union of connected cells. Never approximate an angled room's useful area by its bounding rectangle.

**Hard constraints:** site containment; adopted setbacks and projection limits; no overlapping occupied polygons; required per-floor room counts; correct independent rental access; reachability with effective clear widths and door sweeps; column-free functional zones; stair landing/rise/headroom; required daylight/ventilation; vertical core and service continuity; privacy/attached bathroom graph; no openings to a prohibited flush boundary. Structural analysis remains a separate gate, not a hand-written seismic reward.

For candidate P, define an explicit result for every constraint: pass, fail, unknown, not applicable. Only fully checked feasible candidates can be called successful. Keep review hypotheses accessible with unresolved facts visible.

**Objectives among feasible layouts**, in order: selected core Vaastu preferences; requested living/bedroom/kitchen furniture fit and privacy; daylight quality and usable outdoor space; net useful area and short circulation; economical frame regularity and wet-service stacking; lower geometric complexity; diversity. Use lexicographic tiers or a Pareto set. Never allow enough aesthetic reward to cancel a blocked exit or missing kitchen.

Suggested measured terms (initial optimization policy, not code):

- `circulationRatio = dedicatedCirculationArea / netUsableArea`; shared living routes must still pass a clear-path check and cannot be counted twice as usable furniture space.
- `roomDeviation = sum(abs(actualNetArea - targetArea) / targetArea)` with separate hard minima and functional fit.
- `privacyViolations`: paths to public functions through bedrooms, or another tenant's unit; required privacy failures are hard constraints.
- `gridCost`: column count plus engineer-defined irregularity, transfers and excessive span penalties. A 12-column result with poor load paths is not better than a coherent 16-column result.
- `diversity`: adjacency-graph edit distance, core/court positions, massing and furnished organization. Mirroring or tiny wall shifts alone must not count as architectural variety.

## Reinforcement learning: a useful later layer

[Kakooee and Dillenburger, 2024, SpaceLayoutGym](https://academic.oup.com/jcde/article/11/3/43/7636504) demonstrates PPO-based spatial layout optimization with geometric/topological objectives. That supports experimentation, not a guarantee of legal, structurally correct Nepal permit drawings.

Train a policy to propose structural/adjacency/court decisions or repair moves, with the same independent constraint oracle used by the deterministic solver. State includes the site, units, placed spaces, remaining program and available legal frontage. Actions include moving a core, splitting/merging usable cells, adding a court, reallocating a service bay, or proposing a supported extension. Mask impossible actions; terminate invalid plans with explicit failure reasons. Preserve the validator outside the learned policy.

Start with architect-approved reference traces and generated feasible examples. Record your before/after corrections as edits with rationale and preferences, not merely image pairs. Hold out whole plot families and project sources to avoid memorization. Evaluate household requirements, openings, furnished reachability, vertical coordination, measured variety, runtime and architect preference against the deterministic baseline. Training cost and dataset size must be measured in a pilot; there is no evidence yet to promise a budget or universal success rate.

## Ordered implementation and acceptance

1. **Drawing truth, current pass:** recognizable proposed doors with main-entry annotation; complete convex chajja corners; retain swing/projection uncertainty. Files: `reviewSheet.js`, `rainChajja.js`, related tests. Do not hide current defects through styling.
2. **Boundary model:** add `spaceBoundaries.js`; replace room-pair wall creation in `wallGeometry.js` with classified shared intervals. Persist exterior/glazed/guard boundaries. Acceptance: living cannot connect to balcony without explicit selected boundary; every exterior edge is classified; no doubled walls or unaccounted gaps.
3. **Functional validator:** add `usableSpace.js`, `accessGraph.js`, `doorGeometry.js`; coordinate in `candidateSearch.js`. Use actual clear polygons and furniture clearances; connect only physically valid portals. Acceptance: deliberately blocked corridors, intruding columns, unusable W/Cs and isolated rooms fail independent fixtures. Door handedness remains editable but must be validated after edits.
4. **Envelope/void model:** extend `siteEnvelope.js`, `areaLedger.js`, `frameGrid.js`; introduce supported slab and roof polygons. Add aligned court reservations and correct upper-level projections. Acceptance: area union versus independent polygon calculation; zero courtyard slab above lightwell; no invented corner on surveyed polygons; tested flush-edge and corner-lot scenarios.
5. **Constraint prototype:** isolated Python worker under `local/planner/` with pinned solver dependency and JSON contract. Existing Node local endpoint invokes it with a timeout. Enumerate topology/core/court options, solve dimensions, verify geometry independently, return infeasible/unknown distinctly. Keep the old review generator as a comparison while verifying parity, not a silent fallback presented as success.
6. **Pilot benchmark:** 3, 4, 5 and 6 aana rectangles; two flush edges; corner plots; narrow/deep and shallow/wide plots; 2.5 and 3.5 storeys; owner-only and lower rentals; bike and car requests; optional courts and balconies. Include infeasible briefs. CSV records exact inputs, solver status, every measured constraint, unknown rule, quality terms and graph-level variation. Review representative drawings by eye.
7. **Irregular extensions:** surveyed polygons, angled boundary cells, additional aligned support lines and furnished polygon rooms. Acceptance includes a trapezoidal parcel and stepped extension across floors; no beam/column support inferred merely from footprint.
8. **Learned policy pilot only after 2–7:** reuse the same oracle and holdout benchmark. Ship only if measurable architect-rated quality or search efficiency improves without losing verified feasibility.

Current stop condition for this research pass: source-linked principles, explicit current defects, detailed next implementation, and corrected immediate drawing communication. Court solving, general polygon room generation, true projecting balconies and RL training remain substantive implementation work; they are not claimed complete by this document.
