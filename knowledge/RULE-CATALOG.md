# Source-linked house-design rule catalog

93 curated rules. Highest design preference: Vaastu. Mandatory legal/safety constraints remain gates. Source facts and Keystone operationalization are distinguished in each rule. No professional approval is claimed.

Read [the synthesis](DESIGN-PRINCIPLES.md) and [integration contract](INTEGRATION.md) before using these rules.

## G01 — Confirm local adoption and municipal overlay

Priority tier: **0**. Tags: jurisdiction, coverage, setback, code

Use applicable national provisions plus municipal rules; shared valley geography does not prove identical bylaws.

**Measure:** Record municipality, ward, rule versions and reviewer confirmation.

**Repair:** Resolve missing overlay before compliance claims.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0001](sources/nbc206-2024.md#page-0001), [nbc206-2024 page-0005](sources/nbc206-2024.md#page-0005)

**Executable fact predicate:** `{"fact": "jurisdiction.reviewed", "op": "eq", "value": true}`.

## G02 — Do not use draft commentary as the current seismic code

Priority tier: **0**. Tags: seismic, earthquake, code

The uploaded commentary labels itself a draft and discusses an older seismic code.

**Measure:** Current project design basis independently confirmed; draft excluded from automatic code thresholds.

**Repair:** Obtain applicable NBC 105 and engineer-approved analysis basis.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc105-commentary-draft page-0001](sources/nbc105-commentary-draft.md#page-0001), [nbc105-commentary-draft page-0002](sources/nbc105-commentary-draft.md#page-0002)

**Executable fact predicate:** `{"fact": "structure.design_basis_reviewed", "op": "eq", "value": true}`.

## G03 — Verify NBC 205 eligibility as a whole

Priority tier: **0**. Tags: structure, grid, partial, floor, earthquake

Ready-to-use details depend on all scope and layout restrictions, not a single column-spacing check.

**Measure:** Review clauses 1.2, 4.1 and 4.2 including height, bays, projections, area and regularity.

**Repair:** Use individually engineered design when outside eligibility.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc205-2024 page-0015](sources/nbc205-2024.md#page-0015), [nbc205-2024 page-0016](sources/nbc205-2024.md#page-0016), [nbc205-2024 page-0017](sources/nbc205-2024.md#page-0017)

**Executable fact predicate:** `{"fact": "structure.route_reviewed", "op": "eq", "value": true}`.

## G04 — Represent nonstructural masonry correctly

Priority tier: **0**. Tags: brick, infill, structure

NBC 205 describes a frame without relying on masonry for vertical/seismic resistance; it also specifies brickwork. The title does not prohibit every brick wall.

**Measure:** Engineer decides actual infill interaction and loading model.

**Repair:** Revise model and calculations; never remove infill loads by a label.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc205-2024 page-0015](sources/nbc205-2024.md#page-0015), [nbc205-2024 page-0018](sources/nbc205-2024.md#page-0018)

**Executable fact predicate:** `{"fact": "structure.infill_model_reviewed", "op": "eq", "value": true}`.

## G05 — Preserve a verified structural load path

Priority tier: **0**. Tags: structure, columns, beams, grid

The ready-to-use route requires vertical continuous lateral-load columns and restricts irregularity.

**Measure:** Check every member across levels and approved foundation/transfer conditions.

**Repair:** Move room/core arrangement, not unilaterally remove a column.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc205-2024 page-0016](sources/nbc205-2024.md#page-0016), [nbc205-2024 page-0017](sources/nbc205-2024.md#page-0017)

**Executable fact predicate:** `{"fact": "structure.load_path_reviewed", "op": "eq", "value": true}`.

## G06 — No Vaastu change may create unsafe geometry

Priority tier: **0**. Tags: safety, stairs, door, daylight

Mandatory spatial and safety conditions remain gates before Vaastu ranking.

**Measure:** Run adopted geometry/egress/structural/service checks after every preference repair.

**Repair:** Report conflicting requirements and propose a safe alternative.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0015](sources/nbc206-2024.md#page-0015), [nbc206-2024 page-0016](sources/nbc206-2024.md#page-0016), [nbc206-2024 page-0017](sources/nbc206-2024.md#page-0017), [vastu-chakrabarti page-0140](sources/vastu-chakrabarti.md#page-0140)

**Executable fact predicate:** `{"fact": "geometry.mandatory_checks_passed", "op": "eq", "value": true}`.

## C01 — Residential stair minimum tread

Priority tier: **0**. Tags: code, residential, stairs

Uploaded NBC 206:2024 2.4.1 Table 4: gte 250 mm; confirm adopted scope before enforcement.

**Measure:** Use worst measured value across every applicable instance; stairs.minimum_tread_mm. Flat/pitched roof and room classification exceptions require separate treatment.

**Repair:** Revise geometry and rerun all dependent validations. Minimum size alone does not prove furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0015](sources/nbc206-2024.md#page-0015)

**Executable fact predicate:** `{"fact": "stairs.minimum_tread_mm", "op": "gte", "value": 250}`.

**Applicability:** `{"fact": "code.nbc206_2024_general_residential_confirmed", "op": "eq", "value": true}`.

## C02 — Residential stair maximum riser

Priority tier: **0**. Tags: code, residential, stairs

Uploaded NBC 206:2024 2.4.1 Table 4: lte 190 mm; confirm adopted scope before enforcement.

**Measure:** Use worst measured value across every applicable instance; stairs.maximum_riser_mm. Flat/pitched roof and room classification exceptions require separate treatment.

**Repair:** Revise geometry and rerun all dependent validations. Minimum size alone does not prove furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0015](sources/nbc206-2024.md#page-0015)

**Executable fact predicate:** `{"fact": "stairs.maximum_riser_mm", "op": "lte", "value": 190}`.

**Applicability:** `{"fact": "code.nbc206_2024_general_residential_confirmed", "op": "eq", "value": true}`.

## C03 — Maximum risers in each flight

Priority tier: **0**. Tags: code, residential, stairs

Uploaded NBC 206:2024 2.4.1 Table 4: lte 15 risers; confirm adopted scope before enforcement.

**Measure:** Use worst measured value across every applicable instance; stairs.maximum_flight_risers. Flat/pitched roof and room classification exceptions require separate treatment.

**Repair:** Revise geometry and rerun all dependent validations. Minimum size alone does not prove furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0015](sources/nbc206-2024.md#page-0015)

**Executable fact predicate:** `{"fact": "stairs.maximum_flight_risers", "op": "lte", "value": 15}`.

**Applicability:** `{"fact": "code.nbc206_2024_general_residential_confirmed", "op": "eq", "value": true}`.

## C04 — Stair clear headroom

Priority tier: **0**. Tags: code, residential, stairs

Uploaded NBC 206:2024 2.4.1 Table 4: gte 2000 mm; confirm adopted scope before enforcement.

**Measure:** Use worst measured value across every applicable instance; stairs.minimum_headroom_mm. Flat/pitched roof and room classification exceptions require separate treatment.

**Repair:** Revise geometry and rerun all dependent validations. Minimum size alone does not prove furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0015](sources/nbc206-2024.md#page-0015)

**Executable fact predicate:** `{"fact": "stairs.minimum_headroom_mm", "op": "gte", "value": 2000}`.

**Applicability:** `{"fact": "code.nbc206_2024_general_residential_confirmed", "op": "eq", "value": true}`.

## C05 — Habitable room height

Priority tier: **0**. Tags: code, residential, room, dimensions

Uploaded NBC 206:2024 3.2.1: gte 2400 mm; confirm adopted scope before enforcement.

**Measure:** Use worst measured value across every applicable instance; rooms.minimum_habitable_height_mm. Flat/pitched roof and room classification exceptions require separate treatment.

**Repair:** Revise geometry and rerun all dependent validations. Minimum size alone does not prove furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0016](sources/nbc206-2024.md#page-0016)

**Executable fact predicate:** `{"fact": "rooms.minimum_habitable_height_mm", "op": "gte", "value": 2400}`.

**Applicability:** `{"fact": "code.nbc206_2024_general_residential_confirmed", "op": "eq", "value": true}`.

## C06 — Clearance below beams or false ceilings

Priority tier: **0**. Tags: code, residential, room, dimensions

Uploaded NBC 206:2024 3.2.1: gte 2100 mm; confirm adopted scope before enforcement.

**Measure:** Use worst measured value across every applicable instance; rooms.minimum_clear_height_below_obstruction_mm. Flat/pitched roof and room classification exceptions require separate treatment.

**Repair:** Revise geometry and rerun all dependent validations. Minimum size alone does not prove furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0016](sources/nbc206-2024.md#page-0016)

**Executable fact predicate:** `{"fact": "rooms.minimum_clear_height_below_obstruction_mm", "op": "gte", "value": 2100}`.

**Applicability:** `{"fact": "code.nbc206_2024_general_residential_confirmed", "op": "eq", "value": true}`.

## C07 — Bathroom or WC height

Priority tier: **0**. Tags: code, residential, room, dimensions

Uploaded NBC 206:2024 3.2.1: gte 2000 mm; confirm adopted scope before enforcement.

**Measure:** Use worst measured value across every applicable instance; bathrooms.minimum_height_mm. Flat/pitched roof and room classification exceptions require separate treatment.

**Repair:** Revise geometry and rerun all dependent validations. Minimum size alone does not prove furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0016](sources/nbc206-2024.md#page-0016)

**Executable fact predicate:** `{"fact": "bathrooms.minimum_height_mm", "op": "gte", "value": 2000}`.

**Applicability:** `{"fact": "code.nbc206_2024_general_residential_confirmed", "op": "eq", "value": true}`.

## C08 — Habitable room minimum dimension

Priority tier: **0**. Tags: code, residential, room, dimensions

Uploaded NBC 206:2024 3.2.2 A: gte 2000 mm; confirm adopted scope before enforcement.

**Measure:** Use worst measured value across every applicable instance; rooms.minimum_habitable_dimension_mm. Flat/pitched roof and room classification exceptions require separate treatment.

**Repair:** Revise geometry and rerun all dependent validations. Minimum size alone does not prove furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0016](sources/nbc206-2024.md#page-0016)

**Executable fact predicate:** `{"fact": "rooms.minimum_habitable_dimension_mm", "op": "gte", "value": 2000}`.

**Applicability:** `{"fact": "code.nbc206_2024_general_residential_confirmed", "op": "eq", "value": true}`.

## C09 — Habitable room minimum area

Priority tier: **0**. Tags: code, residential, room, dimensions

Uploaded NBC 206:2024 3.2.2 A: gte 6 m2; confirm adopted scope before enforcement.

**Measure:** Use worst measured value across every applicable instance; rooms.minimum_habitable_area_m2. Flat/pitched roof and room classification exceptions require separate treatment.

**Repair:** Revise geometry and rerun all dependent validations. Minimum size alone does not prove furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0016](sources/nbc206-2024.md#page-0016)

**Executable fact predicate:** `{"fact": "rooms.minimum_habitable_area_m2", "op": "gte", "value": 6}`.

**Applicability:** `{"fact": "code.nbc206_2024_general_residential_confirmed", "op": "eq", "value": true}`.

## C10 — Kitchen minimum dimension

Priority tier: **0**. Tags: code, residential, room, dimensions

Uploaded NBC 206:2024 3.2.2 B: gte 1800 mm; confirm adopted scope before enforcement.

**Measure:** Use worst measured value across every applicable instance; kitchens.minimum_dimension_mm. Flat/pitched roof and room classification exceptions require separate treatment.

**Repair:** Revise geometry and rerun all dependent validations. Minimum size alone does not prove furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0016](sources/nbc206-2024.md#page-0016)

**Executable fact predicate:** `{"fact": "kitchens.minimum_dimension_mm", "op": "gte", "value": 1800}`.

**Applicability:** `{"fact": "code.nbc206_2024_general_residential_confirmed", "op": "eq", "value": true}`.

## C11 — Kitchen minimum area

Priority tier: **0**. Tags: code, residential, room, dimensions

Uploaded NBC 206:2024 3.2.2 B: gte 5 m2; confirm adopted scope before enforcement.

**Measure:** Use worst measured value across every applicable instance; kitchens.minimum_area_m2. Flat/pitched roof and room classification exceptions require separate treatment.

**Repair:** Revise geometry and rerun all dependent validations. Minimum size alone does not prove furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0016](sources/nbc206-2024.md#page-0016)

**Executable fact predicate:** `{"fact": "kitchens.minimum_area_m2", "op": "gte", "value": 5}`.

**Applicability:** `{"fact": "code.nbc206_2024_general_residential_confirmed", "op": "eq", "value": true}`.

## C12 — Exit width is occupancy-dependent

Priority tier: **0**. Tags: stairs, circulation, code

General residence minimum in Table 3 is 0.9m, but capacity, classification and effective occupant load also govern.

**Measure:** Implement full reviewed clause 2.4/Table 3 route; do not treat 900mm as universally sufficient.

**Repair:** Increase width or revise egress design; engineer/architect check.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0013](sources/nbc206-2024.md#page-0013), [nbc206-2024 page-0014](sources/nbc206-2024.md#page-0014)

## C13 — Light and ventilation are separate tests

Priority tier: **0**. Tags: daylight, windows, ventilation, kitchen

Section 3.3 distinguishes daylight opening area, ventilation area, kitchens and climate region.

**Measure:** Check legal exposed openings, openable area and every room; inspect reference-example arithmetic before use.

**Repair:** Reposition rooms/openings or introduce a compliant court; no credit for blocked windows.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0017](sources/nbc206-2024.md#page-0017)

## C14 — Internal daylight court is not a pipe shaft

Priority tier: **0**. Tags: courtyard, daylight, shaft

Section 3.3 gives a 3m by 3m minimum internal court for natural light to habitable rooms in normal-rise buildings.

**Measure:** Verify normal-rise applicability, every court dimension and its open geometry; taller-building provisions require review.

**Repair:** Reserve a compliant court early or find another compliant daylight solution.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0017](sources/nbc206-2024.md#page-0017)

## C15 — Limit naturally lit room depth

Priority tier: **0**. Tags: daylight, room, depth

Section 3.3 excludes portions more than 7.5m from the relevant opening from being considered naturally lighted.

**Measure:** Evaluate the room polygon, not merely centroid distance.

**Repair:** Adjust room depth/openings; professional daylight review.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0017](sources/nbc206-2024.md#page-0017)

## C16 — Confirm toilet type before applying dimensions

Priority tier: **0**. Tags: toilet, bathroom, dimensions

Separate WC, bathroom and combined WC/bathroom have different minima in section 3.2.2.

**Measure:** Use source table: WC 0.9m/1.2m2; bath 1.2m/1.8m2; combined 1.2m/2.8m2, plus actual fixture clearances.

**Repair:** Resize or reclassify honestly; do not use WC-only area for a shower room.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc206-2024 page-0016](sources/nbc206-2024.md#page-0016)

## C17 — Coordinate water and waste with maintenance access

Priority tier: **0**. Tags: mep, water, drainage

Use the sanitary/plumbing source for project-specific provisions after adoption review, not a directional preference as engineering design.

**Measure:** Resolve pipe slopes, capacities, outfalls, hygiene/separation and service access with cited clauses.

**Repair:** Move routing or tank/core positions without violating engineering constraints.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc208-2003 page-0001](sources/nbc208-2003.md#page-0001)

## B01 — Separate FAR, coverage and usable area

Priority tier: **0**. Tags: area, far, coverage, bylaw, permit, separate, far,, coverage, and, usable, area

FAR is counted floor area divided by plot area; coverage is counted ground footprint divided by plot area times 100. These are different accounts.

**Measure:** Maintain separate source-linked ledgers and explicit denominator; do not use carpet area as gross counted area.

**Repair:** Recompute each metric independently.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [bylaws-resource-2023 page-0015](sources/bylaws-resource-2023.md#page-0015), [bylaws-resource-2023 page-0051](sources/bylaws-resource-2023.md#page-0051), [bylaws-resource-2023 page-0054](sources/bylaws-resource-2023.md#page-0054)

## B02 — Make floor-area inclusions explicit

Priority tier: **0**. Tags: area, far, coverage, bylaw, permit, make, floor-area, inclusions, explicit

The glossary and FAR examples disagree on basements and balconies. Stair and parking exclusions also need applicable local confirmation.

**Measure:** Every spatial component has independent FAR and coverage inclusion decisions and source/reviewer evidence. Unknown decisions block a final total.

**Repair:** Resolve the local adopted definition; retain both conflicting references.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [bylaws-resource-2023 page-0015](sources/bylaws-resource-2023.md#page-0015), [bylaws-resource-2023 page-0052](sources/bylaws-resource-2023.md#page-0052)

## B03 — Coverage depends on plot size and occupancy

Priority tier: **0**. Tags: area, far, coverage, bylaw, permit, coverage, depends, on, plot, size, and, occupancy

Resource section 1.2.4 lists residential/mixed residential coverage at 70% up to 250m2 and 60% above; this is a sourced candidate rule, not confirmed adoption for every municipality.

**Measure:** Test boundary 250m2 and occupancy; distinguish the separate model-bylaw table on next page.

**Repair:** Select reviewed local rule and all other constraints before generation.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [bylaws-resource-2023 page-0054](sources/bylaws-resource-2023.md#page-0054), [bylaws-resource-2023 page-0055](sources/bylaws-resource-2023.md#page-0055)

## B04 — Do not hardcode a valley-wide FAR

Priority tier: **0**. Tags: area, far, coverage, bylaw, permit, do, not, hardcode, a, valley-wide, far

The resource illustrates KMC residential FAR 2.5 but also reproduces a model-bylaw residential value 1.75.

**Measure:** Track instrument, locality, use, road conditions and edition instead of selecting the more generous value.

**Repair:** Obtain the current applicable local FAR.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [bylaws-resource-2023 page-0051](sources/bylaws-resource-2023.md#page-0051), [bylaws-resource-2023 page-0052](sources/bylaws-resource-2023.md#page-0052)

## B05 — Parking exemption is metric-specific

Priority tier: **0**. Tags: area, far, coverage, bylaw, permit, parking, exemption, is, metric-specific

The glossary excludes vehicle-parking/loading use from floor area. That does not establish a ground-coverage exemption for every roofed garage.

**Measure:** Classify open, roofed, enclosed, stilt and basement parking separately with FAR/coverage decisions.

**Repair:** Preserve actual plot use and access regardless of counting exemption.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [bylaws-resource-2023 page-0015](sources/bylaws-resource-2023.md#page-0015), [bylaws-resource-2023 page-0054](sources/bylaws-resource-2023.md#page-0054)

## B06 — Count actual partial-level geometry

Priority tier: **0**. Tags: area, far, coverage, bylaw, permit, count, actual, partial-level, geometry

Total floor area is accumulated over actual floors; a colloquial half-storey is not a fixed scalar.

**Measure:** Use each level polygon and use-specific exclusions, avoiding double-counted stairs/voids.

**Repair:** Recompute from versioned spatial components.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [bylaws-resource-2023 page-0015](sources/bylaws-resource-2023.md#page-0015), [bylaws-resource-2023 page-0051](sources/bylaws-resource-2023.md#page-0051)

## B07 — Apply setbacks and ROW independently of coverage

Priority tier: **0**. Tags: area, far, coverage, bylaw, permit, apply, setbacks, and, row, independently, of, coverage

Coverage permission alone does not define a legal footprint. Resource distinguishes opening-side, blank-wall, road and height-related conditions.

**Measure:** Intersect actual site with applicable constraints and check projections; zero blank-wall setback is not a universal separation waiver.

**Repair:** Resolve adopted local conditions and engineered separation.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [bylaws-resource-2023 page-0016](sources/bylaws-resource-2023.md#page-0016), [bylaws-resource-2023 page-0056](sources/bylaws-resource-2023.md#page-0056), [bylaws-resource-2023 page-0057](sources/bylaws-resource-2023.md#page-0057)

## B08 — Treat height, FAR and light plane as simultaneous limits

Priority tier: **0**. Tags: area, far, coverage, bylaw, permit, treat, height,, far, and, light, plane, as, simultaneous, limits

Resource describes height controlled alongside FAR and light-plane provisions.

**Measure:** Evaluate actual levels/roof and local height definition; do not infer allowed storeys from FAR alone.

**Repair:** Revise program or level geometry.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [bylaws-resource-2023 page-0060](sources/bylaws-resource-2023.md#page-0060)

## B09 — Classify soil/engineering requirements before design route

Priority tier: **0**. Tags: area, far, coverage, bylaw, permit, classify, soil/engineering, requirements, before, design, route

Resource discusses building categories and investigation requirements; historical thresholds must be reconciled with current instruments.

**Measure:** Store project classification and professional interpretation; do not copy an inconsistent translated category into automatic eligibility.

**Repair:** Use reviewed current engineering route.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [bylaws-resource-2023 page-0071](sources/bylaws-resource-2023.md#page-0071), [bylaws-resource-2023 page-0111](sources/bylaws-resource-2023.md#page-0111), [bylaws-resource-2023 page-0112](sources/bylaws-resource-2023.md#page-0112), [bylaws-resource-2023 page-0197](sources/bylaws-resource-2023.md#page-0197)

## B10 — Permit workflow has staged technical and site checks

Priority tier: **0**. Tags: area, far, coverage, bylaw, permit, permit, workflow, has, staged, technical, and, site, checks

Resource separates designer submission, bylaw/code checks, field verification and staged permits.

**Measure:** Keep submitted, reviewed, approved and built/inspected states separate; use the municipality current procedure.

**Repair:** Do not call generated files a permit or assume a 30-day authority decision.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [bylaws-resource-2023 page-0125](sources/bylaws-resource-2023.md#page-0125), [bylaws-resource-2023 page-0126](sources/bylaws-resource-2023.md#page-0126), [bylaws-resource-2023 page-0127](sources/bylaws-resource-2023.md#page-0127)

## S01 — Use the supplied 2025 seismic edition as the current reference

Priority tier: **0**. Tags: seismic, code, earthquake

The new upload identifies NBC 105:2025, second revision. Keep older commentary separate and confirm project adoption.

**Measure:** Attach current source hash, engineer design basis and applicable revision; preserve older material for background only.

**Repair:** Replace obsolete code assumptions and re-review dependent engineering.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc105-2025 page-0001](sources/nbc105-2025.md#page-0001), [nbc105-2025 page-0002](sources/nbc105-2025.md#page-0002), [nbc105-2025 page-0021](sources/nbc105-2025.md#page-0021)

## S02 — Resolve soil classification with site evidence and ward lookup

Priority tier: **0**. Tags: soil, municipality, ward, kathmandu, seismic

Section 4.1.3 and Table 4-3 distinguish listed Kathmandu Valley wards and test-based soil classification.

**Measure:** Store municipality/ward plus site evidence. Nil in the table does not prove rock or low hazard.

**Repair:** Engineer confirms soil profile and table applicability; do not use one valley-wide soil constant.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc105-2025 page-0044](sources/nbc105-2025.md#page-0044), [nbc105-2025 page-0045](sources/nbc105-2025.md#page-0045), [nbc105-2025 page-0046](sources/nbc105-2025.md#page-0046)

## S03 — Select seismic zoning from the applicable code route

Priority tier: **0**. Tags: seismic, zoning, municipality, earthquake

Section 4.1.4 refers to municipality values in Annex C and map interpolation.

**Measure:** Keep municipality identifiers and code provenance; source cross-reference numbering needs review before automating map lookup.

**Repair:** Use reviewed municipality/table value or reviewed location method; do not guess a national coefficient.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc105-2025 page-0046](sources/nbc105-2025.md#page-0046)

## S04 — Check weak and soft storeys before accepting open parking

Priority tier: **0**. Tags: parking, soft, storey, structure, seismic

Section 5.4.1 distinguishes strength and stiffness irregularities.

**Measure:** Store engineer-calculated strength/stiffness comparisons; geometry alone cannot prove either.

**Repair:** Revise lateral system and engineering when open ground floor conflicts with upper infill.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc105-2025 page-0055](sources/nbc105-2025.md#page-0055)

## S05 — Review partial upper floors and offsets for irregularity

Priority tier: **0**. Tags: partial, floor, setbacks, structure, seismic

Vertical geometry, mass, diaphragm and offset irregularities are separate checks.

**Measure:** Evaluate every full/partial level and stair/court void with engineering results.

**Repair:** Revise frame/layout; do not treat 3.5 as multiplication of a typical floor.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc105-2025 page-0055](sources/nbc105-2025.md#page-0055), [nbc105-2025 page-0056](sources/nbc105-2025.md#page-0056), [nbc105-2025 page-0057](sources/nbc105-2025.md#page-0057)

## S06 — Do not confuse rectangular appearance with torsional adequacy

Priority tier: **0**. Tags: torsion, grid, structure, seismic

Section 5.4.2 evaluates displacement-based torsion and disallows extreme torsional irregularity.

**Measure:** Use structural analysis results, not only perimeter shape or Vaastu balance.

**Repair:** Engineer revises lateral configuration before architectural issue.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc105-2025 page-0056](sources/nbc105-2025.md#page-0056)

## S07 — Design building separation from displacement requirements

Priority tier: **0**. Tags: boundary, separation, seismic, neighbor

Section 5.5.2 addresses separation of independent units and clear gaps.

**Measure:** Engineer calculates relevant displacement/gap and evaluates adjoining site conditions; retain construction tolerances.

**Repair:** Reserve the required clear separation; observed flush neighbors do not justify ignoring the check.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc105-2025 page-0058](sources/nbc105-2025.md#page-0058), [nbc105-2025 page-0059](sources/nbc105-2025.md#page-0059)

## S08 — Carry tanks, parapets and MEP into seismic coordination

Priority tier: **0**. Tags: tank, parapet, mep, anchorage, seismic

Chapter 10 addresses nonstructural components, supports and connections.

**Measure:** Model weights, attachments and supported services; engineer determines applicable demands and anchorage.

**Repair:** Move/support/anchor components through reviewed engineering, even if a preferred direction changes.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc105-2025 page-0071](sources/nbc105-2025.md#page-0071), [nbc105-2025 page-0072](sources/nbc105-2025.md#page-0072), [nbc105-2025 page-0074](sources/nbc105-2025.md#page-0074)

## S09 — Coordinate RC and masonry infill under the current design route

Priority tier: **0**. Tags: rc, masonry, infill, seismic

Annex A includes RC moment frames with unreinforced masonry infill among its covered systems.

**Measure:** Do not treat infill as architecturally invisible to seismic design; engineer selects provisions and detailing.

**Repair:** Resolve openings, frame interaction and member details before finalizing floor plans.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [nbc105-2025 page-0075](sources/nbc105-2025.md#page-0075)

## V01 — Fix north and the scope of every directional test

Priority tier: **1**. Tags: north, orientation, geometry, vastu

Directional interpretation requires an explicit orientation and reference space.

**Measure:** Store north bearing and whether a rule refers to plot, building, floor, room or fixture; missing/uncertain north is unknown.

**Repair:** Ask for north confirmation before claiming Vaastu compliance.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-svoboda section-0014](sources/vastu-svoboda.md#section-0014), [vastu-chakrabarti page-0132](sources/vastu-chakrabarti.md#page-0132)

**Executable fact predicate:** `{"fact": "vastu.orientation_confirmed", "op": "eq", "value": true}`.

## V02 — Prefer a coherent rectangular building domain

Priority tier: **1**. Tags: plot, shape, rectangle, vastu

Square/rectangular spatial organization is preferred in these traditions.

**Measure:** Compare buildable polygon with candidate regular domains; never alter the actual surveyed parcel.

**Repair:** Fit a regular occupied volume inside lawful envelope; disclose losses/irregular exceptions.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-svoboda section-0013](sources/vastu-svoboda.md#section-0013), [vastu-svoboda section-0019](sources/vastu-svoboda.md#section-0019), [vastu-chakrabarti page-0149](sources/vastu-chakrabarti.md#page-0149)

**Executable fact predicate:** `{"fact": "building.regular_domain", "op": "eq", "value": true}`.

## V03 — Reserve a clear central Brahmasthana

Priority tier: **1**. Tags: center, courtyard, brahmasthana, vastu

Keep the identified center spatially clear; traditions differ on exact size and open-to-sky treatment.

**Measure:** Explicit center polygon from selected grid; intersect with stairs, toilets and bulky obstructions. Courtyard versus usable open hall is a profile decision.

**Repair:** Shift core/wet rooms; do not remove load-bearing members or assume a tiny void passes daylight rules.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0007](sources/vastu-jain.md#section-0007), [vastu-svoboda section-0013](sources/vastu-svoboda.md#section-0013), [vastu-chakrabarti page-0136](sources/vastu-chakrabarti.md#page-0136), [vastu-chakrabarti page-0137](sources/vastu-chakrabarti.md#page-0137)

**Executable fact predicate:** `{"fact": "vastu.center_clear", "op": "eq", "value": true}`.

## V04 — Keep northeast light and uncluttered

Priority tier: **1**. Tags: northeast, daylight, massing, vastu

Prioritize openness and light in the northeast within legal site constraints.

**Measure:** Measure NE usable/open area and actual obstruction; separate visual openness from legal setbacks.

**Repair:** Move heavy storage and optional services away; retain required boundary protection.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0009](sources/vastu-jain.md#section-0009), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008), [vastu-chakrabarti page-0139](sources/vastu-chakrabarti.md#page-0139)

**Executable fact predicate:** `{"fact": "vastu.northeast_uncluttered", "op": "eq", "value": true}`.

## V05 — Locate the puja space toward northeast

Priority tier: **1**. Tags: puja, prayer, northeast, vastu

NE is the selected first preference; Jain also allows N/E. Pathi allows different alternatives.

**Measure:** Classify puja polygon in the selected floor domain; record preferred versus fallback outcome.

**Repair:** Try NE first, then explicit profile alternatives.

**Interpretation/conflict:** Pathi allows W/S/NE; Jain prefers NE then N/E. Default uses NE; fallback requires recorded profile.

**Sources:** [vastu-jain section-0014](sources/vastu-jain.md#section-0014), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008), [vastu-chakrabarti page-0140](sources/vastu-chakrabarti.md#page-0140)

**Executable fact predicate:** `{"fact": "puja.zone", "op": "eq", "value": "NE"}`.

**Applicability:** `{"fact": "puja.requested", "op": "eq", "value": true}`.

## V06 — Separate puja from toilets in plan and section

Priority tier: **1**. Tags: puja, toilet, adjacency, stack, vastu

Avoid puja next to, above/below or directly facing a toilet.

**Measure:** Check shared boundaries, door sightlines and vertical footprint overlaps; define adjacency tolerance in geometry adapter.

**Repair:** Move puja/toilet or insert a genuine separation; report unsatisfied conditions.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0014](sources/vastu-jain.md#section-0014), [vastu-jain section-0019](sources/vastu-jain.md#section-0019), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "puja.toilet_conflict", "op": "eq", "value": false}`.

**Applicability:** `{"fact": "puja.requested", "op": "eq", "value": true}`.

## V07 — No puja beneath or above a stair

Priority tier: **1**. Tags: puja, stairs, stack, vastu

Jain discourages puja under or over stairs.

**Measure:** Intersect puja zone with full stair/landing envelope above and below.

**Repair:** Reposition puja as a dedicated suitable zone.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0014](sources/vastu-jain.md#section-0014)

**Executable fact predicate:** `{"fact": "puja.stair_overlap", "op": "eq", "value": false}`.

**Applicability:** `{"fact": "puja.requested", "op": "eq", "value": true}`.

## V08 — Place the kitchen in southeast first

Priority tier: **1**. Tags: kitchen, southeast, northwest, vastu

SE is a recurring kitchen preference; NW is an explicit alternative in Jain and Pathi.

**Measure:** Measure kitchen in building/floor domain separately from stove within kitchen.

**Repair:** Reserve SE during program allocation; use NW only as a reported alternative.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0016](sources/vastu-jain.md#section-0016), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008), [vastu-svoboda section-0014](sources/vastu-svoboda.md#section-0014), [vastu-chakrabarti page-0140](sources/vastu-chakrabarti.md#page-0140)

**Executable fact predicate:** `{"fact": "kitchen.zone", "op": "eq", "value": "SE"}`.

## V09 — Avoid kitchen in northeast or southwest

Priority tier: **1**. Tags: kitchen, northeast, southwest, vastu

Protect NE from kitchen placement; these sources also discourage SW kitchen.

**Measure:** Evaluate every kitchen in multi-unit homes, not just ground floor.

**Repair:** Move wet/service cluster while preserving drainage and usable circulation.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0016](sources/vastu-jain.md#section-0016), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "kitchens.all_avoid_ne_sw", "op": "eq", "value": true}`.

## V10 — Place the primary bedroom southwest first

Priority tier: **1**. Tags: bedroom, primary, southwest, vastu

SW is the selected primary bedroom preference; Jain permits S/W alternatives.

**Measure:** Map requested primary suite and its actual floor; do not assign importance by gender/caste.

**Repair:** Try SW; explicitly report S/W fallback and any requested accessible-ground-floor conflict.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0018](sources/vastu-jain.md#section-0018), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008), [vastu-chakrabarti page-0140](sources/vastu-chakrabarti.md#page-0140)

**Executable fact predicate:** `{"fact": "primary_bedroom.zone", "op": "eq", "value": "SW"}`.

## V11 — Avoid primary bedroom in northeast or southeast

Priority tier: **1**. Tags: bedroom, primary, northeast, southeast, vastu

Jain discourages NE/SE primary sleeping spaces.

**Measure:** Check primary room zone independently of bed orientation.

**Repair:** Reallocate sleeping/private realm; do not fabricate medical consequences.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0018](sources/vastu-jain.md#section-0018)

**Executable fact predicate:** `{"fact": "primary_bedroom.zone", "op": "not_in", "value": ["NE", "SE"]}`.

## V12 — Prefer northwest or west toilets/bathrooms

Priority tier: **1**. Tags: toilet, bathroom, northwest, west, vastu

Selected practical profile favors NW/W for wet toilet rooms.

**Measure:** Check each bathroom/WC room as a separate instance.

**Repair:** Group suitable wet rooms with legal light, vent and service routes.

**Interpretation/conflict:** Chakrabarti page 140 distinguishes bathroom E from toilet S. Do not merge that tradition silently with Jain.

**Sources:** [vastu-jain section-0019](sources/vastu-jain.md#section-0019), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "bathrooms.all_in_nw_w", "op": "eq", "value": true}`.

## V13 — Avoid toilets in northeast and center

Priority tier: **1**. Tags: toilet, center, northeast, vastu

NE and center are excluded toilet zones in the selected profile.

**Measure:** Intersect full WC/wet room polygons with protected regions; a favorable centroid cannot excuse major overlap.

**Repair:** Move toilet core before furniture/finish optimization.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0019](sources/vastu-jain.md#section-0019), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "bathrooms.avoid_ne_center", "op": "eq", "value": true}`.

## V14 — Keep kitchen, puja and bathrooms out from under stairs

Priority tier: **1**. Tags: stairs, undercroft, kitchen, toilet, puja, vastu

Storage is an allowed under-stair use in Jain; kitchen/bath/puja are discouraged.

**Measure:** Check room/stair envelopes in section and plan.

**Repair:** Use accessible storage only after headroom and safety checks.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0024](sources/vastu-jain.md#section-0024), [vastu-jain section-0019](sources/vastu-jain.md#section-0019)

**Executable fact predicate:** `{"fact": "stairs.prohibited_undercroft_use", "op": "eq", "value": false}`.

## V15 — Choose a documented stair-location tradition

Priority tier: **1**. Tags: stairs, south, west, northwest, southeast, vastu

Jain prefers S/W; Pathi prefers NW/SE. Both discourage NE.

**Measure:** Default profile selects Jain S/W family; save alternative consultant-approved profile rather than enforcing contradictory locations.

**Repair:** Reserve stair early with grid and daylight space.

**Interpretation/conflict:** Direct source conflict: S/W versus NW/SE. Default is an explicit Keystone selection, not consensus.

**Sources:** [vastu-jain section-0024](sources/vastu-jain.md#section-0024), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "stairs.selected_profile_location_satisfied", "op": "eq", "value": true}`.

## V16 — Keep stair out of northeast and center

Priority tier: **1**. Tags: stairs, northeast, center, vastu

NE avoidance overlaps across Jain/Pathi; center avoidance is explicit in Jain.

**Measure:** Check full stair and landing footprints at each level.

**Repair:** Move core within legal, structurally viable zones.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0024](sources/vastu-jain.md#section-0024), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "stairs.avoid_ne_center", "op": "eq", "value": true}`.

## V17 — Prefer clockwise ascent

Priority tier: **1**. Tags: stairs, clockwise, landing, vastu

Jain prefers clockwise ascent.

**Measure:** Follow ascending path viewed from above in a right-handed plan; use signed turns, not arrow artwork.

**Repair:** Choose alternate U-stair handedness while preserving landing and structural support.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0024](sources/vastu-jain.md#section-0024)

**Executable fact predicate:** `{"fact": "stairs.clockwise_ascent", "op": "eq", "value": true}`.

## V18 — Protect entry from direct toilet or stair views

Priority tier: **1**. Tags: entrance, privacy, stairs, toilet, vastu

Avoid entry sightlines directly to toilets or a dominant stair run.

**Measure:** Ray/sightline checks from actual entry aperture into relevant doors and stair; no imaginary partition.

**Repair:** Introduce an accessible foyer/screen or rotate door/core without reducing egress.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0013](sources/vastu-jain.md#section-0013), [vastu-jain section-0024](sources/vastu-jain.md#section-0024), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008), [vastu-svoboda section-0015](sources/vastu-svoboda.md#section-0015)

**Executable fact predicate:** `{"fact": "entry.toilet_stair_direct_view", "op": "eq", "value": false}`.

## V19 — Resolve entry pada rules rather than banning south roads

Priority tier: **1**. Tags: entrance, door, pada, frontage, vastu

Jain supplies side-specific entry divisions, then contradicts itself about S/W residential entries.

**Measure:** Selected frontage, measurement direction and applicable division interval require consultant review. Road frontage is not itself an automatic failure.

**Repair:** Propose alternatives consistent with access; expose disputed interpretation.

**Interpretation/conflict:** Jain section 13 both permits advantageous S/W positions and later disallows them; no unconditional code predicate.

**Sources:** [vastu-jain section-0013](sources/vastu-jain.md#section-0013)

## V20 — Ground and overhead tanks have different preferences

Priority tier: **1**. Tags: tank, water, underground, overhead, vastu

Selected profile: underground water NE; overhead water SW, subject to engineered support.

**Measure:** Separate tank types, foundation clearance, maintenance and water hygiene; review top-floor mass/eccentricity.

**Repair:** Offer structurally viable options; do not place a heavy tank only to win direction score.

**Interpretation/conflict:** Pathi names E for underground water in one passage; preserve that as alternative.

**Sources:** [vastu-jain section-0026](sources/vastu-jain.md#section-0026), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008), [vastu-chakrabarti page-0140](sources/vastu-chakrabarti.md#page-0140)

## V21 — Prefer northwest septic location only when feasible

Priority tier: **1**. Tags: septic, drainage, northwest, vastu

NW is a directional preference; disposal engineering determines feasibility.

**Measure:** Only if onsite disposal requested/permitted; check size, clearances, outfall, groundwater and access.

**Repair:** Use approved disposal strategy; never reduce sanitary separation to satisfy direction.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0026](sources/vastu-jain.md#section-0026), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "septic.zone", "op": "eq", "value": "NW"}`.

**Applicability:** `{"fact": "septic.requested", "op": "eq", "value": true}`.

## V22 — Orient cook toward east

Priority tier: **2**. Tags: kitchen, stove, facing, vastu

Prefer east-facing cooking; stove location and cook direction are distinct.

**Measure:** Use standing position and cooktop working face in true-north coordinates.

**Repair:** Rotate counter/stove while maintaining working clearances.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0016](sources/vastu-jain.md#section-0016)

**Executable fact predicate:** `{"fact": "stove.cook_facing", "op": "eq", "value": "E"}`.

## V23 — Prefer southeast stove within kitchen

Priority tier: **2**. Tags: kitchen, stove, southeast, vastu

Apply SE at room scale, not just house scale.

**Measure:** Room-domain stove footprint; gas/electrical/exhaust safety still governs.

**Repair:** Rearrange appliances without sacrificing ventilation.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0016](sources/vastu-jain.md#section-0016)

**Executable fact predicate:** `{"fact": "stove.room_zone", "op": "eq", "value": "SE"}`.

## V24 — Separate sink and stove; prefer northeast water fixture

Priority tier: **2**. Tags: kitchen, sink, water, vastu

Jain separates fire/water fixtures and places sink NE; Pathi places purifier NE.

**Measure:** Check separate footprints, workable preparation surface and selected fixture location. No unsupported numeric separation added.

**Repair:** Adjust kitchen working layout, keeping source of water distinct from heat.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0016](sources/vastu-jain.md#section-0016), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "kitchen.fire_water_layout_satisfied", "op": "eq", "value": true}`.

## V25 — Prefer south or east head direction

Priority tier: **2**. Tags: bed, bedroom, sleep, direction, vastu

Head S/E is preferred; N is discouraged in these books.

**Measure:** Vector from foot end to head end in world/north coordinates; evaluate each requested bed.

**Repair:** Rotate/reposition beds without blocking doors or reducing clearances.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0018](sources/vastu-jain.md#section-0018), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "beds.all_head_s_or_e", "op": "eq", "value": true}`.

## V26 — Avoid beams directly over beds or work positions

Priority tier: **2**. Tags: bed, beam, kitchen, dining, structure, vastu

Prefer occupied resting/work zones without direct overhead beams.

**Measure:** Intersect head/bed/cooking/dining occupied zones with actual beam projections.

**Repair:** Move furniture or coordinate frame; never delete/flatten a structural beam.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0018](sources/vastu-jain.md#section-0018), [vastu-jain section-0016](sources/vastu-jain.md#section-0016), [vastu-jain section-0017](sources/vastu-jain.md#section-0017), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "furniture.beam_conflicts", "op": "eq", "value": false}`.

## V27 — Prefer a solid headboard wall

Priority tier: **2**. Tags: bed, window, bathroom, vastu

Prefer solid backing; avoid placing bed against bathroom wall or directly before bedroom door.

**Measure:** Model headboard wall, openings, wet-wall adjacency and door sightline separately.

**Repair:** Move bed or bathroom access while keeping furniture fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0018](sources/vastu-jain.md#section-0018)

**Executable fact predicate:** `{"fact": "beds.backing_and_privacy_satisfied", "op": "eq", "value": true}`.

## V28 — Prefer northwest guest bedroom

Priority tier: **2**. Tags: guest, bedroom, northwest, vastu

NW is a recurring guest-room preference.

**Measure:** Apply only to actual guest room, not automatically every secondary bedroom.

**Repair:** Try NW after essential cores; document competing wet-room demand.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0021](sources/vastu-jain.md#section-0021), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008), [vastu-chakrabarti page-0140](sources/vastu-chakrabarti.md#page-0140)

**Executable fact predicate:** `{"fact": "guest.zone", "op": "eq", "value": "NW"}`.

**Applicability:** `{"fact": "guest.requested", "op": "eq", "value": true}`.

## V29 — Select children bedroom tradition explicitly

Priority tier: **2**. Tags: children, bedroom, study, vastu

Jain favors W then N/E; Pathi recommends NE for children/older people.

**Measure:** Use household needs and explicit profile; prioritize accessibility for any resident.

**Repair:** Record chosen room rule; do not infer age/gender hierarchy.

**Interpretation/conflict:** Different sources assign different directions; no blanket NE-bedroom ban for every room.

**Sources:** [vastu-jain section-0020](sources/vastu-jain.md#section-0020), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

## V30 — Orient study work toward east or north

Priority tier: **2**. Tags: study, desk, children, vastu

Prefer E/N-facing study activity.

**Measure:** Use chair/desk working-face vector rather than room label.

**Repair:** Rotate desk with daylight/glare and clearance checks.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "study.facing", "op": "in", "value": ["E", "N"]}`.

**Applicability:** `{"fact": "study.requested", "op": "eq", "value": true}`.

## V31 — Keep dining linked to kitchen on the same floor

Priority tier: **2**. Tags: dining, kitchen, adjacency, vastu

Jain specifies same floor; Pathi emphasizes proximity.

**Measure:** Shortest usable route and floor IDs; no access through private bedrooms.

**Repair:** Relocate dining within public realm.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0017](sources/vastu-jain.md#section-0017), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "dining.kitchen_same_floor_accessible", "op": "eq", "value": true}`.

## V32 — Treat dining direction as a profile choice

Priority tier: **2**. Tags: dining, west, east, south, vastu

Jain favors W then N/E; Pathi suggests S/E near kitchen.

**Measure:** Prefer practical adjacency and selected tradition; do not require incompatible locations.

**Repair:** Show ranked alternatives with source conflict.

**Interpretation/conflict:** Dining compass preferences differ; adjacency is the reliable shared design relation.

**Sources:** [vastu-jain section-0017](sources/vastu-jain.md#section-0017), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

## V33 — Prefer open north/east-facing living spaces where lawful

Priority tier: **2**. Tags: living, windows, north, east, vastu

Jain favors E/N/NW; Pathi favors NE/NW and sometimes center.

**Measure:** Score room exposure and habitable light, not a compass label alone.

**Repair:** Choose usable daylight and legal opening placement.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0015](sources/vastu-jain.md#section-0015), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "living.selected_profile_location_satisfied", "op": "eq", "value": true}`.

## V34 — Keep prayer orientation distinct from room location

Priority tier: **2**. Tags: puja, idol, facing, vastu

Jain recommends worshipper facing E, idol facing W.

**Measure:** Model idol front, worshipper location and actual access in the room.

**Repair:** Rotate arrangement without relocating room unnecessarily.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0014](sources/vastu-jain.md#section-0014)

**Executable fact predicate:** `{"fact": "puja.worshipper_facing", "op": "eq", "value": "E"}`.

**Applicability:** `{"fact": "puja.requested", "op": "eq", "value": true}`.

## V35 — Orient WC user north or south in selected profile

Priority tier: **2**. Tags: wc, toilet, orientation, vastu

Jain discourages E/W-facing WC use.

**Measure:** Use seated-person direction, not cistern/front-wall label; preserve usable bathroom fit.

**Repair:** Rotate fixture and recheck soil connection/clearances.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0019](sources/vastu-jain.md#section-0019)

**Executable fact predicate:** `{"fact": "wc.all_user_facing_n_s", "op": "eq", "value": true}`.

## V36 — Prefer south/west heavy storage

Priority tier: **2**. Tags: closet, storage, furniture, vastu

Locate substantial wardrobes/storage toward S/W/SW in the relevant room.

**Measure:** Test actual closet footprint, usable access, door swing and room-scale orientation.

**Repair:** Reposition built-in storage without sacrificing structure/egress.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0018](sources/vastu-jain.md#section-0018), [vastu-jain section-0015](sources/vastu-jain.md#section-0015), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "storage.selected_profile_location_satisfied", "op": "eq", "value": true}`.

## V37 — Keep legal daylight openings toward north/east when possible

Priority tier: **2**. Tags: windows, opening, daylight, vastu

N/E openings are favored by these books.

**Measure:** Compare usable/exposed openings by orientation; statutory light/ventilation and boundary permission remain gates.

**Repair:** Shift rooms or court arrangement; do not draw illegal boundary windows.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0012](sources/vastu-jain.md#section-0012), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

**Executable fact predicate:** `{"fact": "openings.north_east_preference_satisfied", "op": "eq", "value": true}`.

## V38 — Prefer a legible larger main entrance

Priority tier: **2**. Tags: door, entrance, width, vastu

Main entry is emphasized as larger than other domestic doors.

**Measure:** Compare actual clear openings; do not reduce other required opening widths.

**Repair:** Increase entry where feasible and desired.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0013](sources/vastu-jain.md#section-0013), [vastu-jain section-0012](sources/vastu-jain.md#section-0012)

**Executable fact predicate:** `{"fact": "entry.emphasis_satisfied", "op": "eq", "value": true}`.

## V39 — Door swing preferences cannot override exit/access requirements

Priority tier: **2**. Tags: door, swing, threshold, vastu

Books favor inward/clockwise entry; thresholds are also mentioned.

**Measure:** Separate preference from required egress swing/accessibility and landing clearance; coordinate sign convention.

**Repair:** Use safe compliant swing; record departure rather than adding a hazardous threshold.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0013](sources/vastu-jain.md#section-0013), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008), [nbc206-2024 page-0012](sources/nbc206-2024.md#page-0012)

## V40 — Odd stair count is an optional secondary detail

Priority tier: **2**. Tags: stairs, riser, count, vastu

Books prefer odd steps but do not establish an engineering riser-count convention.

**Measure:** Before enabling, define whether count is risers per flight or total rise; keep risers uniform and within legal limits.

**Repair:** Choose a different valid count only if safe; never add a tiny step.

**Interpretation/conflict:** Counting convention unspecified. Default is manual advisory, not executable.

**Sources:** [vastu-jain section-0024](sources/vastu-jain.md#section-0024), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)

## V41 — Prefer orthogonal landing stairs

Priority tier: **2**. Tags: stairs, half, turn, landing, vastu

Jain favors square/rectangular right-angle arrangements over circular/spiral. Owner separately selects half-turn with landing as Nepal default.

**Measure:** Check actual stair type; straight/quarter-turn alternatives can be compliant and user-selected.

**Repair:** Start with U-stair and landing; preserve legal geometry and structure.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0024](sources/vastu-jain.md#section-0024)

**Executable fact predicate:** `{"fact": "stairs.orthogonal_landing_type", "op": "eq", "value": true}`.

## V42 — Parking location is not a vehicle-access calculation

Priority tier: **2**. Tags: parking, bike, car, garage, vastu

Jain favors SE/NW garage and discourages NE.

**Measure:** Only score after maneuvering, gates, walking paths and area accounting pass.

**Repair:** Choose feasible parking first, then best directional fit.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0023](sources/vastu-jain.md#section-0023)

**Executable fact predicate:** `{"fact": "parking.selected_profile_location_satisfied", "op": "eq", "value": true}`.

**Applicability:** `{"fact": "parking.requested", "op": "eq", "value": true}`.

## V43 — Landscape and drainage preferences need site engineering

Priority tier: **2**. Tags: slope, drainage, landscape, northeast, vastu

Sources favor lower/open N/E/NE; this is a preference, not authorization to direct water there.

**Measure:** Check actual lawful outfall, falls, neighboring plots and accessibility.

**Repair:** Keep engineered drainage; acknowledge directional mismatch rather than flood another site.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0025](sources/vastu-jain.md#section-0025), [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008), [vastu-chakrabarti page-0149](sources/vastu-chakrabarti.md#page-0149)

## V44 — Keep worship space dedicated and calm

Priority tier: **2**. Tags: puja, privacy, clutter, vastu

Prefer a distinct, uncluttered prayer zone separate from bedroom/kitchen functions.

**Measure:** Check use and furniture conflicts; dedicated alcove only by explicit household choice.

**Repair:** Reserve appropriate floor area early.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0014](sources/vastu-jain.md#section-0014), [vastu-svoboda section-0018](sources/vastu-svoboda.md#section-0018)

**Executable fact predicate:** `{"fact": "puja.dedicated_uncluttered", "op": "eq", "value": true}`.

**Applicability:** `{"fact": "puja.requested", "op": "eq", "value": true}`.

## V45 — Use color as a reversible preference

Priority tier: **2**. Tags: color, facade, interior, vastu

Room-specific light/warm palettes are discussed; retain owner choice and local multicolor facade preference.

**Measure:** Apply colors to actual surfaces after geometry; do not claim health or wealth effects.

**Repair:** Offer palette variants without disguising structural/window changes.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0014](sources/vastu-jain.md#section-0014), [vastu-jain section-0015](sources/vastu-jain.md#section-0015), [vastu-jain section-0016](sources/vastu-jain.md#section-0016), [vastu-jain section-0018](sources/vastu-jain.md#section-0018), [vastu-jain section-0024](sources/vastu-jain.md#section-0024)

## V46 — Do not use symbolic remedies as geometric repairs

Priority tier: **1**. Tags: remedy, mirror, vastu, safety

Jain describes symbolic mirror/remedy practices. These do not change stairs, structure or plan geometry.

**Measure:** Keep any user-requested ritual item separate from geometry compliance.

**Repair:** Report original geometric preference failure; never erase it with a remedy.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-jain section-0024](sources/vastu-jain.md#section-0024), [vastu-jain section-0038](sources/vastu-jain.md#section-0038)

**Executable fact predicate:** `{"fact": "vastu.no_symbolic_compliance_override", "op": "eq", "value": true}`.

## A01 — Design from household activity and usable furniture

Priority tier: **3**. Tags: furniture, activity, privacy, architecture

Svoboda emphasizes intention and practical use; apply the earlier Keystone activity-first design approach.

**Measure:** Prove bed/work/seating/fixture clearances and useful paths.

**Repair:** Rework room geometry before decoration.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-svoboda section-0012](sources/vastu-svoboda.md#section-0012), [vastu-svoboda section-0018](sources/vastu-svoboda.md#section-0018)

**Executable fact predicate:** `{"fact": "architecture.activity_fit", "op": "eq", "value": true}`.

## A02 — Preserve a readable entrance-to-private-space sequence

Priority tier: **3**. Tags: privacy, circulation, entrance, architecture

Entry experience and what is visible affect spatial organization.

**Measure:** Guest routes to public spaces should not require crossing private bedrooms.

**Repair:** Recluster public/private rooms; minimize wasted corridors.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-svoboda section-0015](sources/vastu-svoboda.md#section-0015)

**Executable fact predicate:** `{"fact": "architecture.privacy_routes", "op": "eq", "value": true}`.

## A03 — Interpret the tradition as a whole, not disconnected compass slogans

Priority tier: **3**. Tags: tradition, mandala, architecture

Chakrabarti distinguishes integrated traditional systems from selective contemporary prescriptions.

**Measure:** Record selected tradition, mandala interpretation, household intent and source conflicts.

**Repair:** Avoid mixing conflicting rules while calling them universal.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-chakrabarti page-0018](sources/vastu-chakrabarti.md#page-0018), [vastu-chakrabarti page-0136](sources/vastu-chakrabarti.md#page-0136), [vastu-chakrabarti page-0137](sources/vastu-chakrabarti.md#page-0137), [vastu-svoboda section-0018](sources/vastu-svoboda.md#section-0018)

## A04 — Use practice profiles for spatial inspiration only

Priority tier: **3**. Tags: courtyard, light, architecture, case, study

The uploaded magazine PDF profiles architecture practices; its title is not proof of a Vaastu rule system.

**Measure:** Extract case-specific spatial lessons only after inspecting relevant project pages.

**Repair:** Do not invent directional doctrine from an architectural firm name.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [architecture-kathpalia page-0001](sources/architecture-kathpalia.md#page-0001)

## A05 — Treat the illustrated plans as references, not Nepal-approved templates

Priority tier: **3**. Tags: plans, examples, dimensions, architecture

Pathi supplies plan images and a general principles section, not Nepal permit or RC certification.

**Measure:** Check each selected image scale, openings, stairs, structure and local applicability.

**Repair:** Rebuild and validate an adapted plan instead of tracing it as approved.

**Interpretation/conflict:** No consensus claim; apply the selected household profile and mandatory safety constraints.

**Sources:** [vastu-pathi section-0008](sources/vastu-pathi.md#section-0008)
