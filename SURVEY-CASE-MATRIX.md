# Survey case matrix — 2026-10-01

Every case was entered through the studio's own survey builder (`buildNepalSurvey`) and sent to the same API handler the website calls. Each case goes through:

- survey check;
- working plans;
- 3D/JSON;
- A3 drawing set;
- AutoCAD DXF;
- NBC 105 structural calculation.

Re-run it with `node local/tools/nepal-survey-matrix.cjs [prefix] --out report.md`.

## Result (latest, after the second pass)
**76 cases: 51 planned end to end, 23 refused with a message, 2 no plan with reasons, 0 crashes.**
First run: 18 of 60. After the first fix pass: 42. The second pass (see `HANDOVER.md` §2) added:
- road-side orientation and corner plots;
- all Annex C municipalities;
- narrow, mid-stair and shallow layouts;
- room-redistribution program variants;
- plannability-ranked rectangles for drawn plots.

Still no plan:
- **R3** (7.5 m plot with 1 m side setbacks, 4 bedrooms + puja on 2 floors). It works with 0 m shared-wall sides, and a hint says so.
- **D6** (triangle: largest plannable rectangle 5.7 × 6 m).

Refused by design: invalid inputs, rentals above owner floors, straight/quarter-turn stairs.

## First pass (history)

**76 cases: 42 planned end to end, 24 refused with a message, 10 get no plan, 0 crashes.**

Before this pass, only **18 of 60** valid-or-invalid cases produced plans. Only the default 11.25 m square and near-identical plots worked.

## What was broken and is now fixed
| Problem found | Cases | Fix |
|---|---|---|
| A **0 m setback** (shared wall with a neighbour) was refused as "needs a positive number". Narrow plots could not be entered at all. | S1–S4 | `units.js` / `normalizeBrief.js` accept 0 for proposed setbacks. |
| **Any plot larger than ~11.5 m square got no plan.** The footprint filled the whole plot-minus-setbacks area, then failed the 70 % coverage cap. | R6, R8, R11, P2, P4 | `candidateSearch.js` `fitCoverage`: the footprint shrinks proportionally to the cap, keeping the road side. A note on the review sheet and site plan says so. |
| **Single-storey houses never planned.** The planner required a stair arrival on every floor. | R7, T1–T4 | The core bay becomes the entrance hall over the reservoir, reserved for a future stair. A whole 2-bed owner floor uses the compact flat layout. |
| **Floor heights above 3.0 m failed.** The stair bay was a fixed 4.585 m. | P9 | The stair bay is sized from the storey height (up to NBC 205's 4.5 m bay, flagged against the 14 ft preference). |
| **Drawn plots never got plans**, even a drawn rectangle. | D1–D9 | New `plotFit.js` turns the plot so the road edge is at the bottom and plans on the largest rectangle inside the boundary. North is turned with it. The site plan and DXF show the real boundary; area and FAR use the real plot area. |
| Typing **"Kathmandu"** or **"KMC"** was refused as an unreviewed municipality. | X4, X25, X26 | Common spellings map to the supported profiles. The refusal names the supported cities, and the studio suggests them. |
| A partial top floor larger than possible passed the survey check, then failed silently. | X18 | Refused at survey time with the limit. |
| "No plan" gave no reason. | all no-plan cases | The JSON/studio message lists the top reasons. Too-small plots get an explicit "buildable area below minimum" message. |
| Structure: a 1.2–1.8 m grid bay made the engine enlarge every member to 500 mm and still fail. The Annex A spacing rule ("need not be less than 75 mm") was also applied wrongly. | T2, T7, R8, P4 | Very short bays are reported as a **layout review** item. The link-spacing floor is now 75 mm, and 4-legged links are allowed on wide beams. All four now pass at 350–450 mm columns. |
| Site plan drew the road only on the bottom edge. | N1–N3 | The road is drawn on whichever edge faces it. |

## Still not covered (no plan, honestly reported)
| Case | Why | What it needs |
|---|---|---|
| Plots narrower than ~8.5 m with 1 m side setbacks (7.5×12, 6×18, 16×8, 16×9) | Buildable width/depth is below the planner's 6.5 × 7.5 m minimum (stair core + rooms). 7.5 m plots work when shared-wall sides are entered as 0 m. | A narrow-plot layout family (stair across the depth, single-loaded rooms). Very common in Kathmandu, so this is the most valuable next step. |
| 6 m-wide plots even with 0 m sides (S2) | 6 m < 6.5 m minimum. | Same narrow-plot family. |
| L-shaped and triangular drawn plots (D5, D6) | The largest inner rectangle is too narrow. | Plans that follow two rectangles of an L plot. |
| Big programs on small plots (T6: 3 storeys, 5 bed + study on 11.25 m square; S3; S4) | Rooms do not fit along the frontage beside the stair. | A two-row (double-loaded) floor layout. Could also suggest moving rooms between floors. |

## Refused by design (24 cases, all with clear messages)
- **Missing or invalid input:** ward; width; north; north evidence; road width; reservoir < 5,000 L; area mismatch; zero/negative counts; no kitchen; attached > bedrooms; floor height 0; unknown balcony level; road edge also marked as a building; guest bedroom without a second bedroom; self-crossing drawn plot; misspelt room ("pooja"); rental flag without a rental floor.
- **Rentals above owner floors.** Separate access is not reviewed yet.
- **Straight / quarter-turn stairs.** No verified Nepal profile yet.
- **Municipalities other than Kathmandu and Pokhara Metropolitan.** No reviewed bylaw profile. This currently excludes Lalitpur, Bhaktapur, Kirtipur, Budhanilkantha, Tokha and others in the valley; it is an owner decision whether to allow them with generic working assumptions.

## Gaps in the survey itself (not yet asked)
- **Corner plots.** Only one road edge is used. A second road marked in the boundary list is recorded but not planned for.
- **Plot slope, levels and basement.** Recorded as free text only.
- **Soil test results.** Asked only in the structural panel (soil type, bearing capacity), not in the survey.

## Full table (latest)
| Case | Result | Detail |
|---|---|---|
| R1 standard 11.25×11.25 (4 aana), 2.5 st owner | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| R2 tiny 6×9 m (1.7 aana), 2.5 st | refused | PARTIAL_AREA_TOO_LARGE: The partial top floor cannot exceed 65 % of a full floor; on this 54 m² plot that is well under 35 m². |
| R3 small 7.5×12 m, 2 st | no plan | 20× Mid-stair layout: the rooms need 6.3 m behind the stair; 2.4 m is available.; 10× Narrow layout: the rooms need 7.7 m behind the stair; 5.4 m is available. |
| R4 narrow-deep 6×18 m, 3 st | planned | 2 options, floors f5/f5/f4/p2; drawings 200 (11 sheets), DXF 200, structure: 500 col, 350×500 beam, pass=false, V=647 kN, NBC205=false |
| R5 wide-shallow 16×8 m, 2.5 st | planned | 2 options, floors f3/f4/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=462 kN, NBC205=false |
| R6 large 20×25 m, 3 st, 2 cars | planned | 3 options, floors f9/f8/f8; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=1530 kN, NBC205=false |
| R7 single storey 10×12 | planned | 3 options, floors f6; drawings 200 (8 sheets), DXF 200, structure: 350 col, 230×355 beam, pass=true, V=134 kN, NBC205=true |
| R8 3.5 st owner 12×14 | planned | 3 options, floors f6/f5/f5/p0; drawings 200 (11 sheets), DXF 200, structure: 400 col, 300×400 beam, pass=true, V=744 kN, NBC205=false |
| S1 7.5×12, side setbacks 0 (shared walls), 2.5 st | planned | 3 options, floors f4/f6/p1; drawings 200 (10 sheets), DXF 200, structure: 450 col, 300×450 beam, pass=true, V=391 kN, NBC205=false |
| S2 6×15, side setbacks 0, 2.5 st | planned | 2 options, floors f4/f4/p3; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×400 beam, pass=true, V=381 kN, NBC205=false |
| S3 9×12, side setbacks 0, rear 1.5, 3 st | planned | 3 options, floors f6/f5/f5/p1; drawings 200 (11 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=579 kN, NBC205=false |
| S4 8×10 (2.5 aana), side 0, 2.5 st | planned | 3 options, floors f3/f5/f1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=370 kN, NBC205=true |
| T1 single storey 11.25 sq, 2 bed + puja | planned | 3 options, floors f6; drawings 200 (8 sheets), DXF 200, structure: 350 col, 230×355 beam, pass=true, V=130 kN, NBC205=false |
| T2 single storey 12×14, 2 bed + puja | planned | 3 options, floors f7; drawings 200 (8 sheets), DXF 200, structure: 350 col, 230×355 beam, pass=true, V=181 kN, NBC205=false |
| T3 single storey 11.25 sq, 2 bed no puja | planned | 3 options, floors f6; drawings 200 (8 sheets), DXF 200, structure: 350 col, 230×355 beam, pass=true, V=131 kN, NBC205=false |
| T4 single storey 14×16, 3 bed + puja | planned | 3 options, floors f8; drawings 200 (8 sheets), DXF 200, structure: 350 col, 230×355 beam, pass=true, V=223 kN, NBC205=false |
| T5 2 storey on 11.25 sq | planned | 3 options, floors f6/f5; drawings 200 (9 sheets), DXF 200, structure: 400 col, 300×400 beam, pass=true, V=310 kN, NBC205=false |
| T6 3 storey owner on 11.25 sq | planned | 3 options, floors f6/f5/f5/p1; drawings 200 (11 sheets), DXF 200, structure: 450 col, 350×500 beam, pass=true, V=612 kN, NBC205=false |
| T7 3.5 owner on 11.25 sq | planned | 4 options, floors f7/f5/f5/p0; drawings 200 (11 sheets), DXF 200, structure: 450 col, 350×500 beam, pass=true, V=595 kN, NBC205=false |
| R10 wide-shallow 16×9 m | planned | 2 options, floors f4/f4/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=486 kN, NBC205=false |
| R11 13×20 m, 2.5 st, 1 car | planned | 4 options, floors f4/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 500 col, 350×500 beam, pass=true, V=771 kN, NBC205=false |
| R9 feet-sized 35×40 ft entered as m (10.67×12.19) | planned | 4 options, floors f4/f6/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×400 beam, pass=true, V=456 kN, NBC205=false |
| N1 road top edge, north 90 | planned | 3 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=420 kN, NBC205=false |
| N2 road right edge (east road), north 90 | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=420 kN, NBC205=false |
| N3 road left edge (west road) | planned | 3 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| N4 north 0 (north to the right) | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=420 kN, NBC205=false |
| N5 north 45 (skewed) | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| N6 north 270 (south up) | planned | 3 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=420 kN, NBC205=false |
| N7 north 200 + east road | planned | 3 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=420 kN, NBC205=false |
| N8 two road edges (corner plot) marked in boundaries | planned | 8 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| P1 rental 3.5 st (2 rental floors) | planned | 6 options, floors f6/f6/f7/p0; drawings 200 (11 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=607 kN, NBC205=false |
| P2 rental 3 st (1 rental floor), stair west | planned | 6 options, floors f6/f7/f4; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×400 beam, pass=true, V=617 kN, NBC205=false |
| P3 rental above owner (should be refused) | refused | RENTAL_ABOVE_OWNER_PENDING: Independent rentals above owner floors need a separate reviewed access arrangement. Place rentals below the owner home for this first profile. |
| P4 big family 3 st, separate dining, store, laundry, walk-in | planned | 3 options, floors f8/f8/f8; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×400 beam, pass=true, V=757 kN, NBC205=false |
| P5 balconies requested on level-2 | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| P6 car parking 1 on 11.25×11.25 | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| P7 10,000 L reservoir | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| P8 floor height 2.9 m | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=411 kN, NBC205=false |
| P9 floor height 3.3 m | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×400 beam, pass=true, V=452 kN, NBC205=false |
| P10 declared area 4 aana (matches 126.56 m²? 4 aana=127.2 m²) | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| D1 drawn rectangle 11.25×11.25 | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| D2 drawn near-rectangle (88° corner) | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=417 kN, NBC205=false |
| D3 trapezoid (front 12, back 9, depth 10) | planned | 3 options, floors f4/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 350×450 beam, pass=true, V=365 kN, NBC205=false |
| D7 rotated rectangle (road on side 3), north 30 | planned | 3 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×400 beam, pass=true, V=477 kN, NBC205=false |
| D8 5-sided, road on side 2, 3.5 rental | planned | 6 options, floors f6/f6/f7/p0; drawings 200 (11 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=607 kN, NBC205=false |
| D9 drawn in feet via sketcher (35×50 ft) | planned | 4 options, floors f4/f6/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=493 kN, NBC205=false |
| D4 5-sided irregular (fixture shape) | planned | 3 options, floors f4/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=398 kN, NBC205=false |
| D5 L-shaped plot (6 corners) | planned | 3 options, floors f4/f4/p3; drawings 200 (10 sheets), DXF 200, structure: 450 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| D6 triangle | no plan | 20× Shared core does not fit within this footprint; 10× Shallow layout: the rooms need 7.3 m of frontage beside the stair; 3.0 m is available. |
| X1 ward missing | refused | REQUIRED: Enter the plot ward number. |
| X2 Lalitpur (no reviewed bylaw profile) | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| X3 Pokhara | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 450 col, 300×450 beam, pass=true, V=474 kN, NBC205=false |
| X4 municipality typed "Kathmandu" | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| X25 municipality typed "kmc" | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 400 col, 300×450 beam, pass=true, V=418 kN, NBC205=false |
| X26 municipality typed "pokhara" | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 450 col, 300×450 beam, pass=true, V=474 kN, NBC205=false |
| X27 partial floor 70 m² on 11.25 sq plot | planned | 4 options, floors f5/f5/p1; drawings 200 (10 sheets), DXF 200, structure: 450 col, 300×450 beam, pass=true, V=459 kN, NBC205=false |
| X5 width 0 | refused | INVALID_UNIT: site.rectangle.width needs a positive number and a supported unit (mm, cm, m, ft). |
| X6 width blank | refused | INVALID_UNIT: site.rectangle.width needs a positive number and a supported unit (mm, cm, m, ft). |
| X7 north blank | refused | REQUIRED: Enter true-north bearing. |
| X8 north 360 | refused | INVALID: True-north bearing must be 0 to less than 360 degrees. |
| X9 north evidence blank | refused | REQUIRED: Record the source of the north bearing. |
| X10 road width blank | refused | INVALID_UNIT: site.frontageEdges.0.roadWidth needs a positive number and a supported unit (mm, cm, m, ft). |
| X11 straight stair | refused | STAIR_TYPE_PENDING: This stair type needs a verified Nepal geometry profile. |
| X12 reservoir 3000 L | refused | INVALID: Ground reservoir must hold at least 5,000 L, enough for one full water delivery truck. |
| X13 declared area 6 aana vs 4 measured | refused | AREA_DISAGREEMENT: Declared and measured plot areas differ by more than 2%; verify the survey. |
| X14 no bedrooms at all | refused | INVALID: Enter a whole number from 1 to 16.; INVALID: Enter a valid whole-number room count. |
| X15 no kitchen | refused | INVALID: Enter a whole number from 1 to 4.; INVALID: Enter a valid whole-number room count.; OWNER_SELF_SUFFICIENCY: Owner floors need a kitchen and living room. |
| X16 attached > bedrooms | refused | INVALID: Attached bathrooms cannot exceed this level’s bedrooms or bathrooms. |
| X17 floor height 0 | refused | INVALID: Finished floor elevations must increase.; INVALID: Finished floor elevations must increase. |
| X18 partial area larger than plot | refused | PARTIAL_AREA_TOO_LARGE: The partial top floor cannot exceed 65 % of a full floor; on this 127 m² plot that is well under 82 m². |
| X19 balcony on unknown level | refused | UNKNOWN_BALCONY_LEVEL: Balcony request refers to an unknown level ID. |
| X20 road edge also marked building | refused | ROAD_BOUNDARY_CONFLICT: An edge marked as road frontage cannot also be marked as a neighboring building. |
| X21 guest bedroom with 1 owner bedroom | refused | GUEST_BEDROOM_DISTINCT: A guest bedroom needs a separate owner primary bedroom; request at least two owner bedrooms. |
| X22 drawn self-crossing plot | refused | INVALID: Survey boundary crosses itself.; INVALID: Surveyed plot has too little or no enclosed area. |
| X23 typo special room "pooja" | refused | INVALID: Choose supported special rooms: puja, guestBedroom, study, store or laundry.; UNKNOWN_SPECIAL_ROOM: Unsupported special room: pooja. |
| X24 rental flag but no rental floor | refused | INVALID: Rented floor count must match the floors marked as rental.; INVALID: Mark at least one floor as rental. |
