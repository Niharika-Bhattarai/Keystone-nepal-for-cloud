# Keystone Nepal — one-month transition plan

Prepared 2026-09-30. Status: research library, independent local application and Nepal survey/preflight (Milestone B) ready; C-F geometry foundations and tests added, with critical professional/physical validation gates still open. Nepal plan generation remains blocked. No deployment or changes to the main application.

## Local application and next implementation

The active frontend, backend, generator and assets are copied into [local](local/LOCAL-DEVELOPMENT.md), with separate dependencies and local-only startup. From `Keystone Nepal/local`, run `npm run dev`, then open http://127.0.0.1:5299. Available local work needs no sign-in; remote services are disabled.

Follow [the detailed backend execution plan](BACKEND-EXECUTION-PLAN.md) for implementation order, exact integration files, tests and acceptance gates. [Milestone B execution](MILESTONE-B-EXECUTION.md) records the finished contract; [C-F execution](C-TO-F-EXECUTION.md) records implemented foundations and unpassed gates. The shortened Nepal survey uses a rectangular plot while house footprints may be stepped or courtyard-shaped. It still stops before generation while local rules and construction geometry remain unverified.

Update: the [local design knowledge library](knowledge/README.md) now converts the supplied codes/books to Markdown, provides source retrieval and 93 rules, and includes tested fact/area-accounting utilities. Production generation remains unchanged.

## Agreed destination

Serve residential clients in Kathmandu Valley and Pokhara Valley. The first-month deliverable is **permit-submission drawings for one municipality**, as requested by the owner, alongside a reusable Nepal design workflow.

Planning assumption: **Kathmandu Metropolitan City (KMC)** is the first submission municipality; Pokhara Metropolitan City is the second validation jurisdiction. Kathmandu Valley is not one municipality. Confirm the actual ward, parcel and municipality before starting the delivery clock. Switching the first submission to Pokhara is possible, but requires its own verified rules and submission checklist.

The realistic month-one promise is **one real, locally reviewed project package**, supported by a constrained generator. It is not universal Nepal coverage, guaranteed municipal approval, or automatic structural certification. A qualified local design team must own the engineering, review and submission. Permit approval timelines are outside this software schedule.

## Read in this order

1. [Research and decisions](01-research-and-decisions.md): evidence, corrections to initial assumptions, jurisdiction boundaries and unresolved questions.
2. [What the owner needs to provide](02-inputs-and-team.md): documents, sample projects, professionals, deadlines and minimum starting package.
3. [Thirty-day execution plan](03-thirty-day-plan.md): daily tasks, owners, dependencies, deliverables and stop/go gates.
4. [Engineering implementation specification](04-engineering-specification.md): repository seams, proposed files, geometry and rule contracts.
5. [MEP roadmap](05-mep-roadmap.md): Nepal month-one deliverables and shared US extension.
6. [Verification and permit release](06-verification-and-release.md): fixture matrix, reporting, drawing sheets and acceptance criteria.
7. [Research sources](07-source-register.md): primary references and explicit verification limits.
8. [Execution log](EXECUTION-LOG.md): what was done, learned and what the next agent should do.

## Four-week outcome

| Period | Outcome | Gate |
|---|---|---|
| Days 1–7 | Real site, local team, rule register, approved pilot brief, architectural and engineering workflow | Municipality and applicable rules confirmed; required site inputs available |
| Days 8–14 | Metric site-aware, multi-level generation with RC grid reservations, stairs, Vaastu and light checks | Three meaningfully distinct options for each declared supported positive fixture; architecture review |
| Days 15–21 | Selected pilot coordinated with engineer's structure and MEP; consistent plan/section/elevation/3D; draft submission sheets | No unresolved critical conflicts; structural analysis and drawings supplied/reviewed |
| Days 22–30 | Independent checks, CAD/PDF package, corrections, issue register and pilot release | Local professionals authorize the specific revision for submission |

## Important corrections

- Do not encode 70% coverage, zero side setbacks, or parking exemptions as nationwide defaults. They are unverified for the pilot parcel.
- NBC 105:2025 is listed by DUDBC; NBC 206:2024 is also listed. Confirm the applicable editions locally before implementing numerical rules. See [research sources](07-source-register.md).
- Earthquake design is not one safety-factor multiplier. Room planning, frame configuration, site conditions and engineered detailing must work together.
- A 3.5-storey house needs an explicit partial fourth level, its load path and roof geometry. Do not multiply a typical floor by 3.5.
- Vaastu is a customer requirement with an agreed reference and conflict policy. It cannot override mandatory life-safety or site rules.
- Retain the US product. Nepal work belongs in isolated development, with explicit jurisdiction selection and regression proof before any shared change ships.

## Start here

Provide one actual pilot site, its measured survey and applicable municipal documents; appoint the local architect and structural engineer; provide at least one approved complete drawing set. A Vaastu book and representative local homes will help turn preferences into testable design rules. Full details and priorities are in [the input checklist](02-inputs-and-team.md).
