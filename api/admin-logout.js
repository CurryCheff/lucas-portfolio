// Vercel serverless function — actually revokes the admin session, unlike
// the old client-only "log out" that just deleted a sessionStorage key
// while the token kept verifying. Bumps the shared session epoch (see
// api/_lib/admin-token.js), which invalidates every outstanding token —
// including the one making this request, and any other still-open tab.

const { requireAdmin, revokeAllSessions } = require('./_lib/admin-token');
const { handler, noStore } = require('./_lib/http');

module.exports = handler(async function (req, res) {
  noStore(res);

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!(await requireAdmin(req))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  await revokeAllSessions();
  res.status(200).json({ ok: true });
});
