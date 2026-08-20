// Vercel serverless function — admin mints a signed submission link for a
// named client. No DB write here: public.testimonials requires client_name
// + author_name + quote + consented_at all NOT NULL together, so a row
// only ever gets created by the submission itself (api/submit.js). The
// link's replay guard is the token's nonce, enforced by testimonials'
// UNIQUE constraint on link_nonce at insert time, not by a pre-existing row.

const { requireAdmin } = require('./_lib/admin-token');
const { issueSubmitToken } = require('./_lib/submit-token');
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

  const { clientLabel } = req.body || {};
  if (typeof clientLabel !== 'string' || clientLabel.trim().length < 2 || clientLabel.trim().length > 80) {
    res.status(400).json({ error: 'clientLabel is required (2-80 characters)' });
    return;
  }

  let token;
  try {
    token = issueSubmitToken(clientLabel.trim());
  } catch (err) {
    console.error('admin-mint-link: issueSubmitToken failed:', err.message);
    res.status(500).json({ error: 'Link minting is not configured yet.' });
    return;
  }

  const base = process.env.PUBLIC_SITE_URL || `https://${req.headers.host}`;
  res.status(200).json({ link: `${base}/submit.html?t=${token}` });
});
