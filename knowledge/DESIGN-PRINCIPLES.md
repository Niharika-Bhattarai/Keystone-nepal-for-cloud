# Nepal house design: Vaastu-first spatial principles

Version 0.1, 2026-09-30. This is an operational synthesis of the supplied books, not a claim that every author agrees. The detailed, source-linked [93-rule catalog](RULE-CATALOG.md) and [machine-readable rules](rules.json) accompany it. Later additions may change the count; the JSON is authoritative.

## 1. The design hierarchy

**Vaastu is the highest design-preference priority.** It must guide the first placement of rooms, cores, entries, furniture and service reservations; it is not a score added after the plan is finished.

Use this order:

1. Establish a physically feasible, lawful, structurally coordinated solution that meets essential user requirements. This is an eligibility gate, not a competing preference score.
2. Optimize core Vaastu organization: orientation, protected center/NE, puja, kitchen, primary bedroom, toilet/stair zones and entry relationships.
3. Optimize Vaastu details: cook/bed/WC/prayer direction, furniture, doors, windows, tanks, parking and reversible color choices.
4. Optimize other architectural preferences, area efficiency, variety and presentation among valid alternatives.

Do not let many decorative improvements compensate for a failed core requirement. If an essential Vaastu requirement conflicts with legality, structure, required accessibility or the essential program, report the conflict and ask which *preference or brief constraint* can change. Never quietly break mandatory constraints. A small site can legitimately have no solution to the complete requested brief.

The supplied books describe traditional beliefs and sometimes predict health, wealth or misfortune. This synthesis records the spatial preferences without presenting those predictions as scientific or guaranteed outcomes. Gender/caste hierarchies and advice about residents' character are not part of the design rules.

## 2. What each source contributes

| Source | Use in this system | Limit |
|---|---|---|
| Jain, *Vastu Shastra* | Detailed room, fixture, stair, water, entry and decor guidance; main operational profile | Contains internal contradictions; some claims are cultural assertions, not engineering evidence |
| Sethu Pathi, *280+ 2BHK Plans* | Corroborating preferences and illustrated layout references | Contradicts Jain on some stair/room locations; image plans are not certified Nepal designs |
| Svoboda, *Vastu: Breathing Life into Space* | Intention, spatial coherence, center, orientation, entry experience and contextual interpretation | Philosophical interpretation is not a collection of building-code dimensions |
| Chakrabarti, *Indian Architectural Theory and Practice* | Comparative interpretation, mandala/measurement, tradition-versus-modern-use conflicts | Describes different practices; a reported practice is not automatically a universal prescription |
| Architectural Design practice-profile PDF | Courtyards, light, sequence and architectural examples | Includes multiple practices; “Vastu Shilpa” is a firm name, not proof of a doctrinal rulebook |

See [source manifest](manifest.json) and the converted [source folder](sources). Citations in the rule catalog use physical PDF page numbers or EPUB spine section IDs; they are not guessed printed page numbers.

## 3. A geometric interpretation that can actually be tested

### Reference domains

Maintain separate **site**, **building**, **floor**, **room**, and **fixture** reference domains. A kitchen in the building's SE corner can still have its stove in the wrong corner of that kitchen. A toilet room's location is distinct from the seated user's facing direction.

Save true-north bearing, north evidence/uncertainty, road frontage, polygon order, and the selected tradition. Plot side lengths alone may not determine an irregular shape. Do not run precise directional tests on a silently invented boundary.

### Mandala and center

For the first computational profile, propose a north-aligned bounding rectangle of the selected occupied domain subdivided into a 3×3 grid. Center means the middle cell. This **is a Keystone operational approximation requiring consultant review**, not a claim that all texts prescribe that grid for every house. Preserve the real footprint and clipped area; do not fill courts or missing corners to make scores look good.

For irregular/rotated buildings, report how much of each grid cell actually exists, and flag sensitivity to the chosen domain. A consultant may prescribe a different mandala, center or auspicious divisions. Store that as a different versioned profile. Never mix a 3×3 room test with a 9-part entrance test without recording the reference convention.

### Region tests

Record room area overlapping each region, centroid region and any protected-region intersection. For preferences, compare overlap distributions; do not claim a universal threshold such as “51% makes it compliant” without agreeing it. For exclusions, inspect the full footprint, not only a favorable centroid. The current fact evaluator expects an upstream reviewed classifier and does not pretend to implement polygon clipping.

Record numerical tolerances and ambiguous edge cases. Exact-boundary and near-boundary cases should be `unknown/review` until the profile defines their treatment, rather than flickering between pass/fail due to rounding.

### Direction vectors

Bed head direction is foot-to-head. Cooking/studying/praying/WC facing is the person's view direction in the actual arrangement. Stair clockwise means signed turns along the ascending path viewed from above using a documented coordinate convention. These must remain unchanged when only the camera or drawing orientation changes.

### Vertical relationships

Check room/stair/puja/wet-core overlaps across levels, not just within one plan. Use actual finished elevations and member envelopes. A false ceiling does not remove a beam from the structural model. A tank has a type, volume, weight, support and access requirements as well as a compass zone.

## 4. House organization and preferred alternatives

### Reserve scarce zones before packing rooms

Start with protected center and NE space, legal entry/road access, the stair/service core and the RC frame's feasible configurations. Then allocate kitchen SE, primary bedroom SW, puja NE and suitable wet/guest zones. This is a coupled search: NW cannot simultaneously hold every bathroom, guest room and garage on a compact plot.

Generate alternative allocations across floors and core positions while retaining required relationships. Do not enlarge the program invisibly or lose bike parking, shafts, wardrobe depths or finished stair clearances. Floor-level program decisions must be visible to the household.

### Core placement sequence

1. Plot/envelope and actual north; distinguish unverified survey geometry.
2. Legal/usable access, parking approach and protected open/daylight zones.
3. Structurally feasible stair core and RC grid with future-floor assumptions.
4. Puja, kitchen, primary bedroom and wet-core arrangement across levels.
5. Living, dining, other bedrooms and study according to household use and selected profile.
6. Doors/windows with actual legal exposure and egress.
7. Furniture and working-direction tests.
8. Service equipment, sanitary routes and roof tank/support coordination.
9. Facade/colors and optional ritual/decor elements on unchanged geometry.

Sources: catalog V01–V21, A01–A03. The sequence itself is Keystone's engineering synthesis, not a quotation from a single book.

### Half-turn staircase

Owner default: half-turn stairs with an intermediate landing. First test S/W locations under the selected Jain-led profile, keep NE and center clear, and prefer clockwise ascent. Alternative consultant profiles can use Pathi's NW/SE location family. Do not simultaneously require both.

Fit risers to the real floor-to-floor height before considering odd-count preferences. The sources do not resolve all counting conventions. Odd count cannot justify unequal risers, insufficient landing, a low beam or an extra trip step. Keep the entire travel envelope, rails and landings in the model. See V14–V17 and V40–V41.

### Compact Nepal homes

A small four-aana site must not be made to appear feasible by replacing a required habitable-room court with a tiny plumbing shaft. Apply the relevant light/ventilation rules separately. Bathroom/puja separation may require vertical rearrangement, not merely turning a door. An overhead SW tank may require structural changes that outweigh directional convenience; carry that conflict to the engineer.

Do not create split levels or raised thresholds solely for Vaastu if they defeat the user's accessibility requirement. Do not route drainage toward a preferred compass direction if the site outfall, neighbors or sanitation design prohibit it.

## 5. Conflicts that must remain visible

| Conflict | Evidence | Selected handling |
|---|---|---|
| Stair placement S/W versus NW/SE | Jain section 24; Pathi section 8 | Jain-led default; separate alternative profile, shared NE avoidance |
| NE children's bedroom versus avoiding NE bedrooms | Pathi section 8; Jain sections 18/20 | Do not apply primary-bedroom rules to every household room; select an explicit secondary-bedroom policy |
| Puja NE/N/E versus W/S/NE | Jain section 14; Pathi section 8 | Prefer NE; record alternatives, do not call them universal |
| Dining W/N/E versus S/E near kitchen | Jain section 17; Pathi section 8 | Preserve same-floor proximity; resolve direction in selected profile |
| Bathroom NW/W versus E; toilet S in comparative table | Jain section 19; Chakrabarti physical page 140 | Distinguish bathroom from WC and select one interpretation |
| Entry S/W sometimes permitted, later forbidden | Jain section 13 | No blanket rejection of south/west road plots; consultant-reviewed entrance division rule |
| Door counts differ | Jain section 12; Pathi section 8 | Optional/manual; never delete a necessary door to satisfy numerology |
| Center courtyard versus hall/open space interpretation | Chakrabarti physical pages 18, 136–137; Svoboda section 13 | Record chosen center treatment; legality/daylight evaluated independently |
| Preferred north/east openness versus municipal boundary constraints | Chakrabarti physical page 140 | Compliant alternatives and explicit unmet preference; never waive setback/opening rules |

The books cannot be combined into a single unqualified “all authors agree” checklist. The selected profile and each departure should appear in the plan's Vaastu report.

## 6. What not to automate as engineering

Exclude promises of medical cures, wealth, relationship success, magnetic-energy guarantees and fear-based predictions. Do not use a mirror, crystal, ritual symbol or color to turn an invalid stair, blocked window or broken load path into a passing result.

Do not import historical caste-based plot/material assignments, gender-based resident worth or staff-control prescriptions. Use explicit household preferences and equal usability. Religious decor remains optional and user-selected.

For exact entrance padas, ayadi/measurement systems, auspicious dates and ritual prescriptions, retain references and manual-review status until the owner selects a qualified interpreter and a precise method. Do not invent executable formulas from partial tables.

## 7. Required plan explanation

Every option should state: selected Vaastu profile/version; source-backed rules satisfied; preferred versus fallback placements; conflicts; unknown measurements; professional-review items; and mandatory validation status. Each finding needs a room/member ID, evidence value, source locator and a practical correction.

Example: “Kitchen is NW, the profile's stated alternative to SE. SE is occupied by the only feasible stair configuration. Primary bedroom remains SW; puja remains NE. Stair location follows the alternative profile selected for this option.” This is useful. “98% positive energy” is not a valid metric.

The knowledge system implemented here supplies references, rules and conservative fact checks. Connecting those checks to real generated geometry is the next engine task; the deployed US generator is unchanged.
