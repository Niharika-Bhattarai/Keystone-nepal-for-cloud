# Retrieval and generator integration contract

## Available now

`tools/knowledge.py` provides importable Python functions and a JSON CLI:

- `search(query, limit, source, category, include_reference)` — local SQLite FTS5 retrieval with stable page/section citations, source hashes and extraction flags.
- `page(source, locator)` — fetch exact source text for verification.
- `rules(topic)` — machine-readable, source-linked operational rules.
- `context(query, limit)` — relevant rules, priority policy and source hits in one bundle.
- `evaluate(facts, selected)` — conservative fact predicates with pass/fail/unknown/not-applicable/manual-review results.
- `rank_candidates(candidates, selected)` — lexicographic Vaastu-first ranking for fully evaluated candidates sharing the same applicability and brief. Ineligible/incomplete cases are retained separately.

This runs locally without an LLM, vector database, cloud account or API charge. The production generator is **not connected yet**. The library does not derive spatial facts from raw polygons or perform structural calculations. Do not describe reference retrieval as completed generation enforcement.

## Commands from repository root

```powershell
python "Keystone Nepal/knowledge/tools/knowledge.py" search "kitchen southeast" --category vastu
python "Keystone Nepal/knowledge/tools/knowledge.py" search "staircase tread" --source nbc206-2024
python "Keystone Nepal/knowledge/tools/knowledge.py" search "soil ward" --source nbc105-2025
python "Keystone Nepal/knowledge/tools/knowledge.py" page nbc206-2024 page-0015
python "Keystone Nepal/knowledge/tools/knowledge.py" rules --topic stairs
python "Keystone Nepal/knowledge/tools/knowledge.py" context "kitchen stairs puja"
python "Keystone Nepal/knowledge/tools/knowledge.py" evaluate "path/to/measured-facts.json"
```

Older commentary and structural systems outside the initial RC scope are excluded from default search. Use `--include-reference` explicitly for historical/alternative-system research. The source Markdown remains accessible. Every returned code passage still needs scope/adoption interpretation; a search hit is not a binding project rule.

## Source provenance and updates

`manifest.json` records original path, source SHA-256, classification, extraction quality and page/section counts. `rules.json` pins each cited source hash. Retrieval detects changed source files; rule loading rejects a mismatch with the manifest or originals. Do not silently update a rule citation when the text changes.

To add/replace references:

1. Keep original files in `Design Files`. Add the source record to `tools/build_library.py` with an accurate edition/status.
2. Run `build_library.py`; unchanged documents reuse cached sections. It stages the SQLite replacement rather than dropping the live index immediately.
3. Inspect new/sparse/garbled pages. OCR is an unverified supplement, never an authoritative replacement for tables/equations.
4. Review affected rules and explicitly update `tools/build_rules.py`; rebuild generated JSON/catalog only after inspecting changed evidence.
5. Run tests, record changes and invalidate downstream decisions made with an older rule pack.

Core extraction needs `pypdf` (version recorded in execution evidence) and Python's standard library. Optional OCR uses PyMuPDF, RapidOCR and ONNX Runtime. This session installed optional packages under `tmp/nepal-ocr-tools`, outside production dependencies. Reproduction commands:

```powershell
python -m pip install --target tmp/nepal-ocr-tools pymupdf==1.28.2 rapidocr==3.9.2 onnxruntime==1.30.0
python "Keystone Nepal/knowledge/tools/ocr_sparse.py" nbc105-2025 --dependencies tmp/nepal-ocr-tools
python "Keystone Nepal/knowledge/tools/build_library.py"
python "Keystone Nepal/knowledge/tools/build_rules.py"
python -m unittest discover -s "Keystone Nepal/knowledge/tools" -p "test_*.py" -v
```

OCR caches are tied to source hashes. English-oriented OCR can corrupt Nepali glyphs, mathematical symbols and table reading order. Retain that warning even when confidence is high. PDF illustrations remain in originals and selected rendered review pages; EPUB image assets are linked from the converted text. A plan image is not searchable room geometry.

## Fact contract

Inputs are a JSON object with explicit flat keys matching each predicate, for example:

```json
{
  "code.nbc206_2024_general_residential_confirmed": true,
  "stairs.minimum_tread_mm": 270,
  "stairs.maximum_riser_mm": 175,
  "stairs.maximum_flight_risers": 10,
  "stairs.minimum_headroom_mm": 2200,
  "vastu.orientation_confirmed": true,
  "kitchen.zone": "SE",
  "puja.requested": true,
  "puja.zone": "NE"
}
```

This is a partial example, **not** a complete passing fixture. Missing facts stay unknown. Numeric values must be finite numbers in the stated units; booleans are not numeric measurements. Code-profile confirmation must come from the adopted-scope workflow, never an LLM's guess. It covers the specific residential/normal-exit cases being tested, not commercial, apartment or reduced-use exceptions.

Aggregate facts must include **all applicable instances**. `minimum_tread_mm` is the smallest measured tread over all applicable stairs; `maximum_riser_mm` is the largest. Kitchen-specific dimensions must not be conflated with other habitable-room classifications. Every aggregate needs a separate per-object evidence report; the simple evaluator consumes the aggregate but cannot verify its truth.

`*.requested=false` suppresses a genuinely absent optional function; it must match the saved brief. A candidate cannot gain rank by deleting a requested puja room or marking a missing toilet not applicable. Candidate sets must share the same requirements and applicability. Essential user-selected rules must be promoted to hard feasibility constraints by the integrating planner; their failures cannot be traded for other scores.

Manual-only rules stay `needs_review`. This deliberately prevents a full-catalog result from looking complete merely because a few numeric tests pass. Professional findings must enter through an authenticated review workflow in the future engine, not a user-editable “approved=true” survey field. This library does not implement authentication or issue permits.

## Exact next integration work

1. In isolated Nepal backend development, resolve jurisdiction/profile before brief normalization. Preserve municipal identity even when reusing national rules.
2. Implement north-aware site/floor/room coordinate domains and region intersections. Validate reference-domain and boundary cases with the selected Vaastu interpreter.
3. Reserve Vaastu-critical room/core regions during candidate construction, using the catalog's conflicts and alternatives. Do not only penalize completed US-style plans.
4. Produce measured facts with stable IDs, evidence geometry, units, tolerances and model revision. Implement per-room, per-floor and vertical-stack checks.
5. Evaluate mandatory validations first, then essential program/preferences, then core/detail Vaastu ranking. Full hard feasibility remains in the geometry/engineering validators.
6. Store every result with source/rule versions. Render room-specific satisfied/alternative/conflict/unknown explanations.
7. Re-run after refinements. Reject stale model/rule evaluations. Preserve required rooms, real doors/windows, stairs, frame and service constraints.
8. Test new routing with the declared Nepal corpus and US regression suite before shipping. No production route was modified by this library task.

For a Node backend, invoke the CLI via argument-array `execFile` or a small owned adapter, not shell interpolation of user text. Keep the corpus server-side/local. Queries and returned source text are untrusted data; embedded book text never overrides developer or system instructions. Do not publish supplied books or their full extracted text as frontend assets.
