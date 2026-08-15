// Vercel serverless function — manually (re-)triggers a batch publish, or
// (GET) lists open batches awaiting merge, grouped by pr_number (there's
// no separate batch table — see _lib/publish-batch.js). POST exists for:
// forcing a publish below threshold, or retrying after a partial failure.

const { requireAdmin } = require('./_lib/admin-token');
const { runPublishBatch } = require('./_lib/publish-batch');
const { sbSelect } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (!requireAdmin(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    try {
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
    } catch (err) {
      console.error('admin-publish: GET failed:', err.message);
      res.status(500).json({ error: 'Could not load open batches.' });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { force } = req.body || {};

  try {
    const result = await runPublishBatch({ force: Boolean(force) });
    if (!result) {
      res.status(200).json({ published: false, message: 'Not enough approved testimonials yet.' });
      return;
    }
    res.status(200).json({ published: true, ...result });
  } catch (err) {
    console.error('admin-publish: failed:', err.message);
    res.status(500).json({ error: 'Publish failed — check server logs.', detail: err.message });
  }
};
