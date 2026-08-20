// Vercel serverless function — merges a batch's PR to production. The
// single most sensitive action in this tool (security-patterns.md rule 5),
// so it re-checks the password directly, independent of the bearer token
// already being valid, and defensively constrains what it's willing to
// merge (rule 6) rather than trusting the prNumber alone. head_sha is read
// fresh from GitHub here rather than trusted from a stored value, since
// there's no separate batch table recording it.
//
// The password check shares the same DB-backed lockout as admin-login —
// this endpoint is a second password-guess oracle otherwise, gated by a
// bearer token but not throttled on its own.

const { requireAdmin, checkPassword } = require('./_lib/admin-token');
const { sbSelect, sbUpdate, eqInt, inUuids } = require('./_lib/supabase');
const { getSecurityRow, lockoutRemainingMs, registerFailedLogin, registerSuccessfulLogin } = require('./_lib/admin-security');
const { BRANCH_PREFIX } = require('./_lib/publish-batch');
const github = require('./_lib/github');
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

  const security = await getSecurityRow();
  const remainingMs = lockoutRemainingMs(security);
  if (remainingMs > 0) {
    res.status(429).json({
      error: `Too many failed password attempts — try again in ${Math.ceil(remainingMs / 60000)} minute(s).`,
    });
    return;
  }

  const { password } = req.body || {};
  if (!checkPassword(password)) {
    await registerFailedLogin();
    res.status(401).json({ error: 'Incorrect password — re-enter it to confirm this merge.' });
    return;
  }
  await registerSuccessfulLogin();

  const prNumber = Number(req.body && req.body.prNumber);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    res.status(400).json({ error: 'prNumber must be a positive integer' });
    return;
  }

  const rows = await sbSelect('testimonials', `${eqInt('pr_number', prNumber)}&status=eq.previewing`);
  if (rows.length === 0) {
    res.status(404).json({ error: 'No previewing testimonials found for that PR number' });
    return;
  }

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

  await sbUpdate(
    'testimonials',
    inUuids(
      'id',
      rows.map((row) => row.id)
    ),
    {
      status: 'published',
      published_at: new Date().toISOString(),
      published_commit_sha: mergeResult.sha,
    }
  );

  res.status(200).json({ merged: true, itemCount: rows.length });
});
