# Keystone Nepal — handover

Status on 2026-10-01, branch `claude/affectionate-dijkstra-uukliw`. This is the single place to start. The file-by-file history is in `EXECUTION-LOG.md`; the survey test results are in `SURVEY-CASE-MATRIX.md`.

**What Keystone Nepal does today.** It is a local web studio. The owner fills in a survey: municipality, plot, road, north, floors and rooms. It then produces spatial **review plans** (it does not yet produce plans for permits or construction). It produces:

- Vaastu-led floor plans with furniture and sanitary fittings;
- an A3 drawing set (architectural, sanitary, roof and structural layout sheets);
- an AutoCAD DXF;
- a 3D model with chosen paint colours;
- a step-by-step NBC 105:2025 structural load and seismic calculation.

Everything is marked "for review only". The professional checked-by, NEC number and signature fields are always left blank.

---

## 1. How to run it

You need Node.js 20+ and Python 3.

```
git clone https://github.com/niharika-bhattarai/keystone-nepal-for-cloud
cd keystone-nepal-for-cloud && git checkout claude/affectionate-dijkstra-uukliw
cd local/backend-keystone && npm install && pip install -r requirements.txt
cd ../frontend-keystone && npm install
cd ../planner && pip install -r requirements.txt
cd .. && node tools/run.cjs dev        # from local/
```

Open http://127.0.0.1:5299 → studio → **Nepal brief**. Fill the survey (or draw the plot), then use:

1. **Check Nepal brief**
2. **View 3D study massing**

The 3D panel then offers:

- the colour galleries;
- **Open A3 review drawing set**;
- **Download AutoCAD drawing**;
- **Open structural load calculation**.

Public hosting is disabled on purpose; the site is local-only.

### Tests

| What | Command | Expected result |
|---|---|---|
| Backend | `cd local/backend-keystone && node --test test/nepal-*.test.js` | 96/97 pass. The one failure is expected: the code PDFs and Vastu books are not in `Design Files/` in this copy. |
| Frontend | `cd local/frontend-keystone && node --test test/*.test.mjs` | 39/42 pass. The 3 failures are preview-deployment config tests; preview is deliberately disabled. |
| Python | `python3 -m unittest discover -s local/planner` | OK |
| Survey matrix (76 cases, ~90 s) | `node local/tools/nepal-survey-matrix.cjs --out report.md` | See the table below. |

---

## 2. What has been achieved (this working period)

### Plans and survey

| Area | Result |
|---|---|
| **Survey coverage** | 76 test cases; **51 planned end to end, 23 refused with a clear message, 2 no plan with reasons, 0 crashes** (was 18/60). |
| **Road orientation** | The plan is turned so the road edge is always the front. Before, the entrance always faced the survey's bottom edge, so east/north/west-road plots faced a neighbour. |
| **Corner plots** | Every edge marked "road" gets its own set of plans ("entrance from the east road", etc.). |
| **Municipalities** | All 753 NBC 105 Annex C local units are accepted (Lalitpur, Bhaktapur, Tokha, Kirtipur and the rest), with common spellings recognised. Only Kathmandu has a reviewed bylaw profile. Elsewhere plans use generic working setbacks (1 m) and 70 % coverage and say so on every sheet. |
| **Shared-wall plots** | A 0 m side setback is accepted (it was refused before). |
| **Large plots** | The footprint shrinks to the 70 % coverage cap instead of failing. |
| **Narrow plots (3.9–6.5 m buildable)** | Two new layouts: (a) **front stair**, with a pass-through living room and a side passage to the rooms behind; (b) **mid-depth stair** (Kathmandu row house): full-width front room, passage and bath beside the stair, rooms stacked behind. |
| **Shallow plots (6–7.5 m deep)** | **Front-gallery** layout: a 1.6 m gallery along the road, rooms side by side behind it, columns hidden in the gallery wall. |
| **Single-storey houses** | Planned; the stair bay is kept as an entrance hall over the water tank for a future stair. |
| **Tall storeys (> 3 m)** | The stair bay grows with storey height, up to NBC 205's 4.5 m bay limit. |
| **Drawn (irregular) plots** | Planned on the largest *plannable* rectangle inside the boundary, turned so the road is at the front. The real boundary is drawn on the site plan and in the DXF; area and FAR use the real plot. |
| **Rooms that don't fit** | A labelled **program variant** is offered for household confirmation; it is never applied silently. It may move a bedroom, study or puja between owner floors, or add a floor. |
| **East-road entrance (owner question)** | Decided after drawing and inspecting the options. The default stays **entrance into living**: the top-ranked plan avoids a north-east stair and leaves the north-east open. A **"Vaastu alternative (kitchen SE/E)"** plan is now always added when no shown plan has its kitchen in the south-east/east. |

### Structural calculation (NBC 105:2025)

- **Method.** Loads come from the actual walls, slabs and stair. The seismic weight, Annex C zone factor, soil type and period (empirical and Rayleigh) feed an ESM base shear. Storey stiffness uses the D-value method with cracked sections.
- **Checks.** Drift and torsion; irregularities.
- **Member design.** Beams, columns (biaxial), joints and strong-column/weak-beam; Annex A detailing; footings; NBC 205 eligibility.
- **Sizing.** Members are sized automatically by stepping up trials until every check passes.
- **Report.** An HTML report shows every step: formula, numbers and clause with PDF page.
- **This period's fixes.**
  - Very short bays are now reported as a layout issue instead of driving every member to 500 mm.
  - The Annex A 75 mm link-spacing floor was misapplied; it is now correct.
  - 4-legged links are allowed on wide beams.
  - Beams now join each column to the next one on its line.

### 3D viewer and colours (new)

- **8 outside schemes:** Kathmandu cream, Newari brick, white and maroon, warm ochre, sky blue, sage green, peach, modern grey and wood.
  - What is painted: walls, floor bands, window and door frames, glass, plinth, parapet and roof.
  - Columns are painted with the walls.
- **6 inside schemes:** off-white, warm beige, light grey, soft sage, pastel per room, and "Vaastu colour guidance".
  - The last one is labelled as common guidance, **not** from the supplied books (the library database isn't in this copy).
  - Every room's walls are painted, with door and window gaps left open.
- **"Look inside the chosen floor"** shows a dolls'-house view with the ceiling off.
- **"Compare all outside/inside colours"** renders the current house in every scheme as a clickable gallery. The choice is remembered in the browser.
- The preview of all schemes on the sample house is in `docs/handover/colour-schemes.png`.

### Earlier in this project (still in place)

- Vaastu-led zone-first room allocation, with puja/toilet/stair section checks.
- Rental floors with a shared outside stair, and ground parking variants.
- Opening schedule, A3 drawing set following the owner's sample drawings, sanitary and roof sheets, furniture.
- DXF export, the CAD-like plot sketcher, and the NBC 105 seismic configuration findings.

---

## 3. What is NOT done (honest limits)

- **No permit drawings.**
  - The plans are spatial hypotheses.
  - Municipal bylaws are reviewed only for Kathmandu, and even that profile still needs professional sign-off.
  - Every other municipality uses working assumptions.
- **Structural calculation is preliminary.**
  - It uses the D-value and tributary methods, not a 3D finite-element model.
  - IS 456 and IS 875 are not in the repo, so their values are marked "verify".
  - Slabs, stairs, the underground tank and retaining walls are not designed.
  - A licensed engineer must run a 3D model (ETABS/SAP/STAAD) and sign.
- **Very narrow buildings are structurally slender.** For example, a 4 m-wide, 3.5-storey house fails even with 500 mm columns. That is a real engineering signal, not a bug.
- **Two survey cases still get no plan:**
  - *7.5 m plot with 1 m side setbacks and a large program.* It works with 0 m shared-wall sides.
  - *Triangular plot.* Its usable rectangle is only 5.7 × 6 m.
- **Paint colours are visual only.** They are not yet carried into the drawing set or the DXF, and there are no paint-brand codes.
- **Doors and windows.** Door swings and hinge sides are indicative only. Windows on shared-wall (0 m) sides are flagged but not automatically moved.
- **Knowledge library.** It and the rule catalog's source PDFs aren't in this repo copy, so source search does not run here and one test is expected to fail.

---

## 4. Next steps (in recommended order)

### A. Get to a first real permit package (highest value)

1. **Pick one real parcel** in Kathmandu Metropolitan City: survey drawing (*naksa*), ward, road width, owner program.
2. **Confirm the KMC bylaw profile** with the municipality or a local architect: setbacks per road width, coverage, FAR, height, light plane, parking. Replace the working assumptions in `local/backend-keystone/lib/nepal/rules/profiles/kmc.json` and mark it reviewed.
3. **Engineer review.** A licensed structural engineer builds the 3D model from the DXF and the calculation report, compares the results, and signs. Feed any differences back into `lib/nepal/structural/`.
4. **Drawing set to municipal format.** Add the location plan, title-block fields the municipality requires, and the naksa-pass checklist.

### B. Planner improvements

5. **Narrow plots with large programs.** A two-row (double-loaded) floor layout, so 3 bedrooms fit on one narrow floor without a program variant.
6. **True irregular footprints.** Plans that follow an L-shaped or trapezoid plot instead of the inner rectangle (two-rectangle footprints already exist for L-shaped houses).
7. **Door swings.** Optimise hinge side and swing against furniture and columns.
8. **Windows on shared walls.** Move light to the front and rear walls or add a lightwell automatically.
9. **Other municipalities.** Add reviewed profiles for Lalitpur, Bhaktapur and Pokhara (each needs its own bylaw review).

### C. Engineering depth

10. **Slab design** (IS 456 Annex D two-way coefficients) and **stair design**.
11. **3D frame export** (ETABS/STAAD text) so the engineer starts from Keystone's geometry.
12. **Soil investigation input:** real Vs,30/NSPT and bearing capacity in the survey rather than the structural panel.
13. **Sanitary pipe sizing** once the engineer's method (NBC 208 / IS 2470) is chosen.

### D. Presentation

14. **Colours in drawings.** Carry the chosen paint scheme into rendered elevations and the drawing set, with paint-brand codes.
15. **Facade details.** Window grills, railings, chajja and a Newari window option in the 3D model.
16. **Export the 3D model** (glTF) for the owner to view on a phone.

---

## 5. What the owner (you) needs to provide / decide

| # | Item | Why |
|---|---|---|
| 1 | One real parcel: survey drawing (naksa), ward, road width, north evidence | Start the first permit package |
| 2 | A local architect and a licensed structural engineer (NEC registered) | Signatures, municipal submission, structural sign-off |
| 3 | Confirmation of KMC bylaw values (or a contact at the ward/municipality) | Replace working setbacks and coverage |
| 4 | Your favourite outside and inside colour schemes (see `docs/handover/colour-schemes.png`) | Default the studio and carry them into elevations |
| 5 | Whether "program variants" (moving rooms between floors, adding a floor) may be shown as first options, or only after the as-requested plans | Ranking policy |
| 6 | Copies of IS 456:2000 and IS 875 (or NBC 102/103) | Verify the member-design and load values the calculation uses |
| 7 | The original `Design Files/` folder (code PDFs and Vastu books) in the repo, if possible | Re-enable source search and the rule-source check |

---

## 6. Owner decisions recorded so far

- Balcony to living room: **closable glazing**.
- Setbacks vary **per municipality**, not per ward.
- Rental parking: give up a ground room, or the family balcony.
- Drawing standard: follow the owner's sample drawings (structural and architectural sheets, opening schedule).
- **Other municipalities: allowed with generic working assumptions** (2026-10-01).
- **Narrow-plot layouts: build them** (2026-10-01).
- **East-road entrance:** Keystone decides after inspection. The decision is entrance into living by default, plus a labelled "kitchen SE" alternative (2026-10-01).
- Vaastu is the highest design preference. Legal and safety constraints stay as gates, and conflicts are shown, never hidden (AGENTS.md).

---

## 7. Where things are (code map)

| Purpose | Path |
|---|---|
| Survey contract and checks | `local/backend-keystone/lib/nepal/normalizeBrief.js`, `preflight.js`, `briefSchema.json` |
| Road orientation, drawn plots, corner plots | `lib/nepal/plotFit.js` |
| Plan search, coverage fit, variants | `lib/nepal/candidateSearch.js`, `programVariants.js` |
| Stair core | `lib/nepal/corePlanner.js`, `stairProfile.js` |
| Room layouts (strip, compact flat, narrow, mid-stair, shallow) | `lib/nepal/roomPlanner.js` |
| Grid and footprints | `lib/nepal/frameGrid.js`, `siteEnvelope.js` |
| Drawing set, DXF, furniture, sanitary | `lib/nepal/drawingSet.js`, `dxfExport.js` + `scripts/export/build_nepal_dxf.py`, `furniture.js`, `sanitary.js` |
| Structural calculation | `lib/nepal/structural/` (`codeData.js`, `hazard.js`, `model.js`, `seismic.js`, `sections.js`, `members.js`, `index.js`, `report.js`) |
| Web API | `local/backend-keystone/api/nepal_concepts.js` (formats: review HTML, `json`, `drawings`, `dxf`, `structure`, `structure-json`) |
| Studio UI | `local/frontend-keystone/src/studio/NepalBrief.jsx`, `PlotSketcher.jsx`, `NepalModel3D.jsx`, `colourSchemes.js` |
| Survey case matrix tool | `local/tools/nepal-survey-matrix.cjs` |
| Method notes | `knowledge/STRUCTURAL-CALCULATION.md`, `knowledge/DRAWING-STANDARD.md`, `knowledge/DESIGN-PRINCIPLES.md` |

Rules for anyone continuing: read `AGENTS.md` first. Log every change in `EXECUTION-LOG.md`. Never claim the plans are permit- or construction-ready.
