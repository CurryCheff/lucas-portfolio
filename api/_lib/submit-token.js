// Signed submission links — handed to a testimonial client so they can
// submit through a link with no login required.
//
// WHY A SEPARATE SECRET FROM ADMIN_PASSWORD
// These tokens go to third parties and can live for weeks, so the
// recipient holds a known plaintext AND its signature. If they were keyed
// on ADMIN_PASSWORD (a human-typed, low-entropy string), that pair becomes
// an offline cracking oracle for the admin password. SUBMIT_LINK_SECRET is
// 32 random bytes (openssl rand -hex 32) — nothing worth cracking.
//
// WHY THE DOMAIN PREFIX
// Even under one key, the signed messages must not collide. Without
// `submit:v1:`, a token minted here would be a structurally valid admin
// session token — meaning every client who ever received a link could
// paste it into the admin token header. The prefix plus the separate
// secret make that impossible two different ways.
//
// WHY THE CLIENT LABEL LIVES INSIDE THE SIGNATURE
// The link is `/submit.html?t=<token>` with no separate identity query
// param. Binding identity into the signed payload means a recipient can't
// edit the URL to submit as someone else. The frontend decodes the
// payload client-side purely to DISPLAY who the link is for — that's not
// a trust boundary; the server re-verifies the signature and reads
// identity from the verified payload only.

const crypto = require('crypto');

const DOMAIN = 'submit:v1';
const MIN_SECRET_LENGTH = 32;
const DEFAULT_TTL_DAYS = 30;

function getSecret() {
  const secret = process.env.SUBMIT_LINK_SECRET;
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      'SUBMIT_LINK_SECRET is not set (or is shorter than 32 chars) — generate one with `openssl rand -hex 32`'
    );
  }
  return secret;
}

function b64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function b64urlDecode(payload) {
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function sign(payload) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(`${DOMAIN}:${payload}`)
    .digest('hex');
}

function ttlMs() {
  const days = Number(process.env.SUBMIT_LINK_TTL_DAYS || DEFAULT_TTL_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000;
}

// `clientLabel` is whatever the admin typed when minting the link (e.g.
// "Chicken Slice — Tariro"), stored verbatim in testimonial_submissions.client_label.
function issueSubmitToken(clientLabel) {
  const issuedAt = Date.now();
  const payload = b64urlEncode({
    v: 1,
    sub: String(clientLabel),
    n: crypto.randomUUID(), // replay guard — UNIQUE on testimonial_submissions.submit_nonce
    i: issuedAt,
    e: issuedAt + ttlMs(),
  });
  return `${payload}.${sign(payload)}`;
}

// Returns { clientLabel, nonce, issuedAt, expiresAt } or null. Never throws
// on malformed input — callers treat null as "this link isn't valid".
function verifySubmitToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;

  const idx = token.lastIndexOf('.');
  const payload = token.slice(0, idx);
  const hmac = token.slice(idx + 1);

  let expected;
  try {
    expected = sign(payload);
  } catch (err) {
    console.error('submit-token verify failed:', err.message);
    return null;
  }

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(String(hmac || ''));
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;

  let claims;
  try {
    claims = b64urlDecode(payload);
  } catch (err) {
    return null;
  }

  if (claims.v !== 1) return null;
  if (typeof claims.sub !== 'string' || typeof claims.n !== 'string') return null;
  if (!Number.isFinite(claims.e) || Date.now() > claims.e) return null;

  return {
    clientLabel: claims.sub,
    nonce: claims.n,
    issuedAt: claims.i,
    expiresAt: claims.e,
  };
}

// Display-only decode for the frontend — deliberately does NOT verify.
// The server is the only thing that trusts a token; this is purely for
// showing "you're submitting as <clientLabel>" before the real check.
function decodeSubmitPayloadUnsafe(token) {
  try {
    return b64urlDecode(String(token).split('.')[0]);
  } catch (err) {
    return null;
  }
}

module.exports = { issueSubmitToken, verifySubmitToken, decodeSubmitPayloadUnsafe, ttlMs };
