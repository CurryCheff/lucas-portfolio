// Vercel serverless function — exchanges the admin password for a
// short-lived, revocable session token. See api/_lib/admin-token.js for
// the token scheme and api/_lib/admin-security.js for the throttle.

const { checkPassword, issueToken } = require('./_lib/admin-token');
const { getClientIp, createRateLimiter } = require('./_lib/rate-limit');
const { getSecurityRow, lockoutRemainingMs, registerFailedLogin, registerSuccessfulLogin } = require('./_lib/admin-security');
const { handler, noStore } = require('./_lib/http');

// Cheap first line in front of the DB-backed throttle below — filters
// out the crudest bursts without a round trip. The real lockout (which
// survives cold starts and is shared across concurrent instances) is the
// admin_security-backed check further down.
const isRateLimited = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 10 });

module.exports = handler(async function (req, res) {
  noStore(res);

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (isRateLimited(getClientIp(req))) {
    res.status(429).json({ error: 'Too many attempts — please wait a few minutes and try again.' });
    return;
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'password is required' });
    return;
  }

  let security;
  try {
    security = await getSecurityRow();
  } catch (err) {
    console.error('admin-login: could not read admin_security:', err.message);
    res.status(500).json({ error: 'Admin login is not configured yet.' });
    return;
  }

  const remainingMs = lockoutRemainingMs(security);
  if (remainingMs > 0) {
    res.status(429).json({
      error: `Too many failed attempts — try again in ${Math.ceil(remainingMs / 60000)} minute(s).`,
    });
    return;
  }

  if (!checkPassword(password)) {
    try {
      await registerFailedLogin();
    } catch (err) {
      console.error('admin-login: could not record failed attempt:', err.message);
    }
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }

  try {
    await registerSuccessfulLogin();
  } catch (err) {
    // Not fatal — a stale failure counter is a minor inconvenience, not a
    // reason to block a correct login.
    console.error('admin-login: could not reset attempt counter:', err.message);
  }

  let token;
  try {
    token = issueToken(security.session_epoch);
  } catch (err) {
    console.error('admin-login: issueToken failed:', err.message);
    res.status(500).json({ error: 'Admin login is not configured yet.' });
    return;
  }

  res.status(200).json({ token });
});
