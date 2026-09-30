'use strict';
// Test child process only. Never a production worker or a real rendered artifact.
const { emulatorConfig } = require('../../lib/accounts/emulatorConfig');
const config = emulatorConfig();
if (process.env.KEYSTONE_EMULATOR_FAKE_RENDER !== '1') throw new Error('Explicit fake render mode required');
const { Firestore } = require('@google-cloud/firestore');
const { FirestoreStore } = require('../../lib/accounts/store');
const { RenderJobs } = require('../../lib/accounts/renderJobs');
const { runOwnedRender } = require('../../lib/model3d/hq/ownedWorker');
const { files } = require('../helpers/render-job-contract.cjs');
const db = new Firestore(config), jobs = new RenderJobs(new FirestoreStore(db));
runOwnedRender({ jobs, uid: process.argv[2], id: process.argv[3],
  bake: async () => ({ files: files.map(f => f.name) }),
  artifacts: { inspect: async (id, name) => files.find(f => f.name === name) },
}).then(result => console.log(JSON.stringify({ mode: 'demo-fake-render', result })))
  .catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.terminate());
