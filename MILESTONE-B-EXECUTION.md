# Milestone B execution list

Date: 2026-09-30. Scope: isolated `Keystone Nepal/local` only. This is a local development site and must not contact the public Keystone service.

## Work list

- [x] Read Nepal design hierarchy and integration guidance; confirm copied baseline and test seams.
- [x] Define an explicit Nepal survey contract with metric/land units, site geometry, north evidence, municipality/ward, road, floor program, rental flats, owner household, parking, stair preference and Vaastu preference.
- [x] Normalize and validate units, site geometry and 2.5/3.5 storey level lists; reject ambiguity without inventing geometry.
- [x] Add Nepal preflight with structured missing/unsupported/invalid-input messages and ensure plan generation cannot fall through to the US generator.
- [x] Make local frontend creation, editing, 3D, exports and account gated controls usable without sign-in or paid credits; keep backend identity local only and outside production.
- [x] Add a usable local Nepal input path and show preflight limitations before generation.
- [x] Verify rectangular 2.5 storeys, surveyed irregular 3.5 storeys, two-rental-floor 3.5 storeys, ambiguous side lengths and unsupported input; verify existing US flow and local unauthenticated downloads.
- [x] Update this list and `EXECUTION-LOG.md` with exact results, risks and next work.

## Findings and decisions

- The existing generator is a US baseline. Milestone B must stop Nepal requests at preflight until later milestones implement Nepal legal, structural and Vaastu generation. Returning a US plan for a Nepal request would mislead a user.
- Local account bypass applies only to the independent loopback copy. It will not be a production authentication design.
- Government construction handbook gives 1 ropani = 5,476 sq ft = 16 aana; implemented using exact foot-to-metre conversion. Source: https://www.giwmscdnone.gov.np/media/app/public/54/posts/1711001516_6.pdf.
- Rental survey: each floor is marked owner/rental; each rental floor must contain bedroom, bathroom, living room and kitchen. Floor count and total households must agree. Rental access requires a continuous shared stair outside private units. Owner room/special-room counts are checked across its floors. Primary wardrobe defaults to standard; other wardrobes are opt-in.
- The user enters surveyed corners and side lengths for irregular sites. This v1 contract does not reconstruct an irregular plot from lengths alone. Geometry checks catch self-intersections, side disagreement and declared-area disagreement. The 20 mm side agreement and 2% area review tolerances are provisional input-quality thresholds, not Nepal legal standards.
- `briefSchema.json` documents the JSON shape; `normalizeBrief.js` owns cross-field and geometric checks. The local UI stores its draft in browser storage, while API projects are in memory and reset on restart.

## Verification record

- Focused Nepal tests: 8/8 pass. Local isolation tests: 4/4 pass. Frontend production bundle through the isolated launcher: passes; inherited large-bundle warning remains.
- Headless Edge local Studio smoke: opened without sign-in, showed missing ward/north evidence, accepted completed brief, revealed rental controls, switched to existing engine; zero runtime errors and zero remote requests observed.
- API without credentials: `/api/me` returns fixed local identity with downloads enabled; all three complete Nepal fixtures preflight as contract-ready but return `NEPAL_GENERATOR_PENDING`; `/api/plan` returns 422 before trying candidates. Ambiguous irregular plot returns `POLYGON_COORDINATES_REQUIRED`. Saved project POST returns 201. Existing US generation returns 200 with a plan and two alternatives; no elevation lock. 3D GLB, DXF and XLSX exports return 200 without a token.
- Direct DXF export reopened with `ezdxf`: AC1024, zero audit errors/fixes. A selected inherited test run had 20 passes and one obsolete smoke failure: `test/dxf-export-smoke.test.js` still reads `local/frontend/app.jsx`, an old frontend that is not the active copied website. The live `/api/plan/dxf` path is covered by the direct smoke above. Repair/retire that stale test before claiming the full inherited suite passes.
- The complete inherited backend suite was previously interrupted in its large consistency matrix and remains an explicit test gate for later work. No full-suite pass is claimed.

## Milestone B result

Survey/preflight and local account-free testing are complete. Nepal generation remains unavailable until municipal rule, site envelope, structure, stair and Vaastu phases are implemented. “Survey inputs complete” means the data contract is sufficient to continue engineering; it is not a compliance or permit-readiness finding.

## Remaining after B

Milestone C: municipality-specific reviewed rule pack and area ledger. Later milestones: structural grid, stacked stair/core, Vaastu-driven plan generation, coordination and export validation. See `BACKEND-EXECUTION-PLAN.md`.
