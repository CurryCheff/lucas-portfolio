// Vercel serverless function — merges a batch's PR to production. The
// single most sensitive action in this tool (security-patterns.md rule 5),
// so it re-checks the password directly, independent of the bearer token
// already being valid, and defensively constrains what it's willing to
// merge (rule 6) rather than trusting the prNumber alone. head_sha is read
// fresh from GitHub here rather than trusted from a stored value, since
// there's no separate batch table recording it.

const { requireAdmin, checkPassword } = require('./_lib/admin-token');
const { sbSelect, sbUpdate } = require('./_lib/supabase');
const { BRANCH_PREFIX } = require('./_lib/publish-batch');
const github = require('./_lib/github');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!requireAdmin(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { password } = req.body || {};
  if (!checkPassword(password)) {
    res.status(401).json({ error: 'Incorrect password — re-enter it to confirm this merge.' });
    return;
  }
  const prNumber = Number(req.body && req.body.prNumber);
  if (!Number.isFinite(prNumber)) {
    res.status(400).json({ error: 'prNumber is required' });
    return;
  }

  const rows = await sbSelect('testimonials', `pr_number=eq.${prNumber}&status=eq.previewing`);
  if (rows.length === 0) {
    res.status(404).json({ error: 'No previewing testimonials found for that PR number' });
    return;
  }

  try {
    const pr = await github.getPullRequest(prNumber);
    if (!pr.head.ref.startsWith(BRANCH_PREFIX)) {
      res.status(400).json({ error: 'Branch name does not match the expected prefix — refusing to merge' });
      return;
    }

    const files = await github.getPullRequestFiles(prNumber);
    const unexpected = files.filter((f) => f.filename !== 'index.html');
    if (unexpected.length > 0) {
      res.status(400).json({
        error: 'PR touches unexpected files — refusing to merge',
        detail: unexpected.map((f) => f.filename),
      });
      return;
    }

    const checkedPr = await github.waitForMergeable(prNumber);
    if (checkedPr.mergeable === false || checkedPr.mergeable_state === 'dirty') {
      res.status(409).json({ error: 'PR has a merge conflict — re-run publish from the current base instead.' });
      return;
    }

    const mergeResult = await github.mergePullRequest(prNumber, checkedPr.head.sha);

    const ids = rows.map((row) => `"${row.id}"`).join(',');
    await sbUpdate('testimonials', `id=in.(${ids})`, {
      status: 'published',
      published_at: new Date().toISOString(),
      published_commit_sha: mergeResult.sha,
    });

    res.status(200).json({ merged: true, itemCount: rows.length });
  } catch (err) {
    console.error('admin-merge: failed:', err.message);
    res.status(500).json({ error: 'Merge failed — check server logs.', detail: err.message });
  }
};
