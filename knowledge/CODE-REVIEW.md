# Code/reference review and unresolved interpretation

Reviewed 2026-09-30. All page numbers below are **physical PDF pages**. Numeric checks here were read from extracted text and selected original-page images, not professionally approved for a project. Follow source citations in the rule catalog.

## NBC 105:2025

The supplied `NBC 2025.pdf` identifies NBC 105:2025, second revision. Pages 1–13 and some other pages lack useful embedded text; local OCR supplements are preserved as unverified. Cover and revision preface were visually inspected. Main text is searchable by page.

Reviewed topics: site/soil sections and ward-specific table (pages 44–46), irregularities (55–57), drift/separation (58–59), nonstructural components (71–74) and RC/infill scope (75). Table 4-3 on physical page 46 was inspected visually: it distinguishes municipalities and wards, so a universal Kathmandu Valley soil assumption is incorrect. A `Nil` entry is not evidence that the site is safe or rock.

The source contains cross-reference numbering that needs care: some passages refer to irregularity clauses as 5.5 although the displayed irregularity heading is 5.4; map references also require checking. Preserve heading, page and exact document edition rather than silently “correcting” it. No earthquake force coefficients, reinforcement design or approval automation has been implemented here.

Older `nbc105-commentary-draft` explicitly identifies draft commentary and remains excluded from default retrieval. Current code and old commentary are not interchangeable.

## NBC 205:2024

Pages 15–18 clarify that “without masonry infill” refers to not relying on masonry contribution to vertical/seismic resistance in the stated frame design; the document also describes brickwork. Earlier planning cautions about scope still apply, but should not be misread as a prohibition of every brick wall.

Page 16 was visually checked. The ready-to-use route limits height/storeys and allows a specifically limited additional smaller level within the height cap; it is not blanket permission for any 3.5-storey house. Eligibility is conjunctive: bays, plan proportions, member continuity, area, storey heights, projections and other restrictions all matter. The guideline was based on NBC 105:2020; its use alongside the 2025 revision requires the engineer's confirmation.

## NBC 206:2024

Original pages 14–17 were visually checked against extraction. They include occupancy-dependent route width, residential stair tread/riser/headroom values, room dimensions and light/ventilation provisions. Rules C01–C17 preserve scope rather than replacing the whole code with a few minima.

Important extraction/interpretation limits:

- Use primary metric values; inch equivalents in brackets are rounded and should not be treated as exact conversions.
- Table 3 capacity and occupancy conditions govern exit width, not only its minimum-width column.
- Section 3.3's example opening dimensions do not consistently match the stated area fractions. For a 4×4m room, 1/10 is 1.6m², whereas its displayed 1.0×1.5m example is 1.5m². Do not copy example sizes instead of computing the reviewed rule.
- Kitchen general-region fractions and the “25% more” wording need interpretation before coding one exact formula.
- A 3×3m internal daylight court requirement is distinct from a service shaft. Confirm classification and exceptions.
- Kitchen-specific dimensions and general habitable-room dimensions need correct classification; don't blindly apply a general minimum to erase the specific kitchen provision.
- Page 5 ties FAR accounting to local bylaws. This source alone does not resolve all local exemptions.

## Building By-laws and Permit System resource book, June 2023

This is the supplied MoFAGA/PLGSP reference book with GIZ support. It contains explanations, model-rule tables, historical legal material and permit guidance. Its identity is a **reference book**, not a newly enacted universal local bylaw. It is now fully page-indexed; the floor-area/coverage chapters, definitions and permit workflow were specifically reviewed. Not every appendix clause has been independently verified against current enactments.

### Reviewed calculation rules

| Topic | Source pages | Operational treatment |
|---|---|---|
| FAR formula | 15, 51–52 | Sum applicable counted floor areas / applicable plot area; dimensionless ratio |
| Ground coverage formula | 15, 54 | Counted ground footprint / applicable plot area ×100; percentage |
| Floor measurement | 15–16 | Distinguish external/gross floor boundary from carpet/usable room area |
| Residential plot-size threshold | 54 | Candidate 70% up to 250m²; 60% above. Test boundary exactly; confirm applicable local instrument |
| Other occupancy/model tables | 54–55 | Keep occupancy and source context; do not transpose institutional/commercial limits |
| Setbacks/ROW/projections | 16, 56–57 | Independent geometric constraints; legal area allowance alone does not establish buildable envelope |
| Height/light plane/FAR | 60 | Simultaneous constraints, with source-specific definitions |
| Permit stages | 125–127 | Designer, technical and field checks, then staged issue; not automatic approval from generated files |

### Material contradictions and scope differences

**Physical page 15 (printed 3):** definition excludes floors wholly below ground, includes balconies/loggias and excludes vehicle-parking/loading area from floor area.

**Physical page 52 (printed 40):** example includes basement floors and excludes balconies, terraces and staircases.

Both passages were visually checked. This is a genuine source conflict, not just extraction error. Neither is silently chosen as the rule for all projects. Resolve the adopted local definition and maintain a per-component inclusion ledger. Parking exclusion from floor area does not itself exempt a roofed garage from ground coverage.

**Physical pages 51–52:** KMC FAR 2.5 is given as an example while a model-bylaw table gives residential FAR 1.75. These refer to different contexts. Do not select a single value without the current local rule.

**Physical pages 54–55:** size-sensitive coverage discussion and a separate model table coexist. Preserve the size threshold and source instrument. Height, river/lake and building-category summaries elsewhere also require current local/legal verification before numerical enforcement.

### Implemented arithmetic

`tools/area_accounting.py` computes separate FAR/coverage results from an explicit measured-area ledger. It requires a source basis for include/exclude decisions. Unknown treatment stays unknown. It tests the resource's residential threshold as a labeled candidate; it does not declare local adoption.

Each area atom must represent a non-overlapping measured piece for each relevant metric/level. The upstream geometry adapter must union projected footprints and partition overlapping slabs, members, stairs, parking and voids. This arithmetic utility does not implement polygon union. Duplicate IDs are rejected, but different IDs with spatial overlap still require upstream validation.

Example under **hypothetical confirmed** local rules: 100m² plot; ground 60m²; first 60m²; partial top 25m² → FAR 1.45 and ground coverage 60%. A separate roofed parking atom can be excluded from FAR but included in coverage if the adopted rules say so. These are test examples, not a permit design.

## Remaining source-quality work

English text was extracted from every supplied PDF/EPUB; legacy Nepali fonts, complex figures and scanned sections can remain incomplete. Critical pages rendered under `review/` provide an audit trail. Do not equate “converted” with every diagram semantically understood. Use the manifest's flags, original PDFs and local professional review for exact clauses, equations and tables before engine enforcement.
