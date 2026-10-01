# Nepal house research and review of the ten plans

2026-09-30. This adds to [NEPAL-SPATIAL-PLANNING-RESEARCH.md](NEPAL-SPATIAL-PLANNING-RESEARCH.md), which covers the supplied drawing precedents and the solver design. This file covers how ordinary Nepali homes are organised, what Nepal's codes and 2015 earthquake experience imply for the plans, and a plan-by-plan review of the current ten review plans. It is research for the owner and the engineer, not a permit or structural opinion.

**Source note.** Several sites are blocked from this environment: Nepali government sites, the World Housing Encyclopedia and the Kathmandu Post. Facts from those are taken from search-result summaries and marked *(search summary; confirm against the document)*. Code facts already in the project catalog (`knowledge/rules.json`) cite the supplied PDFs and are marked with their rule ID.

## 1. How Nepali homes are organised

### Contemporary urban house (the owner's type)

- An RC frame with brick infill, usually 2.5–3.5 storeys on a small plot. It often has rental flats on the lower floors, with a shared stair and the owner's home above. The existing research cites Studio NEBA's *Brownstone* as a local rental-below/owner-above precedent.
- **Ground floor:** parking (bikes more than cars), a shop or a rental flat, and the water reservoir, usually under the stair. The owner's brief records 7,000–10,000 L, with a minimum of 5,000 L for one delivery truck.
- **Top:** a roof terrace (*kausi*) is used daily for drying clothes, sun in winter, a tulsi *muth*, water tanks and a solar water heater. The partial top floor is this terrace plus a small enclosed part, often the puja and a laundry. The owner's brief already asks for a tulsi muth on the topmost safe balcony.
- **Puja:** a dedicated puja room on the owner's floors (owner decision). It is kept calm and separate from toilets and stairs (catalog V05–V07, V44).
- **Kitchen:** combined kitchen and dining by default (owner decision). A separate dining room only on request.

### Traditional Newar house (cultural reference, not a template)

- It is organised vertically over about three storeys, with a spine wall that creates front and back rooms.
- **Ground (*chheli*):** storage and, where present, the bathroom.
- **First (*matan*):** bedrooms.
- **Second (*chota*):** living room and receiving visitors.
- **Top/attic:** the kitchen, directly under the roof, and the private shrine.
- *(Search summary of the World Housing Encyclopedia report 99 and Bhaktapur.com; confirm against the document.)*

**What carries over:** private and ritual functions go up, public functions go down, and roof terraces are working spaces. This supports the owner's choices of an upper-floor puja and an upper owner home. It is not a rule to put every kitchen on the top floor, and the masonry structure does not transfer to RC.

## 2. Codes, bylaws and seismic lessons that affect the plans

| Topic | What the evidence says | Effect on the current plans |
|---|---|---|
| **Setbacks** | The 2015 national bylaws are reported to require a **1.5 m** setback from the plot boundary for buildings up to 10 m (about three storeys). Outer columns and isolated footings are reported to sit at least 1 m inside the plot. *(Search summary of the Kathmandu Post, 28 Oct 2015; confirm against the adopted bylaw.)* Catalog B07 already separates opening-side, blank-wall, road and height conditions. | **The fixtures use 1 m working setbacks.** With 1.5 m, the 11.25 m test plot's buildable width falls from 9.25 m to 8.25 m, and the stair (2.6 m) + corridor (1.1 m) + main strip layout gets much tighter. The review already marks windows closer than 1.5 m in red. Setbacks must come from the adopted municipal rule before any plan is trusted. They vary by municipality, not by ward (owner, 2026-10-01), and will be added as municipal profiles later. |
| **Ground coverage** | 70% up to 250 m² of plot, 60% above (catalog B03, resource book p. 54–55; municipal adoption unverified). | Plans cover 64.7% (owner) and 67.6% (rental), within 70%. |
| **NBC 205 ready-to-use route** | For small owner-built RC houses: up to three storeys, spans under 4.5 m, a footprint limit around 1,000 ft², and minimum column sizes. The 2024 edition's detailing guideline is reported as 320 × 320 mm. *(Search summaries; catalog G03/G05 cite NBC 205:2024 p. 15–17 and require checking eligibility as a whole.)* | Columns (350 mm) and bays (owner cap 4.27 m) are inside these figures. **The 3.5-storey rental house exceeds three storeys**, so it should be treated as engineered design, not the ready-to-use route. `RC_FRAME_NOT_ENGINEERED` stays on every plan. |
| **Soft/weak ground storey** | In the Gorkha 2015 earthquake, Kathmandu RC houses with an open ground storey (parking or shops) and upper-floor offsets performed poorly. Surveys also name slender partitions, cantilevered upper floors and poor detailing. *(NICEE and journal summaries.)* Catalog S04–S06 cite NBC 105:2025 §5.4. | **New finding** `OPEN_GROUND_BAY_SOFT_STOREY_AND_TORSION_REVIEW`: owner plans with the open bike bay (about a quarter of the ground floor, off-centre) record its share and offset. **New finding** `UPPER_FLOOR_SETBACK_IRREGULARITY_REVIEW` records each partial top floor's area ratio and centroid offset. The engine only flags these; the engineer decides. |
| **Daylight and ventilation** | Openings of room area/10 (kitchen /8), ventilation /16, and a 3 × 3 m court for habitable rooms (NBC 206:2024 p. 17; see the earlier research). | Unchanged: `DAYLIGHT_AND_OPENINGS_UNVERIFIED` remains. |
| **Climate** | Kathmandu has cold winters and a monsoon. South-facing glazing within about 15–30° of true south captures winter sun, and shading, insulation and airtightness roughly halved modelled energy use for Kathmandu houses. *(UiT thesis on Nepali passive houses; general passive-solar guidance.)* | Most daylight openings are on the north or east faces because of the core position, as Vaastu prefers (V37). South glazing for winter sun is not yet a planning objective; it can conflict with the Vaastu preference, so it should be offered as an explicit owner choice, not applied silently. |

## 3. Plan-by-plan review (current engine, puja on the top owner floor)

**Orientation:** north is to the right on every sheet.
**Shares:** the fraction of the room inside its preferred Vaastu zones on its own floor: puja NE/N/E, kitchen SE/E, primary bedroom SW/S/W, stair S/W/SW.

| Plan | Program | What works | What does not |
|---|---|---|---|
| 1 | Owner, west stair, living-first | No puja/toilet stacking, no NE toilet: the attached bath now sits by the family foyer and the bedroom is entered through a vestibule. No main-room grid exceptions. Entry opens to living. | Puja 0.00 (SW of the top floor; the NE corner is above the first-floor bath). Kitchen 0.00, primary bedroom 0.00. Open bike bay in the NE of the ground floor (NE should be light and uncluttered, V04; torsion review). |
| 2 | Owner, east stair, living-first | No V06/V13 conflicts with the default attached bath (it is SE, not NE). Entry opens to living. | Puja 0.13, kitchen 0.00, primary bedroom 0.18. The primary bedroom crosses a grid bay. |
| 3 | Owner, west stair, bedrooms-south | Reworked bath (vestibule); kitchen 0.31. | Entry does not face living. Puja 0.00, primary bedroom 0.00. |
| 4 | Owner, east stair, bedrooms-south | Kitchen 0.70 (best owner kitchen). | Entry does not face living. Two grid exceptions. Puja 0.13, primary bedroom 0.18. |
| 5 | Rental + owner, east stair, living-first | Primary bedroom 0.70, rental kitchens 0.67. Puja moved off the bathroom stack (option A). | Puja 0.11. Seven grid exceptions. Requested parking not placed. |
| 6 | Rental + owner, west stair, living-first | Puja 1.00 (NE corner of the top floor). | Kitchens 0.05–0.12, primary bedroom 0.15. Long owner corridor with the living room at its far end. Seven grid exceptions. |
| 7 | Rental + owner, east, kitchen-south | Kitchens 1.00 on every floor, primary bedroom 0.70. | Puja 0.11. Three levels without a living-facing entry. Nine grid exceptions. |
| 8 | Rental + owner, west, kitchen-south | Puja 1.00. | Kitchens 0.44, primary bedroom 0.15. Entry and grid problems as in 7. |
| 9 | Rental + owner, west, bedrooms-south | Puja 1.00. | Kitchens 0.00, primary bedroom 0.00. Entry and grid problems as in 7. |
| 10 | Rental + owner, east, bedrooms-south | – | Puja 0.11, kitchens 0.00, primary bedroom 0.00. Entry and grid problems as in 7. |

The C17 drain routes are reserved on all ten plans:
- **Plans 1–2:** a new exterior stack from the first-floor bath (0.75–1.3 m run).
- **Plans 5–10:** a 1.16 m branch from the second owner bath into the stacked bath next to it.

### Architect's reading

1. **No plan satisfies the core Vaastu set together** (puja NE, kitchen SE, primary bedroom SW, stair S/W). Each good share is bought by a bad one elsewhere. For example, plan 7 has perfect kitchens but a 0.11 puja; plans 6 and 8 have a perfect puja but weak kitchens. This is the structural limit of the strip planner, which places rooms in fixed bands and measures Vaastu afterwards. DESIGN-PRINCIPLES §4 asks for the opposite: reserve the NE, SE and SW zones first, then pack the rooms. This is the largest remaining engine task (see §4).
2. **The stair core decides too much.** With the core on the west (drawing bottom-left = south side at bearing 0), the primary-bedroom band lands in the north-east. A west-core plan cannot place the primary bedroom in the south-west without moving the core.
3. **Rental plans 7–10 are weaker than 5–6.** They add entries that do not face the living room and more grid exceptions. They are useful as critique examples, not candidates.
4. **The best current starting points:** plan 5 for the rental house (good primary bedroom and kitchens, puja moved off the toilet stack), and plan 2 or 4 for the owner house.

## 4. Changes made in this pass, and what remains

**Implemented and tested** (details in EXECUTION-LOG.md):
- **Rework (owner instruction):** the west-core owner bedroom floor no longer has an NE toilet (vestibule rework).
- **Balcony:** closable glazing for the living-room balcony (owner decision) is recorded.
- **C17:** drain routes are reserved for offset wet rooms.
- **Ranking:** core-Vaastu conflicts rank before the preference score.
- **Puja retry:** a V05 retry for service-bay pujas, which is only accepted when it reaches the preferred zones. On these fixtures it does not, and says so.
- **Seismic findings:** open-ground-bay and upper-floor-offset review findings.
- **3D:** a 3D study-massing view of the Nepal geometry in the studio.

**Still open, in priority order:**
1. **Zone-first allocation across floors.** Reserve puja NE, kitchen SE, primary bedroom SW and the wet stack before packing rooms, choosing the core position jointly. This is the constraint-solver prototype in NEPAL-SPATIAL-PLANNING-RESEARCH.md steps 3–5. It is a multi-week build, not a patch.
2. **Adopted setbacks.** Setbacks are set per **municipality**, not per ward (owner, 2026-10-01). They will be added at a later stage as municipal profiles; until then the 1 m working setbacks stay flagged. 1.5 m (if confirmed) changes every plan.
3. **Rental parking.** Requested parking is still not placed on the rental plans.
4. **Professional items that must stay flagged:**
   - municipal adoption;
   - RC frame design (the 3.5-storey house needs engineered design);
   - soft-storey and torsion analysis;
   - stair headroom;
   - door swings and egress;
   - daylight legality;
   - balcony guards and drainage;
   - tank engineering;
   - drain pipe sizes and falls.

## Sources

- [NBC 205:2024 (Birendranagar municipality copy)](https://birendranagarmun.gov.np/sites/birendranagarmun.gov.np/files/documents/NBC-205-2024.pdf): blocked here; content via search summary and catalog G03/G05.
- [NBC 205 ready-to-use detailing guideline (Mahalaxmi municipality)](https://ebps.mahalaxmimun.gov.np/UploadFiles/NBC_205_READY-TO-USE_DETAILING_GUIDELINE_FOR-signed.pdf)
- [Seismic vulnerability of non-code-compliant and code-compliant RC buildings (RUDN journal)](https://journals.rudn.ru/structural-mechanics/article/view/46173/en_US)
- [Kathmandu Post, "Govt brings new building bylaws", 28 Oct 2015](https://kathmandupost.com/valley/2015/10/28/govt-brings-new-building-bylaws): blocked here; search summary only.
- [NICEE, Nepal earthquake 2015 short presentation](https://www.nicee.org/nepaleq/NICEE_Nepal-EQ_2015-Short-Presentation.pdf)
- [Frontiers in Built Environment, 2016, RC building damage in the Gorkha earthquake](https://www.frontiersin.org/journals/built-environment/articles/10.3389/fbuil.2016.00031/pdf)
- [WCEE 2017 paper 3278](https://www.wcee.nicee.org/wcee/article/16WCEE/WCEE2017-3278.pdf)
- [World Housing Encyclopedia report 99, Traditional Nawari house](https://world-housing.net/report-99-traditional-nawari-house-in-kathmandu-valley/): blocked here; search summary only.
- [Bhaktapur.com, a closer insight into a typical traditional Newari house](https://www.bhaktapur.com/a-closer-insight-into-typical-traditional-newari-house/)
- [UiT thesis, Energy efficient building for the Nepalese market](https://munin.uit.no/handle/10037/11332)
- [Wikipedia, Architecture of Nepal](https://en.wikipedia.org/wiki/Architecture_of_Nepal)
