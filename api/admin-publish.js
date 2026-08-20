// Vercel serverless function — manually (re-)triggers a batch publish, or
// (GET) lists open batches awaiting merge, grouped by pr_number (there's
// no separate batch table — see _lib/publish-batch.js). POST exists for:
// forcing a publish below threshold, or retrying after a partial failure.

const { requireAdmin } = require('./_lib/admin-token');
const { runPublishBatch } = require('./_lib/publish-batch');
const { sbSelect } = require('./_lib/supabase');
const { handler, noStore } = require('./_lib/http');

module.exports = handler(async function (req, res) {
  noStore(res);

  if (!(await requireAdmin(req))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    const rows = await sbSelect('testimonials', 'status=eq.previewing&order=created_at.desc');
    const byPr = new Map();
    for (const row of rows) {
      if (!byPr.has(row.pr_number)) {
        byPr.set(row.pr_number, {
          prNumber: row.pr_number,
          prUrl: row.pr_url,
          branchName: row.branch_name,
          itemCount: 0,
          ids: [],
        });
      }
      const batch = byPr.get(row.pr_number);
      batch.itemCount += 1;
      batch.ids.push(row.id);
    }
    res.status(200).json({ batches: Array.from(byPr.values()) });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { force } = req.body || {};

  const result = await runPublishBatch({ force: Boolean(force) });
  if (!result) {
    res.status(200).json({ published: false, message: 'Not enough approved testimonials yet.' });
    return;
  }
  res.status(200).json({ published: true, ...result });
});
