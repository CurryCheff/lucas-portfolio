// Vercel serverless function — admin lists submissions by status. The only
// place contact_phone/contact_email are ever read back out to a client.

const { requireAdmin } = require('./_lib/admin-token');
const { sbSelect } = require('./_lib/supabase');
const { handler, noStore } = require('./_lib/http');

const VALID_STATUSES = ['pending', 'approved', 'previewing', 'published', 'rejected'];
const RESULT_LIMIT = 200;

module.exports = handler(async function (req, res) {
  noStore(res);

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!(await requireAdmin(req))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const status = req.query && req.query.status;
  let query = `order=created_at.desc&limit=${RESULT_LIMIT}`;
  if (status && status !== 'all') {
    if (!VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}, all` });
      return;
    }
    query = `status=eq.${status}&${query}`;
  }

  try {
    const rows = await sbSelect('testimonials', query);
    res.status(200).json({ submissions: rows });
  } catch (err) {
    console.error('admin-queue: select failed:', err.message);
    res.status(500).json({ error: 'Could not load the queue.' });
  }
});
