// Deeper coverage for the admin session-token hardening pass: TTL and
// future-dated rejection, the v1->v2 domain bump, epoch-based revocation
// (what logout actually does), and the ADMIN_PASSWORD/ADMIN_SESSION_SECRET
// split — see api/_lib/admin-token.js's header comment for the reasoning
// behind each. Also covers the PostgREST filter-builder validation in
// api/_lib/supabase.js that closes the query-injection gap found in
// api/admin-review.js (req.body.id was interpolated into `id=eq.${id}`
// with only a `typeof === 'string'` check).

process.env.ADMIN_PASSWORD = 'test-admin-password-123';
process.env.ADMIN_SESSION_SECRET = 'b'.repeat(64);

const test = require('node:test');
const assert = require('node:assert');
const adminToken = require('../api/_lib/admin-token');
const { eqUuid, eqInt, inUuids, UUID_RE } = require('../api/_lib/supabase');

const EPOCH = 1;
const readEpoch = async () => EPOCH;

test('a token past its TTL is rejected as expired', () => {
  const oldIssuedAt = Date.now() - adminToken.TOKEN_TTL_MS - 1000;
  // The signature is never reached — TTL is checked first, so a garbage
  // hmac is enough to prove which check actually fired.
  const forged = `${oldIssuedAt}.${EPOCH}.deadbeef`;
  const result = adminToken.verifyTokenSignature(forged);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired');
});

test('a future-dated token is rejected rather than accepted as extra-fresh', () => {
  // The original scheme's freshness check was one-sided
  // (`Date.now() - issuedAt > TTL`), so a token minted with a
  // clock-skewed future issuedAt would never trip it and would live
  // longer than the intended TTL.
  const futureIssuedAt = Date.now() + adminToken.CLOCK_SKEW_MS + 60_000;
  const forged = `${futureIssuedAt}.${EPOCH}.deadbeef`;
  const result = adminToken.verifyTokenSignature(forged);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'future-dated');
});

test('a small clock skew is tolerated rather than immediately rejected', () => {
  const almostFuture = Date.now() + Math.floor(adminToken.CLOCK_SKEW_MS / 2);
  const result = adminToken.verifyTokenSignature(`${almostFuture}.${EPOCH}.deadbeef`);
  // Still fails overall (garbage signature), but not for being future-dated.
  assert.equal(result.ok, false);
  assert.notEqual(result.reason, 'future-dated');
  assert.notEqual(result.reason, 'expired');
});

test('an old (v1, 2-part) token shape is rejected as malformed under v2', () => {
  const result = adminToken.verifyTokenSignature(`${Date.now()}.deadbeef`);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'malformed');
});

test('a token is rejected once the session epoch has moved on — this is what logout does', async () => {
  const token = adminToken.issueToken(1);
  assert.equal(await adminToken.verifyToken(token, { readEpoch: async () => 1 }), true);
  assert.equal(await adminToken.verifyToken(token, { readEpoch: async () => 2 }), false);
});

test('an epoch-read failure fails closed rather than skipping the revocation check', async () => {
  const token = adminToken.issueToken(1);
  const failingReadEpoch = async () => {
    throw new Error('simulated Supabase outage');
  };
  assert.equal(await adminToken.verifyToken(token, { readEpoch: failingReadEpoch }), false);
});

test('changing ADMIN_PASSWORD alone does not invalidate an existing token', async () => {
  const token = adminToken.issueToken(EPOCH);
  const savedPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'a-completely-different-password';

  assert.equal(await adminToken.verifyToken(token, { readEpoch }), true);

  process.env.ADMIN_PASSWORD = savedPassword;
});

test('changing ADMIN_SESSION_SECRET invalidates every existing token', async () => {
  const token = adminToken.issueToken(EPOCH);
  const savedSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = 'c'.repeat(64);

  assert.equal(await adminToken.verifyToken(token, { readEpoch }), false);

  process.env.ADMIN_SESSION_SECRET = savedSecret;
});

test('eqUuid rejects query-injection attempts and non-UUIDs', () => {
  assert.throws(() => eqUuid('id', 'abc&limit=5'));
  assert.throws(() => eqUuid('id', 'abc#'));
  assert.throws(() => eqUuid('id', 'not-a-uuid'));
  assert.throws(() => eqUuid('id', 123));

  const validUuid = '03a4cb60-108b-417e-9a34-caa41c4768a1';
  assert.equal(eqUuid('id', validUuid), `id=eq.${validUuid}`);
  assert.match(validUuid, UUID_RE);
});

test('eqInt rejects non-integers', () => {
  assert.throws(() => eqInt('pr_number', 1.5));
  assert.throws(() => eqInt('pr_number', NaN));
  assert.throws(() => eqInt('pr_number', '5'));
  assert.equal(eqInt('pr_number', 5), 'pr_number=eq.5');
});

test('inUuids validates every id in the list', () => {
  const a = '03a4cb60-108b-417e-9a34-caa41c4768a1';
  const b = 'a461c410-c226-49d2-81d1-2a9df0ced612';
  assert.equal(inUuids('id', [a, b]), `id=in.("${a}","${b}")`);
  assert.throws(() => inUuids('id', [a, 'not-a-uuid']));
  assert.throws(() => inUuids('id', []));
});
