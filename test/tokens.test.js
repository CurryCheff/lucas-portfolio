// Token domain separation — the load-bearing test for admin-token.js /
// submit-token.js. See ~/.claude/skills/collect-review-publish/references/security-patterns.md rule 2.

process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.SUBMIT_LINK_SECRET = 'a'.repeat(64);

const test = require('node:test');
const assert = require('node:assert');
const adminToken = require('../api/_lib/admin-token');
const submitToken = require('../api/_lib/submit-token');

test('an admin token is not accepted as a submit token', () => {
  const token = adminToken.issueToken();
  assert.equal(submitToken.verifySubmitToken(token), null);
});

test('a submit token is not accepted as an admin token', () => {
  const token = submitToken.issueSubmitToken('some-client');
  assert.equal(adminToken.verifyToken(token), false);
});

test('round-trips still work', () => {
  assert.equal(adminToken.verifyToken(adminToken.issueToken()), true);

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

test('verification FAILS CLOSED when the secret is missing', () => {
  const token = adminToken.issueToken();
  const saved = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;

  assert.equal(adminToken.verifyToken(token), false);
  assert.equal(adminToken.checkPassword(''), false);
  assert.throws(() => adminToken.issueToken(), /ADMIN_PASSWORD is not set/);

  process.env.ADMIN_PASSWORD = saved;
});

test('a too-short link secret is refused rather than used', () => {
  const saved = process.env.SUBMIT_LINK_SECRET;
  process.env.SUBMIT_LINK_SECRET = 'short';

  assert.throws(() => submitToken.issueSubmitToken('x'), /SUBMIT_LINK_SECRET/);
  assert.equal(submitToken.verifySubmitToken('a.b'), null);

  process.env.SUBMIT_LINK_SECRET = saved;
});

test('garbage input never throws', () => {
  for (const bad of [null, undefined, '', 'x', 'x.y', 123, {}, 'a.b.c']) {
    assert.equal(adminToken.verifyToken(bad), false);
    assert.equal(submitToken.verifySubmitToken(bad), null);
  }
});

test('requireAdmin reads the Bearer header correctly', () => {
  const token = adminToken.issueToken();
  assert.equal(adminToken.requireAdmin({ headers: { authorization: `Bearer ${token}` } }), true);
  assert.equal(adminToken.requireAdmin({ headers: { authorization: `${token}` } }), false);
  assert.equal(adminToken.requireAdmin({ headers: {} }), false);
});
