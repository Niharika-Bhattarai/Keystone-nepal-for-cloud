# Keystone Nepal for Cloud (98 files)

A trimmed copy of `Keystone Nepal` for cloud work under a 100-file cap. The folder layout matches the original, so relative paths and `require()` calls still resolve.

## What is here
- **Docs (9):** README, AGENTS, EXECUTION-LOG, BACKEND-EXECUTION-PLAN, RESIDENTIAL-DESIGN-CONTRACT, POLYGON-SPATIAL-EXECUTION, WORKING-ASSUMPTIONS-AND-CALCULATIONS, NEPAL-SPATIAL-PLANNING-RESEARCH, local/LOCAL-DEVELOPMENT. Start with EXECUTION-LOG.md.
- **Knowledge (4):** DESIGN-PRINCIPLES.md, INTEGRATION.md, manifest.json, rules.json (the 93 rules).
- **Backend Nepal engine (`local/backend-keystone`):** all of `lib/nepal/` plus every shared module it imports (survey preflight, v2 support matrix, canonical room types, etc.), `api/nepal_concepts.js`, `api/plan_preflight.js` and package.json.
- **Tests (16):** 13 `nepal-*.test.js` files and 3 fixtures.
- **Python geometry worker (3):** `local/planner/` (Shapely study, its test, requirements).
- **Tools (5):** `run.cjs`, `local-env.cjs`, `backend-boundary.cjs`, `nepal-ten-plan-review.cjs`, `nepal-polygon-study.cjs`.
- **Frontend (6):** `NepalBrief.jsx` (the Nepal survey UI), `DesignGenerator.jsx` (where it is mounted), `data/survey.js`, `lib/planRequest.js`, package.json, index.html.

## Left out, still in the original repo
- The US engine (tile and v2 generators, renderers, accounts, estimate, 3D, Blender bake) and the rest of the frontend (about 65 files). The Nepal path does not import them, but the full web app can't build or run from this copy.
- `app.js` and `server.js`. They pull in accounts and other US modules. Use the tools and tests to exercise the Nepal engine.
- PDFs and books (`Design Files`, `Reference Drawings`), `knowledge/sources`, `assets`, `ocr`, `library.sqlite`, and generated runtime output.
- `node_modules`, so run `npm install` in `local/backend-keystone`.

## Known effect of the trimmed copy
`resolveRulePack.js` (`verifyCatalog`) checks two things. The first check hashes `knowledge/rules.json` and `knowledge/manifest.json` against the pins in `catalog.json`. The second hashes each original source file in `Design Files/` against the manifest's SHA-256.

The first check used to fail on every non-Windows checkout. The pins had been computed over CRLF bytes, and git stores these files with LF (`* text=auto`). The pins now hash line-ending-normalized text, so this check passes on Linux, macOS and Windows.

The second check still fails here because the PDFs and EPUBs are not in this trimmed copy. That is expected and not masked. It reports `RULE_SOURCE_DRIFT`, so `nepal-milestone-c` test "Kathmandu overlay is explicit and unreviewed…" fails. It is the only expected failure: in a verification run the other 54 of 55 Nepal tests passed.

The polygon-study tests also need Python Shapely. Without it, two more tests fail with "Polygon study unavailable". Install it with `pip install -r local/planner/requirements.txt`.

## Run
```
pip install -r local/planner/requirements.txt
cd local/backend-keystone && npm install
node --test test/nepal-*.test.js
```
