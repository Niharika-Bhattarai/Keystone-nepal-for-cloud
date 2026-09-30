# Milestones C-F execution and handover

Date: 2026-09-30. All implementation is under `Keystone Nepal/local`. The public Keystone repositories and deployment remain untouched.

The owner has confirmed they are a Nepal Engineering Council-registered architect/engineer and will review the working drawings directly. Local concept exploration therefore proceeds on explicitly documented assumptions. “Gate not met” below means **not yet permit-ready/engineering-verified**, not that the owner must wait to see or mark up plans. Open `local/runtime/nepal-plan-review/index.html` or use **Open working plan review** in the local Studio. The calculation sheet is `WORKING-ASSUMPTIONS-AND-CALCULATIONS.md`.

## Decisions from owner

- First permit-rule target: Kathmandu Metropolitan City. Other jurisdictions need separately reviewed overlays; a Kathmandu layout is a useful architectural baseline, not automatic permit acceptance elsewhere.
- Mandatory safety and bylaws are feasibility gates. Vaastu leads preference optimization among eligible alternatives.
- Initial survey plot is rectangular by width/depth. House footprints may be rectangle, stepped L, or courtyard/U; partial upper floor is modeled separately.
- Ground reservoir default 8,000 L, usual range 7,000-10,000 L, minimum 5,000 L to receive a full delivery truck. Under-stair location is preferred and needs structural/waterproofing/access detailing.

## C: rule pack and area accounting

- [x] Pin 92 operational rules and all original source hashes in a generated backend catalog; draft seismic commentary is excluded from executable thresholds. Rebuild using `node lib/nepal/rules/buildCatalog.js` from the copied backend.
- [x] Add a Kathmandu profile with official current reference URLs and source hashes for the 2082/2083 amendments. It marks legal parameters unresolved rather than hardcoding the resource-book's illustrative 70% coverage or FAR examples.
- [x] Add exact orthogonal union and void accounting in integer millimetres; keep gross area, coverage and FAR chargeable area separate. Covered parking treatment stays unresolved until adopted local rules are checked.
- [x] Synthetic exact/over-boundary tests, overlap and outside-site tests pass.
- [ ] **Permit gate not met:** the owner can review the 2080 standard and 2082/2083 amendments against a specific parcel, including land-use zone, road classification, setbacks, coverage/FAR exclusions and adjoining walls. Three hand-calculated legal reference ledgers are still needed. A 1 m edge setback and the owner's 70% coverage ceiling are now explicit **working design assumptions** for local review only. The backend does not claim permit compliance.

Official sources: [Kathmandu eBPS reference index](https://ebps.kathmandu.gov.np/Hom/ReferenceDoc), [2082 first revision](https://ebps.kathmandu.gov.np/UploadFiles/mapdanda2080Rev1.pdf), [2083 amendment](https://ebps.kathmandu.gov.np/UploadFiles/2.pdf), [NBC 206:2024](https://ebps.kathmandu.gov.np/UploadFiles/NBC206Amended.pdf), [DUDBC national code index](https://www.dudbc.gov.np/pages/24231978/). The 2083 amendment visibly addresses parking as a portion of total FAR countable area on plots above four aana and a recharge pit condition; do not reduce these to a generic nationwide constant.

## D: envelopes, frame, stacked core

- [x] Require four explicit provisional edge setbacks for rectangle search; never infer legal zero setbacks from an adjoining house.
- [x] Generate four genuinely different footprint families from one rectangle, with site containment and measured areas.
- [x] Reserve a stable-ID provisional RC grid and a continuous shared east/west stair bay across all levels. Rental entries open from shared landings, not through another household.
- [x] Apply the owner's 14 ft maximum **planning-axis** interval (4,267 mm in integer geometry), with a 10 ft preferred lower span. Split the former 5.35 m corridor-anchored bay and show grid-axis dimensions in the review document. Report each bedroom/kitchen crossing an interior grid axis as `MAIN_ROOM_GRID_CELL_NOT_MET`; no current 11.25 m reference option is represented as a four-column-room solution.
- [x] Reserve the under-stair underground reservoir by clear internal dimensions and effective wet volume; reject requests below 5,000 L or beyond the shallow under-stair reservation.
- [ ] **Gate not met:** grid members, transfer/soft-storey behavior, foundations, legal opening faces, vehicle movement and structural stair/tank coordination need engineering and geometry validation. Current grid dimensions are planning reservations, not NBC 105 analysis.

## E: half-turn staircase

- [x] Integer riser count from exact floor height, two flights, actual riser/tread/landing boxes, continuous inter-level assembly and explicit under-stair reservoir. Test 3,000 mm and uneven 3,200 mm rises.
- [x] Revised the floor-level arrival pad to 1,400 mm for the owner's 1,000 mm floor entry beside nominal 350 mm columns. The unit door stays at floor level, not at the +half-storey intermediate landing. Corridor-aware columns stay outside the 1,000 mm **nominal clear** corridor; finish thickness is still unresolved.
- [x] Provisional source-linked residential checks use NBC 206:2024 section 2.4.1/Table 4. Alternative stair types remain unsupported rather than rescaled symbols.
- [ ] **Gate not met:** beam/soffit headroom, slab openings, handrail/guard construction, door swings, egress/occupant-load width and drawn plan/section/3D parity remain unverified. An architect/engineer must confirm classification and adopted stair profile.

## F: Vaastu and room search

- [x] Measure clipped 3x3 room/floor zones against true-north bearing, including four cardinal rotations and missing footprint corners. Keep the 3x3 method labeled a consultant-review convention.
- [x] Seed kitchen, puja, primary/guest bedroom, living, bath and stair preferences before ranking. Candidates are deterministic and differ in core side, room adjacency order and available massing families.
- [x] Measure the under-stair underground reservoir against source rule V20. The Jain-led profile prefers underground water in the northeast, which can conflict with a preferred S/W stair. The conflict is reported, not hidden or treated as a safety failure.
- [x] Create geometrically measured room-placement hypotheses for rental floors and owner home. Preserve kitchens, baths, bedrooms, guest bedroom and puja rather than dropping requested functions to make options fit.
- [x] Improve obvious owner-plan proportions: compact puja within its minimum, split oversized single bathrooms into bath plus marked optional utility, and combine kitchen/dining by default. A distinct dining room requires a per-floor user choice. The open living annex is a reserved portal, not a claimed enclosed room. New compactness and threshold tests preserve all requested room counts.
- [x] Carry provisional NBC 206:2024 hilly-region natural-light/ventilation opening areas per habitable room and kitchen. Aperture sizes are demands only; no legal window or daylight simulation is claimed.
- [x] Render a local review gallery at `local/runtime/nepal-hypotheses/index.html` with floor-by-floor rectangles, corridor, shared stair and below-ground tank; visually inspected the first candidate. The three top results currently share a rectangular full-floor massing with different core side/room order. This is evidence of a variety gap, not proof of three great plans.
- [x] Reserve a clear door-width interval only where a room actually shares a sufficiently long boundary with its unit corridor or living room. Reserve a 900 mm unit-entry interval on the shared-core/corridor boundary. These are line reservations, not verified door swings or proof that the door lands on the stair landing.
- [x] Compute exterior-exposed wall segments against the union of stepped footprint slabs. Reserve a provisional clear window width from NBC 206:2024 hilly-region opening-area demand and a stated 1,200 mm assumed clear opening height. Try actual exterior side/end faces; never count a wall blocked by another slab. Rank hypotheses with no missing physical window reservation ahead of those that lack one. Legal opening permission and daylight quality remain unverified.
- [x] The visual gallery now marks provisional door and window intervals. Direct Edge screenshot inspection confirms their placement on the review diagram; it is not a CAD or architectural-detail inspection.
- [x] Added a dimensioned **working plan review** document for both a 2.5-storey owner home and a 3.5-storey two-rental-floor house. Every floor shows room boxes and areas, stair treads/pads, provisional columns, door/window intervals, setbacks, tank and blockers. The local Studio can generate the same review document from the user's own completed Nepal brief without an account. This is a review artifact, not a permit sheet.
- [x] Reject hypotheses that cannot fit rooms, the corridor, shared stair or partial top footprint. Validator reports unverified municipal rules, daylight/openings, doors/egress, structure, stair headroom and reservoir detailing.
- [x] Draw nominal 102 mm interior and 229 mm exterior brick bands with reserved openings, 350 mm columns and nominal clear-room dimensions. Report wall/column, opening/column, in-room-column and single-grid-cell exceptions. Reserve the owner's 1,200 mm double-leaf site door, 1,000 mm unit door, 900 mm ordinary room door, **750 mm** bath door (raised from approximate 700 mm per supplied NBC 206:2024 section 2.2.1 A), and 1,200 mm leafless kitchen portal. These are geometry/material intents, not swung leaves or construction assemblies.
- [x] Draw geometric 305–610 mm rain-chajja projections on exposed edges where the box remains inside the measured plot, and record omitted/flush edges. Legal projection permission, area accounting, structural cantilever and drainage remain unverified; these reservations are excluded from permit coverage/FAR claims.
- [x] Put puja on the owner partial-top floor in new local survey defaults and the ten-plan review corpus. Explicit saved/user-assigned puja floors remain respected; guest access and private-entry lock questions are reported. Render ten numbered, geometry-unique owner/rental review plans at `local/runtime/nepal-ten-plan-review/index.html`, with a CSV that distinguishes interior columns, bay crossings and living-entry alignment. See `TEN-PLAN-ARCHITECT-REVIEW.md`.
- [ ] **Gate not met:** no candidate has been proved an architectural floor plan. Requested balconies and rain chajjas, roof-terrace enclosure, door leaves/swings, legal apertures, wet shafts, furnishing clearances, attached bathrooms, bedroom privacy, direct living entry, whole-house circulation, elevations/sections/3D and professional Vaastu interpretation still require coordinated implementation. Ten distinct spatial hypotheses are **not** ten valid or diverse architectural designs. The Nepal `/api/plan` endpoint deliberately remains blocked.

## Survey and reference drawings

- [x] Shorten the local survey: rectangle width/depth only; plot-edge detail, per-floor edit panels, wardrobes and services are progressive disclosure. Totals are computed from floor entries, eliminating duplicate count fields.
- [x] Add an editable reservoir capacity with 8,000 L default and 5,000 L floor. Keep rental-floor program and shared stair question.
- [x] Inspect reference PDFs. `2.3.2021_Jivendra Residence Design.pdf` shows a rectilinear grid/house inside an irregular surveyed parcel; `newplans.pdf` sheets 2-3 show two-road frontage, setbacks, parking, court/open green space and a stepped plan on a grid; `MADHAVKC RESIDENCE -9.12.2021 A1.pdf` combines multiple floor plans, roof/section/elevations and an opening schedule; `sabitra tiwari_edited_2.6.2021.pdf` shows a stair/lift and service-rich basement. These informed footprint/core families; no personal drawing was copied into generated output.

## Verification and next exact actions

Focused C-F tests pass with the B contract; browser smoke opens the local Studio and its plan-review tab without account prompts or remote requests. Build passes. See `EXECUTION-LOG.md` for commands and current limitations.

1. Use the owner architect/engineer's marked review sheet to make the first geometry and local-rule corrections. For a real parcel, record the adopted 2080/2082/2083 values and citations in a reviewed versioned profile; do not treat a generic Studio input as an approval.
2. Have the structural engineer select an NBC 105:2025 analysis route, soil/site class, RC grid family and ground-reservoir/foundation arrangement. Validate actual columns/beams and the open rental ground-floor risk.
3. Convert provisional door/window intervals into wall thickness, door leaf/swing, stair landing alignment, accessible clear routes, legal exposure, bathroom ventilation and daylight calculations. Specifically rework the owner-floor puja/living adjacency in `kitchen-south`, which still has no physically exposed living-room window.
4. Rework `roomPlanner.js` and `frameGrid.js` together so bedrooms and kitchens occupy one four-column cell where the measured site permits. On the 11.25 m square reference plot, the current side core + corridor leaves 5.65 m for main rooms, while two preferred 10 ft bays need 6.096 m. Explore alternate core/circulation topologies, not false single-cell labels. Then make L/U footprints accommodate dense rental programs when physically possible; test every option against independent entry, aperture, size, grid-cell and full-program gates. Accept three options only if all mandatory checks pass and pairwise topology/geometry differ. Reopen DXF/3D parity and a professional review sheet before enabling Nepal generation.
