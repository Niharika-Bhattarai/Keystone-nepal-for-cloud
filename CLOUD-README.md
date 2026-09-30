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
`resolveRulePack.js` checks the original source PDFs by hash. Without them it reports `RULE_SOURCE_DRIFT`. That makes `nepal-milestone-c` test "Kathmandu overlay is explicit and unreviewed…" fail, and it is expected. The other Nepal tests passed in a verification run.

## Run
```
cd local/backend-keystone && npm install
node --test test/nepal-*.test.js
```
