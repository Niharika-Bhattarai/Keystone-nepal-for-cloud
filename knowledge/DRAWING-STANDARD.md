# Keystone Nepal drawing standard

Version 0.1, 2026-10-01. This is derived from the owner-supplied samples in `example of drawings/`. They are reference data, not templates to copy. The PDFs were read page by page. The two `.dwg` files and the `.bak` (AutoCAD backup) cannot be opened in this environment and were not reviewed.

## 1. What the samples contain

| Sample | Type | Sheets | What it teaches |
|---|---|---|---|
| *Municipal Drawing of Manita Kafle* (A1, 3 pages) | Municipal permit set | S-1/2: architecture; S-2/2: structure (page 3 repeats it) | Exactly what a Nepali municipality receives on one A1: see §2 and §3. |
| *Structural Design Report of Manita Kafle* (A4, 60 pages) | Engineer's report | – | Sections: introduction and project data, basic data (loads), codes, software (ETABS 2018), concrete/steel grade, preliminary sizing, loads, limit-state design, analysis, column–beam capacity ratio, member design, detailing, annex. |
| *2.3.2021 Jivendra Residence* (A3, 8 pages) | Architectural set | AR-00 site, AR-01 to AR-03 floor plans, AR-04 roof, AR-05 and AR-06 elevations, AR-07 section and opening schedule | Sheet-per-drawing A3 presentation; furnished plans; opening schedule with sill heights. |
| *newplans.pdf* (A3, 11 pages) | Architectural set | Site, basement–top plans, elevations, roof plan with opening schedule, section | The same sequence; the opening schedule may share the roof-plan sheet. |
| *sabitra tiwari* (A4, 15 pages) | Client options | Option I/II/III × basement–third floor plans | Present **design options** with the option number in the title block. |
| *COMPLILED PDF 2.5.2020* (A4, 4 pages) | Client set | Site and plans, **sanitary drawings** | Sanitary layout is its own sheet. |
| *MADHAVKC RESIDENCE* (A1, 4 pages) | Architecture and structure | P1 plans, elevations, location; P2 column layout, footing layout, column reinforcement, general notes 1–18; P3 beam layouts per level and beam elevations; P4 lintel/sill band elevations, lapping notes | Structural sheets split by element; numbered general notes. |
| *FEB 3.pdf* (A4, 1 page) | Single sheet | – | – |

## 2. Architectural drawing requirements

**Sheet set** (one A3 sheet each, or combined on one A1 municipal sheet):

1. **Site plan:**
   - plot boundary with dimensions and setbacks;
   - road names and widths ("20 FEET WIDE ROAD");
   - the building outline, hatched;
   - septic tank and soak pit;
   - north.
2. **Area triangulation table:** SN, description, area. Plot area in sq ft and m², and in ropani-aana-paisa-daam (for example "125.19 SQ.M. (0-3-3-3)").
3. **Location plan (not to scale):** nearby landmarks and the route to the site.
4. **Floor plans** (every level, including roof):
   - grid bubbles: letters along one axis, numbers along the other;
   - chain dimensions (opening / wall / opening) plus an overall dimension on all four sides;
   - room name with size ("BEDROOM 14'-0" X 14'-0"");
   - door and window tags (D1, D2, W1, W2', DW1, MD);
   - stair with UP arrow and riser lines;
   - section line X-X;
   - furniture and sanitary fittings;
   - **floor area** under the title ("GROUND FLOOR PLAN, AREA: 850 SQ. FT").
5. **Elevations:** all four (North/South/East/West), with opening tags and level lines.
6. **Section X-X**, cut through the stair, with level tags:
   - ground level and plinth level ±0'-0";
   - sill and lintel levels per floor;
   - floor levels;
   - parapet level.
7. **Opening schedule:** S.N, tag/description, width, height (or W × H), number, sill height. A note on stair windows.
8. **Roof plan:** slopes or terrace finish, parapet, water tank, stair cover.
9. **Sanitary drawings** (separate sheet): fixtures, stack positions, routes to septic tank, soak pit and sewer.

**Units:** architectural sheets use feet-inches. Structural sheets use millimetres, with feet-inches where noted. Every sheet repeats the governing unit note.

**Title block:**
- *A1 municipal* (right-hand column): "FOR OFFICIAL USE ONLY" box; north rose; owner and signature; building type; location (municipality and ward no.); plot no.; area; details (e.g. "STRUCTURAL DRAWING"); drawn by; checked by; date; scale; NEC registration no.; sheet no. (S-1/2).
- *A3 architectural* (bottom strip): firm and address; project; drawing type ("ARCHITECTURAL DRAWING"); option no.; architect; drawn by; date; scale (1:75); sheet no. (AR-01).

## 3. Structural drawing requirements

**Sheets:**
- column and plinth beam plan;
- floor beam plan, per level;
- foundation and trench plan: isolated footings F1–F4 and strap beams;
- slab plans and slab sections X-X / Y-Y;
- column detail table: floor, size, column type, longitudinal bars, lateral ties, tie shape;
- footing table: type, size, depth, reinforcement in X and Y, soil bearing capacity;
- longitudinal section of a typical column;
- details for:
  - sill and lintel bands;
  - parapet;
  - septic tank and soak pit;
  - beam lapping.

**Numbered general notes,** as seen in the samples:
- do not scale;
- read with the architectural drawings;
- units;
- concrete grade (M20; M25 for columns in one sample);
- steel Fe 500 TMT;
- clear covers: slab 15, beam 25, column 40, foundation 50–75 mm;
- development and lap length table;
- column splices only at mid-height;
- beam splices away from connecting spans;
- 25 mm clear between bar layers;
- shear reinforcement at 100 mm c/c at laps;
- the contractor submits a bar bending schedule;
- discrepancies are referred to the engineer.

**Who designs it:** member sizes and reinforcement come from the engineer's analysis (ETABS to NBC 105, IS 456, IS 13920 ductile detailing, SP 16). The sample report records:
- soil type and seismic zone;
- assumed bearing capacity (130 kN/m²);
- live loads: 2 kN/m² rooms; 3 kN/m² stairs, corridors and storage; 1.5 kN/m² terrace;
- finish load 1 kN/m²;
- brick density 18.85 kN/m³.

## 4. What Keystone produces, and what stays with professionals

Keystone produces **review drawings**:
- architectural plans with grids, chain dimensions, room sizes, opening tags and floor areas;
- an opening schedule derived from the engine's reserved openings;
- a structural **layout** sheet: grid, column IDs, a beam layout on the column lines, and **preliminary** sizes using the report's thumb rules:
  - beam depth about 25 mm per 300 mm of span;
  - slab effective depth = shorter span / (26 × MF);
  - minimum column size from the selected profile.

Every sheet carries a "for review, not for construction or permit" status and the professional-review list.

**Must stay with licensed professionals** (owner acknowledged 2026-10-01):
- municipal bylaw adoption: setbacks vary by **municipality**, not ward; to be added later;
- structural analysis and reinforcement design: footing sizes, bar schedules, column and beam reinforcement, soil investigation, and soft-storey/torsion checks;
- stair headroom;
- door swings and egress;
- daylight legality;
- balcony guards and drainage;
- reservoir and tank engineering;
- sanitary design: pipe sizes, falls, septic tank and soak pit;
- NEC-registered signatures.

Keystone never fills a signature, NEC number or "checked by" field.
