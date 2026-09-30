import test from 'node:test';
import assert from 'node:assert/strict';
import { beginRenderRequest, pendingRenderRequest, settleRenderRequest, renderRequestKey } from '../src/lib/renderRequests.js';

const memory = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
let n = 0; const uuid = () => `id-${++n}`;

test('an unacknowledged request is resent with the same ID for the same revision and options', () => {
    const s = memory(), opts = { quality: 'final', sky: 'day', stills: true };
    const first = beginRenderRequest('alice', 'p1', 3, opts, s, uuid);
    assert.equal(beginRenderRequest('alice', 'p1', 3, { ...opts }, s, uuid).requestId, first.requestId, 'lost response: same ID');
    assert.notEqual(beginRenderRequest('alice', 'p1', 4, opts, s, uuid).requestId, first.requestId, 'a newer saved revision is a new render');
    assert.notEqual(beginRenderRequest('bob', 'p1', 4, opts, s, uuid).requestId, pendingRenderRequest('alice', 'p1', s).requestId, 'scoped per account');
});

test('settling removes only the acknowledged request; corrupt records are ignored', () => {
    const s = memory(), r = beginRenderRequest('alice', 'p1', 1, {}, s, uuid);
    settleRenderRequest('alice', 'p1', 'someone-else', s); assert.ok(pendingRenderRequest('alice', 'p1', s));
    settleRenderRequest('alice', 'p1', r.requestId, s); assert.equal(pendingRenderRequest('alice', 'p1', s), null);
    s.setItem(renderRequestKey('alice', 'p1'), '{not json'); assert.equal(pendingRenderRequest('alice', 'p1', s), null);
});

test('a storage failure stops the request before anything is sent', () => {
    const s = { ...memory(), setItem: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } };
    assert.throws(() => beginRenderRequest('alice', 'p1', 1, {}, s, uuid), /full/);
});
