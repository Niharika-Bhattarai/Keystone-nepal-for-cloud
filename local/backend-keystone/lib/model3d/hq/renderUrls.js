'use strict';
// Short-lived signed links to one file of one owned, completed render, for the
// local artifact store (Cloud Storage issues its own signed URLs). The viewer
// and <img> tags cannot send the account's bearer token, so the link carries its
// authorization: owner, job, file, expiry and disposition under an HMAC. The
// file route still re-reads the owned job and re-verifies the stored bytes.
const crypto = require('node:crypto');
const MAX_TTL_MS = 15 * 60_000;

function renderUrls({ secret, clock = Date.now }) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) throw new Error('A 32-byte signing secret is required');
  const mac = (uid, id, name, exp, download) => crypto.createHmac('sha256', secret).update([uid, id, name, exp, download].join('\n')).digest('base64url');
  return {
    sign(uid, id, name, { ttlMs = 10 * 60_000, download = false } = {}) {
      if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_TTL_MS) throw new Error('Invalid link lifetime');
      const exp = clock() + ttlMs, d = download ? '1' : '0';
      const query = new URLSearchParams({ u: uid, e: String(exp), d, s: mac(uid, id, name, exp, d) });
      return `/api/renders/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}?${query}`;
    },
    // Returns { uid, download } for a valid, unexpired link to exactly this job/file, else null.
    verify(id, name, query) {
      const { u, e, d, s } = query || {};
      if (typeof u !== 'string' || !/^[\w-]{1,128}$/.test(u) || typeof e !== 'string' || !/^\d{1,16}$/.test(e) || !['0', '1'].includes(d) || typeof s !== 'string') return null;
      const exp = Number(e);
      if (exp <= clock() || exp > clock() + MAX_TTL_MS) return null;
      const expected = Buffer.from(mac(u, id, name, exp, d)), given = Buffer.from(s);
      return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? { uid: u, download: d === '1', expiresAt: exp } : null;
    },
  };
}
module.exports = { renderUrls, MAX_TTL_MS };
