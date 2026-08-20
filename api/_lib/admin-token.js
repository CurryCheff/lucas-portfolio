// Admin session token — HMAC-signed, epoch-scoped, revocable.
//
// Two properties matter, and both were gaps in the original version of
// this file:
//
// 1. FAIL CLOSED on missing secrets. `getSigningSecret()`/`getPassword()`
//    throw rather than falling back to `process.env.X || ''`, which would
//    silently downgrade every token to an HMAC keyed on the empty string.
// 2. LOGOUT MUST ACTUALLY REVOKE. A bare HMAC token with a TTL has no way
//    to invalidate a specific outstanding token before it expires — which
//    meant the old "log out" button only ever deleted the client-side
//    copy while the token kept verifying for the rest of its life. Every
//    token now embeds a `session_epoch`; verifying re-reads the current
//    epoch from admin_security (see api/_lib/admin-security.js) and
//    rejects any token whose embedded epoch doesn't match. Logout calls
//    `revokeAllSessions()`, which bumps the epoch — every outstanding
//    token everywhere stops verifying immediately. There's no per-device
//    granularity (this is a single-admin tool, so "log out everywhere" is
//    the behaviour that's actually wanted), and it doubles as a panic
//    button if a token is ever suspected leaked.
//
// The signing key is deliberately NOT the admin password. A leaked token
// is a known-plaintext-plus-signature pair; if that pair were signed with
// ADMIN_PASSWORD, it would become an offline cracking oracle against the
// same password that also gates merge-to-production (see
// api/admin-merge.js). ADMIN_SESSION_SECRET is a separate 32-byte random
// value used only for signing — ADMIN_PASSWORD is only ever compared,
// never used as a key. submit-token.js documents this same rule for the
// submission-link secret; it just never got applied here originally.
//
// Tokens are domain-prefixed (`admin:v2:...`) so a token minted for this
// purpose can't verify against a different token scheme in this codebase
// (see submit-token.js). The v2 bump from the previous scheme is
// deliberate: it makes every outstanding v1 token stop verifying the
// moment this deploys, which is the correct behaviour given the signing
// key itself changed.

const crypto = require('crypto');

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLOCK_SKEW_MS = 60 * 1000; // tolerate up to 60s of clock drift before rejecting a future-dated token
const DOMAIN = 'admin:v2';
const MIN_SESSION_SECRET_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 12;

function getSigningSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (typeof secret !== 'string' || secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      'ADMIN_SESSION_SECRET is not set (or is shorter than 32 chars) — generate one with `openssl rand -hex 32`'
    );
  }
  return secret;
}

function getPassword() {
  const secret = process.env.ADMIN_PASSWORD;
  if (typeof secret !== 'string' || secret.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD is not set (or is shorter than ${MIN_PASSWORD_LENGTH} chars)`);
  }
  return secret;
}

function sign(issuedAt, epoch) {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${DOMAIN}:${issuedAt}:${epoch}`)
    .digest('hex');
}

// `epoch` must be the caller's freshly-read current session_epoch (see
// admin-security.js's getSecurityRow) — admin-login.js reads it as part
// of its throttle check and passes it straight in.
function issueToken(epoch) {
  if (!Number.isInteger(epoch)) {
    throw new Error('issueToken requires an integer epoch');
  }
  const issuedAt = Date.now();
  return `${issuedAt}.${epoch}.${sign(issuedAt, epoch)}`;
}

// Pure, synchronous signature/shape/TTL check — no DB access, so this is
// directly unit-testable. Returns { ok: true, issuedAt, epoch } or
// { ok: false, reason }. A `false` verdict here means the token is
// malformed, expired, future-dated, or forged; it does NOT check
// revocation — that's verifyToken's job below.
function verifyTokenSignature(token) {
  if (typeof token !== 'string') return { ok: false, reason: 'not-a-string' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [issuedAtStr, epochStr, hmac] = parts;

  const issuedAt = Number(issuedAtStr);
  const epoch = Number(epochStr);
  if (!Number.isFinite(issuedAt) || !Number.isInteger(epoch)) {
    return { ok: false, reason: 'malformed' };
  }

  const now = Date.now();
  if (issuedAt > now + CLOCK_SKEW_MS) return { ok: false, reason: 'future-dated' };
  if (now - issuedAt > TOKEN_TTL_MS) return { ok: false, reason: 'expired' };

  let expected;
  try {
    expected = sign(issuedAt, epoch);
  } catch (err) {
    // Missing/short secret — fail closed rather than verifying against a
    // predictable key.
    console.error('admin-token verify failed:', err.message);
    return { ok: false, reason: 'no-secret' };
  }

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(String(hmac || ''));
  if (expectedBuf.length !== actualBuf.length) return { ok: false, reason: 'bad-signature' };
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return { ok: false, reason: 'bad-signature' };

  return { ok: true, issuedAt, epoch };
}

async function defaultReadEpoch() {
  // Required here rather than at module top-level to avoid a hard
  // dependency on admin-security.js (and therefore Supabase) for callers
  // that only need the pure signature check above, e.g. tests.
  const { getSecurityRow } = require('./admin-security');
  const row = await getSecurityRow();
  return row.session_epoch;
}

// Full check: signature/TTL, then revocation. `readEpoch` is injectable
// so tests can assert epoch-mismatch behavior without a database — see
// test/admin-auth.test.js.
//
// AVAILABILITY TRADEOFF, DELIBERATE: if the epoch read itself fails (e.g.
// Supabase is down), this fails closed and returns false rather than
// skipping the revocation check — a database outage locks the admin out
// instead of silently accepting a token that might have been revoked.
// There is no caching of the epoch either: admin traffic here is a
// handful of requests per session, and any cache window is a window
// where a just-revoked token would still work.
async function verifyToken(token, { readEpoch = defaultReadEpoch } = {}) {
  const sig = verifyTokenSignature(token);
  if (!sig.ok) return false;

  let currentEpoch;
  try {
    currentEpoch = await readEpoch();
  } catch (err) {
    console.error('admin-token: epoch read failed, failing closed:', err.message);
    return false;
  }

  return sig.epoch === currentEpoch;
}

// Constant-time password check. Used directly (not just verifyToken) on
// admin-merge.js — see security-patterns.md rule 5: a valid session token
// alone shouldn't be enough to merge to production. Only ever compares
// ADMIN_PASSWORD; never uses it as a signing key (see header comment).
function checkPassword(supplied) {
  let expected;
  try {
    expected = getPassword();
  } catch (err) {
    return false;
  }
  const suppliedBuf = Buffer.from(String(supplied || ''));
  const expectedBuf = Buffer.from(expected);
  if (suppliedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(suppliedBuf, expectedBuf);
}

// Extracts and verifies the Bearer token from a request's Authorization
// header. Returns a Promise<boolean> — shared by every admin-* endpoint
// so the check is identical everywhere. Async because verification now
// requires a DB read (the epoch check) — every call site awaits this.
async function requireAdmin(req, opts) {
  const header = req.headers && req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  return verifyToken(header.slice('Bearer '.length), opts);
}

// Bumps the shared session epoch, invalidating every outstanding token.
// This is the entire mechanism behind logout — see the header comment.
async function revokeAllSessions() {
  const { bumpSessionEpoch } = require('./admin-security');
  return bumpSessionEpoch();
}

module.exports = {
  issueToken,
  verifyTokenSignature,
  verifyToken,
  checkPassword,
  requireAdmin,
  revokeAllSessions,
  TOKEN_TTL_MS,
  CLOCK_SKEW_MS,
};
