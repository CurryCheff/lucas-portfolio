// Token domain separation — the load-bearing test for admin-token.js /
// submit-token.js. See ~/.claude/skills/collect-review-publish/references/security-patterns.md rule 2.
//
// Deeper admin-token coverage (TTL, epoch revocation, secret-split
// behavior) lives in test/admin-auth.test.js — kept separate since those
// tests are specifically about the hardening pass, not the base domain
// separation this file has always covered.

process.env.ADMIN_PASSWORD = 'test-admin-password-123';
process.env.ADMIN_SESSION_SECRET = 'b'.repeat(64);
process.env.SUBMIT_LINK_SECRET = 'a'.repeat(64);

const test = require('node:test');
const assert = require('node:assert');
const adminToken = require('../api/_lib/admin-token');
const submitToken = require('../api/_lib/submit-token');

// verifyToken now needs a live session_epoch to compare against, which
// normally means a DB read (see admin-security.js). Every test here
// injects a fixed reader instead, so this file never touches Supabase.
const EPOCH = 1;
const readEpoch = async () => EPOCH;

test('an admin token is not accepted as a submit token', () => {
  const token = adminToken.issueToken(EPOCH);
  assert.equal(submitToken.verifySubmitToken(token), null);
});

test('a submit token is not accepted as an admin token', async () => {
  const token = submitToken.issueSubmitToken('some-client');
  assert.equal(await adminToken.verifyToken(token, { readEpoch }), false);
});

test('round-trips still work', async () => {
  assert.equal(await adminToken.verifyToken(adminToken.issueToken(EPOCH), { readEpoch }), true);

  const claims = submitToken.verifySubmitToken(submitToken.issueSubmitToken('some-client'));
  assert.equal(claims.clientLabel, 'some-client');
  assert.match(claims.nonce, /^[0-9a-f-]{36}$/);
});

test('each submit link carries a distinct nonce', () => {
  const a = submitToken.verifySubmitToken(submitToken.issueSubmitToken('some-client'));
  const b = submitToken.verifySubmitToken(submitToken.issueSubmitToken('some-client'));
  assert.notEqual(a.nonce, b.nonce);
});

test('tampering with the client label invalidates the signature', () => {
  const token = submitToken.issueSubmitToken('some-client');
  const [payload, hmac] = token.split('.');

  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  claims.sub = 'a-different-client';
  const forged = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');

  assert.equal(submitToken.verifySubmitToken(`${forged}.${hmac}`), null);
});

test('admin token verification FAILS CLOSED when ADMIN_SESSION_SECRET is missing', async () => {
  const token = adminToken.issueToken(EPOCH);
  const saved = process.env.ADMIN_SESSION_SECRET;
  delete process.env.ADMIN_SESSION_SECRET;

  assert.equal(await adminToken.verifyToken(token, { readEpoch }), false);
  assert.throws(() => adminToken.issueToken(EPOCH), /ADMIN_SESSION_SECRET is not set/);

  process.env.ADMIN_SESSION_SECRET = saved;
});

test('checkPassword FAILS CLOSED when ADMIN_PASSWORD is missing', () => {
  const saved = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;

  assert.equal(adminToken.checkPassword(''), false);

  process.env.ADMIN_PASSWORD = saved;
});

test('a too-short link secret is refused rather than used', () => {
  const saved = process.env.SUBMIT_LINK_SECRET;
  process.env.SUBMIT_LINK_SECRET = 'short';

  assert.throws(() => submitToken.issueSubmitToken('x'), /SUBMIT_LINK_SECRET/);
  assert.equal(submitToken.verifySubmitToken('a.b'), null);

  process.env.SUBMIT_LINK_SECRET = saved;
});

test('garbage input never throws', async () => {
  for (const bad of [null, undefined, '', 'x', 'x.y', 123, {}, 'a.b.c']) {
    assert.equal(await adminToken.verifyToken(bad, { readEpoch }), false);
    assert.equal(submitToken.verifySubmitToken(bad), null);
  }
});

test('requireAdmin reads the Bearer header correctly', async () => {
  const token = adminToken.issueToken(EPOCH);
  assert.equal(
    await adminToken.requireAdmin({ headers: { authorization: `Bearer ${token}` } }, { readEpoch }),
    true
  );
  assert.equal(await adminToken.requireAdmin({ headers: { authorization: `${token}` } }, { readEpoch }), false);
  assert.equal(await adminToken.requireAdmin({ headers: {} }, { readEpoch }), false);
});
