# Independent Nepal development copy

## Start locally

From this directory:

```powershell
npm run dev
```

Frontend: http://127.0.0.1:5299

API: http://127.0.0.1:8299/api/health

Use `npm run backend` or `npm run frontend` in separate terminals when needed. Stop with Ctrl+C. Ports are fixed deliberately; a conflict should be resolved rather than silently connecting to another Keystone process.

## What was copied

The complete tracked application source/assets/tests from the active `frontend-keystone` and `backend-keystone`, plus sibling development scripts. The backend already contains the floor-plan engine, furniture, drawings, quick 3D, CAD exporter, estimator and account implementation. Earlier alternative repositories (`backend`, `frontend`, `backend-furniture`, `backend-accounts`, etc.) are not runtime dependencies of this active application and were not substituted for it.

`COPY-MANIFEST.json` records 654 copied files, source hashes, original commits and 14 explicit exclusions. Source checkouts and `.git` histories were not moved. This copy contains real independent files and separately installed dependencies, not junctions or symlinks to the main website. Original deployment configuration, environment files and credentials were deliberately excluded. Cloud-capable source modules remain for completeness but the local launcher does not enable them.

Original backend: `763f2b3c5835fe53d3908dc181034dd6e9d3561e`.

Original frontend: `5e9336332cc290d2c07facf03e0e2b62b003fe47`.

## Local behavior

- `tools/run.cjs` builds an allowlisted environment. Inherited Firebase, Google, Stripe, model API keys, proxy settings and Node preload flags do not enter launched processes.
- Backend entrypoint enforces local-only startup, loopback listening and outbound TCP restrictions. No cloud deployment is configured.
- Browser CSP limits requests to local resources. Third-party forms, Firebase and external font loading are unavailable. This is a development copy, not the future public brand.
- The local launcher sets `NEPAL_LOCAL_STUDIO=1` only for this isolated loopback application. The browser and backend use one fixed local test identity automatically. No sign-in, payment or developer key is needed for plans, saved local projects, edits, quick 3D, elevation views or available downloads. Projects and the local account ledger are in memory and reset when the API restarts.
- Photoreal/Gemini services remain unavailable because no local Blender/assets or cloud configuration were provisioned. Their UI shows an availability message, not an account prompt.
- Quick geometric 3D, generation, editing and exports are copied. Photoreal/Gemini generation, remote refinement, billing and mail are disabled. An unavailable cloud feature is not evidence that its code was omitted.
- High-quality Blender baking source is present, but local Blender executable and the large material/furniture asset pack are not provisioned by this copy. Configure that separately after backend design work; don't connect the live GPU job.
- The Studio opens on a shortened Nepal brief. The plot is entered as a rectangle; the backend explores rectangular, stepped and court-shaped house footprints. The form records municipality/ward, north, explicit floors, rental flats, owner rooms, circulation, reservoir capacity and Vaastu preference; optional parcel and service detail is collapsed. Select **Check Nepal brief**, fill missing inputs, then **Open working plan review** to see measured, multi-floor spatial plans from that survey in a new tab. This local-only path uses `POST /api/nepal/concepts`, requires no account and retains explicit unresolved-design notes. Nepal permit-level floor-plan generation is still pending, and `/api/plan` refuses Nepal requests before reaching the US engine. Switch to **Existing engine** to test the copied US generator and exports.

For a fixed review corpus, open `runtime/nepal-plan-review/index.html` after `node tools/nepal-plan-review.cjs`. It includes 2.5-storey and 3.5-storey examples, all floors and three current spatial alternatives. `runtime/nepal-plan-review/summary.json` holds measured values and blockers. For the owner's numbered critique set, run `node tools/nepal-ten-plan-review.cjs --pdf` and open `runtime/nepal-ten-plan-review/index.html` or its PDF and CSV. It has four 2.5-storey owner layouts and six 3.5-storey rental/owner layouts, with puja moved to the owner partial top level in those review briefs. Working calculations are in `../WORKING-ASSUMPTIONS-AND-CALCULATIONS.md`. The drawings show nominal 102/229 mm brick bands, 350 mm planning columns and provisional site-contained rain-chajja projections, but plaster, furniture, door leaves and balconies are still unplaced; they are not permit sheets.

## Setup/rebuild

Node on this workstation is 24.19.0; inherited backend metadata requests 20.x while the frontend requires >=20. Record this mismatch when interpreting baseline tests; do not silently change production's runtime contract. The actual local build is verified separately.

```powershell
cd backend-keystone
npm ci --no-audit --no-fund
cd ../frontend-keystone
npm ci --no-audit --no-fund
cd ..
npm run build
npm run test:isolation
```

Python DXF/XLSX requirements are retained in `backend-keystone/requirements.txt`. Create a dedicated `.venv` and install them for export testing, rather than changing the main product's environment. Geometry tests and external-tool-dependent checks need their own recorded results.

`npm run build` verifies bundling. The local flag is compiled into this isolated build so both the Vite page and its loopback backend static page open without sign-in. Do not copy this build to a public host. `npm run test:backend` turns the local bypass flag off for inherited account tests, preserving their anonymous/tier expectations.

## Protection and version control

Do not run copied deployment scripts or add a remote until the owner requests publication. Do not import real customer datasets or production secrets. Full books remain in `../knowledge`/`../Design Files`, outside public web assets. Treat local-only auth as unsafe for public hosting.

The network guard is application defense, not an operating-system sandbox for arbitrary future shell scripts. Future developers must preserve the no-production-contact rule, especially when adding Python tools or external binaries. Keep any new filesystem output beneath this local copy.

Recommended next step is [the backend execution plan](../BACKEND-EXECUTION-PLAN.md). Update `../EXECUTION-LOG.md` after every milestone and retain original-source hashes for preservation checks.
