# Research findings and design decisions

Research date: 2026-09-30. Source IDs refer to [the source register](07-source-register.md). Requirements below are proposed product/engineering decisions unless explicitly described as a verified publication fact. Numeric municipal limits are deliberately not invented.

## 1. Geographic and regulatory scope

The owner confirmed Kathmandu Valley and Pokhara Valley, with a permit-submission target for one municipality. Use a shared Nepal model with separate local rule packs. Do not infer municipal identity from “Kathmandu,” a postal code or valley name. Collect municipality, ward, parcel/site reference, coordinates, road classification and applicable planning zone.

KMC's permit reference portal lists local building standards and amendments. Pokhara's official legislation directory lists its 2080 building/infrastructure standards and a first amendment in 2081. These are separate sources [S02, S03]. We have not completed a clause-by-clause reconciliation of those documents. That is a first-week task owned jointly by a local architect and the implementing engineer.

Treat airport/height restrictions, heritage controls, river/lake corridors, slope and geohazard restrictions as site-screening questions. Do not assign universal buffer distances. For Pokhara in particular, require the professional to screen the actual parcel for applicable waterbody, ground-condition and other local restrictions. This is a risk-screening recommendation, not a finding that every Pokhara parcel has the same restriction.

**Decision:** support ordinary approved pilot plots first. Basements, major slopes, heritage restrictions, disputed boundaries, commercial occupancies and uncertain planning overlays go to professional review before generation. Preserve the user's brief and show the reason rather than returning a generic failed plan.

## 2. Land area and buildable envelope

Using the conventional conversion of 342.25 square feet per aana, four aana is **1,369 sq ft, approximately 127.18 m²**. At an illustrative 70% coverage, the mathematical ceiling is **958.3 sq ft, approximately 89.03 m²**. This is an arithmetic example, not a verified entitlement. Have the surveyor confirm the title/survey units and reconcile recorded and measured area before using it for submission. A government-authored land administration reference was found through an archive, but the operative parcel record remains authoritative [S12].

Coverage alone does not define a footprint. Intersect the parcel with road/right-of-way constraints, required setbacks, any other site exclusions and the engineer's separation requirements. Then enforce the applicable coverage and FAR accounting separately. Site dimensions matter: the same area in a narrow strip and a near-square plot will support different programs.

The rule pack needs explicit accounting for roofed/unroofed parking, verandas, balconies, overhangs, stair enclosures, terraces, voids, tanks and partial levels. Record each inclusion/exclusion with its source and applicability. Unknown treatment means “needs rule confirmation,” not zero counted area.

## 3. RC frame and seismic design

DUDBC lists NBC 105:2025 for seismic design, NBC 206:2024 for architecture, and NBC 205:2024 as a low-rise RC detailing guideline **without masonry infill**. It separately lists NBC 201 concerning RC buildings with masonry infill [S01]. These titles establish a scope issue: do not copy a ready-to-use detailing table into the proposed brick-infill product without the structural engineer confirming eligibility and the analysis assumptions.

**Proposed workflow:** site and program → candidate frame grids/stair/service cores → room arrangements → professional structural analysis → revised member envelopes → collision checks → final drawings. Avoid designing a room plan and inserting arbitrary columns afterward.

Have the structural engineer determine the applicable analysis method, soil/site parameters, material strengths, loads and combinations, member sizes, foundations, reinforcement, ductile detailing and treatment of masonry infill. The software can detect configuration issues and preserve approved engineering data; those checks are not a substitute for analysis.

Model vertical continuity, eccentricity/irregularity review flags, open parking/storey discontinuities, roof tanks, stair interaction, parapets, infill openings, neighboring buildings and prospective future levels. Foundation constraints beside a boundary require specific design. A neat grid does not prove seismic adequacy.

**Month-one boundary:** use engineer-approved grid/member configurations for the pilot. Import/record the engineer's calculations and reinforcement schedules. Automated arbitrary RC sizing and reinforcement design are later work. Do not synthesize plausible-looking structural sheets from room geometry.

## 4. Multi-storey homes and stairs

Represent actual levels with elevations, slab/finish build-ups, footprint polygons, uses, occupancy and connections. Allow ground + first + partial second, or ground + first + second + partial third, without treating “half” as an invariant 50% area. Local rules decide how height, floor count and FAR are assessed.

Survey total room requirements and each floor's use: single family, relatives, future family expansion, or rental access. Separate rental units affect circulation, services, privacy and potentially classification; do not silently treat them as one household. Month one should select one clearly reviewed residential use for the real permit project.

Stairs need finished floor-to-floor rise, treads/risers, landings, handrails/guards, slab openings and three-dimensional clearance against beams and slabs. Show sections through the stair. Review usable clearance after plaster and finishes. Roof access and partial upper levels must remain connected. Adjacent plans must refer to the same stair assembly, not redraw unrelated stair symbols.

## 5. Vaastu as a real design input

Implement an explicit owner-approved Vaastu profile. Request the preferred book/consultant and edition before deciding directional rules. Traditions and interpretations differ; a generic web list is not a dependable contractual standard. NBC architectural requirements and cultural Vaastu are separate topics even where translated terminology looks similar.

Each adopted rule needs: room/activity, directional reference, test geometry, tolerance, severity, priority, source/page and explanation. Define whether placement uses room centroid, occupied zone, entrance position or another convention. True north, drawing rotation, road frontage and the direction someone faces at an entrance must be separate fields.

Use three outcomes per rule: satisfied, not satisfied, not evaluated. If a customer marks a rule essential and it conflicts with another essential condition, explain the incompatible requirements and offer changes; never silently downgrade it. All mandatory planning and safety requirements remain enforced. Advisory Vaastu preferences can rank otherwise valid plans.

Test cardinal and intercardinal sites, skewed plots, north rotations, narrow frontages and competing kitchen/puja/stair/wet-core requirements. Different paint or a mirrored thumbnail does not establish useful design diversity. Do not claim Vaastu provides engineering safety or guaranteed health/financial outcomes.

## 6. Boundary conditions, light and ventilation

Observed neighboring construction does not establish a legal right to build flush to a boundary. Model each edge's legal setback, opening permission, fire/separation requirement, adjacent obstruction and available survey evidence independently.

A window drawn on a boundary wall is not usable daylight. Evaluate opening exposure and room access to outside air/light using the verified local rules. Reserve courtyards/light wells and service shafts early, and check their dimensions on every affected level. A shaft useful for pipes is not automatically suitable as habitable-room daylight.

Begin with deterministic opening, clearance and obstruction checks. For selected difficult rooms, use a reviewed daylight workflow such as Radiance [S09], with actual neighboring geometry and material assumptions. Label simulation results as conditional; do not convert a colorful render into a daylight compliance claim. Climate, rain protection, damp control and drainage details need separate review for each pilot location.

## 7. Parking and outdoor use

Ask for motorcycle count, actual vehicle sizes, optional car, gate position, entry route, turning/maneuvering assumptions and whether the user wants covered parking. Preserve pedestrian access and emergency/maintenance paths. Parking outside enclosed floor area still consumes plot geometry and may affect coverage accounting.

Use swept-path or explicit maneuvering checks for the selected car. Include gate swing and ramp/threshold geometry when relevant. Avoid supporting a car by deleting a requested bedroom or pushing a stair through the frame. Roofed/open/stilt configurations are distinct cases with different review requirements.

## 8. Materials, facade and quantity/cost

Create Nepal assemblies for RC members/slabs, brick infill, plaster, waterproofing, screed, floor finishes, local door/window systems and roof drainage. Collect real thicknesses, specifications and workmanship allowances; do not merely relabel US timber-frame costs.

Offer multicolor facade palettes as selectable materials on the actual model. Keep columns, openings, parapets, rainwater downpipes, shading and balconies aligned with the approved geometry. Image generation can be a presentation option but cannot become the drawing source of truth.

Quantities must distinguish net in-place work, waste and purchase quantities. Derive concrete from coordinated solids without double-counting beam/slab/column intersections; reinforcement from approved schedules; brickwork net of members and relevant openings; plaster by actual exposed face. State the measurement convention for deductions and junctions.

Use NPR prices by district/locality, date, supplier, specification, unit, tax, delivery and labor inclusion. District schedules are a reference to verify for the target district/year, not proof of a contractor's current installed price. Do not promise ±5% total cost. Target ≤5% error for individually audited, deterministically measurable quantities on the agreed pilot references; report unknown engineering quantities separately.

## 9. Feasibility conclusion

This is viable as a **professionally assisted Nepal product**, not a country switch on the existing US generator. The first month can deliver a single reviewed submission project if site inputs, reviewers and engineering work begin immediately. A broadly autonomous permit generator across both valleys is outside that month.

The highest schedule risks are missing site/geotechnical inputs, late interpretation of municipal rules, multi-storey/frame integration and engineering redesign. Prioritize these ahead of facade polish, payment changes or expansion to more municipalities.
