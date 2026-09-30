'use strict';

const crypto = require('crypto');

const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_PREFIX = 'keystone.v1';

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLength), 'base64').toString('utf8');
}

function getTokenSecret() {
  return String(process.env.UNLOCK_TOKEN_SECRET || process.env.VALID_PASSKEYS || '').trim();
}

function getTokenTiming(ttlMs = DEFAULT_TOKEN_TTL_MS, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = Math.floor((now + Number(ttlMs || DEFAULT_TOKEN_TTL_MS)) / 1000);
  return { issuedAt, expiresAt };
}

function createAccessToken({ ttlMs = DEFAULT_TOKEN_TTL_MS, secret = getTokenSecret(), subject = 'verified-passkey' } = {}) {
  const cleanSecret = String(secret || '').trim();
  if (!cleanSecret) {
    throw new Error('Token secret is not configured');
  }

  const { issuedAt, expiresAt } = getTokenTiming(ttlMs);
  const payload = {
    v: 1,
    sub: subject,
    iat: issuedAt,
    exp: expiresAt,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadPart = base64UrlEncode(payloadJson);
  const signature = crypto
    .createHmac('sha256', cleanSecret)
    .update(`${TOKEN_PREFIX}.${payloadPart}`)
    .digest();
  const signaturePart = signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  return {
    token: `${TOKEN_PREFIX}.${payloadPart}.${signaturePart}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    issuedAt: new Date(issuedAt * 1000).toISOString(),
  };
}

function safeEqual(a, b) {
  if (!Buffer.isBuffer(a)) a = Buffer.from(String(a || ''));
  if (!Buffer.isBuffer(b)) b = Buffer.from(String(b || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyAccessToken(token, { secret = getTokenSecret(), now = Date.now() } = {}) {
  const cleanSecret = String(secret || '').trim();
  const rawToken = String(token || '').trim();
  if (!cleanSecret) {
    return { valid: false, reason: 'Token secret is not configured' };
  }
  if (!rawToken) {
    return { valid: false, reason: 'Token missing' };
  }

  const parts = rawToken.split('.');
  if (parts.length !== 4 || parts[0] !== 'keystone' || parts[1] !== 'v1') {
    return { valid: false, reason: 'Token format invalid' };
  }

  const payloadPart = parts[2];
  const signaturePart = parts[3];
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadPart));
  } catch (_) {
    return { valid: false, reason: 'Token payload invalid' };
  }

  const expectedSignature = crypto
    .createHmac('sha256', cleanSecret)
    .update(`keystone.v1.${payloadPart}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  if (!safeEqual(Buffer.from(signaturePart), Buffer.from(expectedSignature))) {
    return { valid: false, reason: 'Token signature invalid' };
  }

  const nowSec = Math.floor(now / 1000);
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'Token payload invalid' };
  }
  if (payload.v !== 1 || payload.sub !== 'verified-passkey') {
    return { valid: false, reason: 'Token payload invalid' };
  }
  if (!Number.isFinite(Number(payload.exp)) || nowSec >= Number(payload.exp)) {
    return { valid: false, reason: 'Token expired' };
  }

  return {
    valid: true,
    payload,
    expiresAt: new Date(Number(payload.exp) * 1000).toISOString(),
    issuedAt: Number.isFinite(Number(payload.iat)) ? new Date(Number(payload.iat) * 1000).toISOString() : null,
  };
}

function extractAccessToken(req) {
  const headers = req?.headers || {};
  const bearer = String(headers.authorization || headers.Authorization || '').trim();
  if (bearer.toLowerCase().startsWith('bearer ')) {
    const value = bearer.slice(7).trim();
    if (value) return value;
  }

  const custom = String(headers['x-keystone-access-token'] || headers['X-Keystone-Access-Token'] || '').trim();
  return custom || null;
}

function requireAccessToken(req, res, next) {
  try {
    const token = extractAccessToken(req);
    const verified = verifyAccessToken(token);
    if (!verified.valid) {
      return res.status(401).json({
        success: false,
        message: verified.reason === 'Token missing' ? 'Access token required' : 'Invalid or expired access token',
      });
    }

    req.keystoneAccessToken = token;
    req.keystoneAccess = verified.payload;
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired access token',
    });
  }
}

module.exports = {
  DEFAULT_TOKEN_TTL_MS,
  createAccessToken,
  extractAccessToken,
  getTokenSecret,
  requireAccessToken,
  verifyAccessToken,
};
