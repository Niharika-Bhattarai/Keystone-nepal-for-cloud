'use strict';
// C7: the app compresses what it serves (the preview runs on Cloud Run, which does
// not compress responses the way Vercel did).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { once } = require('node:events');
const { createApp } = require('../app');

test('the site and its scripts are served compressed when the browser accepts it', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-gzip-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>x</title>' + 'plan '.repeat(2000));
  fs.mkdirSync(path.join(dir, 'assets')); fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1);'.repeat(2000));
  const server = createApp({ frontendDir: dir }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/assets/app.js', '/pricing']) {
    const res = await fetch(base + route, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(res.status, 200, route);
    assert.equal(res.headers.get('content-encoding'), 'gzip', `${route} is compressed`);
  }
});
