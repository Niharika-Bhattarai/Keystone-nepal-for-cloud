'use strict';

// Who is calling: verifies the Firebase ID token in "Authorization: Bearer"
// and attaches req.user = { uid, email, emailVerified } (or null).
//
//   attachUser   - every /api request; never rejects
//   requireUser  - 401 without a signed-in user
//
// Verification is injectable so tests (and local dev with
// ACCOUNTS_AUTH=insecure-dev) do not need Firebase.

let verifier = null;
const { localStudio } = require('../nepal/localAccess');

function defaultVerifier() {
  if (process.env.ACCOUNTS_AUTH === 'insecure-dev' && process.env.NODE_ENV !== 'production' && !process.env.K_SERVICE) {
    // "dev:<uid>:<email>" tokens, for local development only
    return async (token) => {
      const m = /^dev:([\w-]{1,64}):(.+)$/.exec(token);
      if (!m) throw new Error('bad dev token');
      return { uid: m[1], email: m[2], email_verified: true };
    };
  }
  const { getAuth } = require('firebase-admin/auth');
  const { app } = require('./firebase');
  return (token) => getAuth(app()).verifyIdToken(token, true);
}

async function userFromRequest(req) {
  const h = String(req.headers?.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  try {
    const claims = await (verifier || (verifier = defaultVerifier()))(m[1].trim());
    return { uid: claims.uid, email: claims.email || '', emailVerified: Boolean(claims.email_verified) };
  } catch {
    return null;
  }
}

async function attachUser(req, res, next) {
  req.user = await userFromRequest(req);
  if (!req.user && localStudio()) req.user = { uid: 'nepal_local', email: 'local@nepal.invalid', emailVerified: true };
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, code: 'SIGN_IN_REQUIRED', message: 'Sign in to continue.' });
  return next();
}

module.exports = { attachUser, requireUser, userFromRequest, setVerifier: (fn) => { verifier = fn; } };
