// Shared response hardening for every api/*.js endpoint.
//
// `handler(fn)` is a structural fix, not a patch on individual call
// sites: several admin-* handlers had bare `await`s that could reject
// and escape as a raw platform FUNCTION_INVOCATION_FAILED instead of a
// clean JSON error. Wrapping every endpoint here means a new unwrapped
// await added later fails the same safe way automatically, rather than
// depending on every future edit remembering a try/catch.
//
// Endpoints should still return their own specific 4xx responses for
// expected conditions (bad input, wrong password, not found) — this is
// the backstop for everything else, not a replacement for real
// validation.

const crypto = require('crypto');

function noStore(res) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  }
}

function shortErrorId() {
  return crypto.randomBytes(4).toString('hex');
}

function handler(fn) {
  return async function wrapped(req, res) {
    try {
      await fn(req, res);
    } catch (err) {
      const id = shortErrorId();
      console.error(`[${id}]`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Something went wrong.', errorId: id });
      }
    }
  };
}

module.exports = { handler, noStore };
