'use strict';
// Isolated maintenance entry, deliberately restricted to the demo emulator.
// Production scheduling/auth/storage integration must be reviewed separately.
const { emulatorConfig } = require('../lib/accounts/emulatorConfig');
const config = emulatorConfig();
const { Firestore } = require('@google-cloud/firestore');
const { FirestoreStore } = require('../lib/accounts/store');
const { resumeDeletion } = require('../lib/accounts/lifecycle');
const db = new Firestore(config);
(async () => {
  if (process.env.KEYSTONE_EMULATOR_FAKE_IDENTITY !== '1') throw new Error('This demo-only maintenance runner requires explicit fake-identity mode.');
  const store = new FirestoreStore(db);
  const jobs = await store.listPendingDeletions(20);
  let complete = 0;
  for (const job of jobs) if ((await resumeDeletion(store, job.uid, async () => {})).state === 'complete') complete++;
  console.log(JSON.stringify({ mode: 'demo-emulator', scanned: jobs.length, complete }));
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.terminate());
