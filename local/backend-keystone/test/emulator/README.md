# Isolated Firestore contracts

This folder is a test configuration, not deployment configuration. Use a Java 21
runtime and Firebase CLI 15.31.0 (the tested versions), then start from this folder:

```powershell
firebase emulators:start --only firestore --project demo-keystone-lifecycle --config firebase.json
```

From `backend-keystone` in another terminal:

```powershell
$env:KEYSTONE_EMULATOR_TEST = '1'
$env:GCLOUD_PROJECT = 'demo-keystone-lifecycle'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8187'
node --test test/emulator/project-contract.cjs test/emulator/billing-contract.cjs test/emulator/render-job-contract.cjs test/emulator/render-delivery-contract.cjs test/emulator/render-recovery-contract.cjs
```

The test guard rejects non-loopback hosts, production flags and populated external
credentials. The SDK is constructed only after the guard passes. Tests use unique
owner IDs; no emulator-wide delete endpoint is called. Stop the emulator when done.
The application server remains local/memory-only; these tests do not change it.

`project-contract.cjs` uses the actual Firestore SDK and emulator. It covers >1 MiB
UTF-8 snapshots, concurrent revision checks, retries, owner access, corruption,
legacy migration, server rollback, chunk deletion, delayed-create tombstones,
505-entry cleanup and cross-process deletion recovery. The maintenance runner
requires `KEYSTONE_EMULATOR_FAKE_IDENTITY=1`: identity deletion in that runner is an
explicit test double. It cannot run against a real Firebase project. Actual Firebase
Auth deletion and production scheduling are separate verification gates.

The emulator does not enforce production composite-index requirements. The required
owner/updatedAt index and payload index exemption are declared here for review;
they have not been deployed. Browser security rules deny all direct access because
the app accesses Firestore through its authenticated backend.

`billing-contract.cjs` runs the same credit contract as memory: duplicate events
and invoices, last-credit contention, one owner/job reservation, immutable ledger,
renewal refunds into extra credits, stale canonical-fetch conflicts, deletion
fences and cleanup. Additional real-server checks inject a failed commit after
all billing writes were queued, then retry; two accounts also race for one Stripe
customer binding. Stripe retrieval is an injected fixture, not a real payment.

`render-job-contract.cjs` checks atomic job/reservation creation, immutable chunked
inputs, exclusive claims, expired leases, stale-worker rejection, settlement,
bounded crash recovery and deletion fencing. It tests actual commit rollback at
creation and completion, and a separate fake worker process reading a >1 MiB
snapshot after the saved project is deleted. No real Blender/GCS job is launched.
The child explicitly requires `KEYSTONE_EMULATOR_FAKE_RENDER=1`; do not use its fake
manifest records as actual artifacts.

C4b adds quiescent attempt cleanup to the same contract: superseded attempts are
removed only after their write grace, the published attempt is kept while the
account exists, a live lease is never cleaned, and account deletion removes every
attempt, the job and its frozen input before the account data. A real-server
commit failure between storage removal and its record is repeated safely, and
two concurrent deletion workers agree. The artifact adapter in these contracts is
a recording double; physical local-folder and real Blender evidence is recorded
separately in the C4b handoff. Cloud Storage behavior is tested only against an
in-memory bucket double, never a real bucket.

`render-delivery-contract.cjs` (C4c) checks, on the real SDK:
- cursor paging of due jobs keeps single-scan order without repeats;
- a job behind owners being deleted is still discovered;
- two dispatchers racing launch once, and relaunch only after the retry delay;
- the owner listing is newest first and scoped;
- two notification deliverers racing send once;
- intents are purged with the account;
- a terminal job's notification intent exists only if its commit does (real
  rollback).

The emulator is shared by all contract files, so scans assert order and
presence against one large scan instead of assuming which jobs come first.
The `renderJobs` owner/createdAt and `notificationOutbox` status/nextAt indexes
are declared for review only.

`render-recovery-contract.cjs` (C4d) checks shared admission across distinct
unclaimed jobs, per-owner limits, delayed launch rejection, lease renewal,
capacity removal during both account cleanup paths, stale notification settlement,
bounded interrupted deliveries and deletion-fenced delivery. Injected real-server
commit failures prove the pool, job state and refund cannot partially commit.
The server-only `renderDispatchPools` collection requires no query index. All
schedulers for the same renderer fleet must use the same pool and limits; pools
in these tests are isolated to avoid unrelated fixture jobs consuming capacity.

Official references:
[emulator connection](https://firebase.google.com/docs/emulator-suite/connect_firestore),
[transactions](https://firebase.google.com/docs/firestore/manage-data/transactions),
[quotas](https://firebase.google.com/docs/firestore/quotas).
