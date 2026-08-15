// Vercel serverless function — exchanges the admin password for a
// short-lived session token. See api/_lib/admin-token.js for the token
// scheme (fail-closed, domain-prefixed HMAC).

const { checkPassword, issueToken } = require('./_lib/admin-token');
const { getClientIp, createRateLimiter } = require('./_lib/rate-limit');

// Tighter than the chat/submit limiters — this endpoint is a password
// guess oracle if left uncapped.
const isRateLimited = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 10 });

module.exports = async function handler(req, res) {
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

  if (!checkPassword(password)) {
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }

  let token;
  try {
    token = issueToken();
  } catch (err) {
    console.error('admin-login: issueToken failed:', err.message);
    res.status(500).json({ error: 'Admin login is not configured yet.' });
    return;
  }

  res.status(200).json({ token });
};
