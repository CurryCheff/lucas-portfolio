// Stateless admin session token — NOT real auth. One shared secret, no
// revocation list, no per-user identity. Changing ADMIN_PASSWORD is the
// only way to invalidate outstanding sessions.
//
// This gates the testimonials review/publish/merge endpoints, so two
// properties matter:
//
// 1. A missing secret must FAIL CLOSED. Reading
//    `process.env.ADMIN_PASSWORD || ''` means a typo'd or unset env var
//    silently downgrades every token to an HMAC keyed on the empty
//    string — forgeable by anyone who notices. This throws on issue and
//    returns false on verify instead.
// 2. Tokens are domain-prefixed (`admin:v1:...`). See submit-token.js for
//    why: without a prefix, a token minted for one purpose verifies fine
//    for another purpose too.

const crypto = require('crypto');

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const DOMAIN = 'admin:v1';
const MIN_SECRET_LENGTH = 8;

function getSecret() {
  const secret = process.env.ADMIN_PASSWORD;
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error('ADMIN_PASSWORD is not set (or is too short) — refusing to sign or verify tokens');
  }
  return secret;
}

function sign(issuedAt) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(`${DOMAIN}:${issuedAt}`)
    .digest('hex');
}

function issueToken() {
  const issuedAt = Date.now();
  return `${issuedAt}.${sign(issuedAt)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;

  const [issuedAtStr, hmac] = token.split('.');
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > TOKEN_TTL_MS) return false;

  let expected;
  try {
    expected = sign(issuedAt);
  } catch (err) {
    // Missing/short secret — fail closed rather than verifying against a
    // predictable key.
    console.error('admin-token verify failed:', err.message);
    return false;
  }

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(String(hmac || ''));
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

// Constant-time password check. Used directly (not just verifyToken) on
// admin-merge.js — see security-patterns.md rule 5: a valid session token
// alone shouldn't be enough to merge to production.
function checkPassword(supplied) {
  let expected;
  try {
    expected = getSecret();
  } catch (err) {
    return false;
  }
  const suppliedBuf = Buffer.from(String(supplied || ''));
  const expectedBuf = Buffer.from(expected);
  if (suppliedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(suppliedBuf, expectedBuf);
}

// Extracts and verifies the Bearer token from a request's Authorization
// header. Returns true/false — shared by every admin-* endpoint so the
// check is identical everywhere.
function requireAdmin(req) {
  const header = req.headers && req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  return verifyToken(header.slice('Bearer '.length));
}

module.exports = { issueToken, verifyToken, checkPassword, requireAdmin, TOKEN_TTL_MS };
