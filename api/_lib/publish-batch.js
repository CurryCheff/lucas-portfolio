// Core batch-publish logic, used by both api/admin-publish.js (manual/HTTP
// trigger) and api/admin-review.js (auto-trigger on approval) — kept as one
// function so the two trigger paths can never drift apart.
//
// public.testimonials has no separate "batch" table — pr_number has no
// UNIQUE constraint, so multiple rows simply share the same
// branch_name/pr_number/pr_url value once batched. This sidesteps the
// skill's documented batched-publish bug (a wrong UNIQUE constraint on a
// PR-identity column) by construction: there's nothing to be unique on.
//
// Flow: 1) select approved rows with no pr_number yet, 2) open one GitHub
// PR, 3) one batched UPDATE stamping branch_name/pr_number/pr_url/status
// onto all of them. If step 3 fails after step 2 succeeds, the PR exists
// for real but no row points at it yet — re-running this function will
// just select the same still-approved rows and open a *new* PR (mildly
// wasteful, not silently lost) since nothing here is idempotent against a
// half-applied previous attempt; a stuck row would need a manual pr_number
// backfill in that rare case.

const github = require('./github');
const { sbSelect, sbUpdate } = require('./supabase');
const { renderTrack, spliceTestimonials } = require('./render-testimonial');

const THRESHOLD = 3;
const INDEX_HTML_PATH = 'index.html';
const BRANCH_PREFIX = 'content-updates/testimonials-';

function branchName() {
  const date = new Date().toISOString().slice(0, 10);
  const shortId = Math.random().toString(36).slice(2, 8);
  return `${BRANCH_PREFIX}${date}-${shortId}`;
}

// Returns null if fewer than THRESHOLD are eligible and force !== true.
async function runPublishBatch({ force = false } = {}) {
  const eligible = await sbSelect(
    'testimonials',
    'status=eq.approved&pr_number=is.null&order=approved_at.asc'
  );

  if (eligible.length === 0) return null;
  if (!force && eligible.length < THRESHOLD) return null;

  const base = process.env.GITHUB_BASE_BRANCH || 'main';
  const branch = branchName();

  const baseSha = await github.getBranchSha(base);
  const { content, sha: fileSha } = await github.getFileContent(INDEX_HTML_PATH, base);

  // Fail closed — spliceTestimonials throws if the markers aren't found
  // exactly once, in order. No branch is created before this check passes.
  const innerHtml = renderTrack(eligible);
  const updatedHtml = spliceTestimonials(content, innerHtml);

  await github.createBranch(branch, baseSha);
  await github.updateFile({
    path: INDEX_HTML_PATH,
    content: updatedHtml,
    message: `Publish ${eligible.length} testimonial${eligible.length === 1 ? '' : 's'}`,
    branch,
    sha: fileSha,
  });

  const pr = await github.createPullRequest({
    title: `Publish ${eligible.length} testimonial${eligible.length === 1 ? '' : 's'}`,
    head: branch,
    base,
    body: `Automated batch publish from the testimonials admin tool.\n\nIncludes:\n${eligible
      .map((row) => `- ${row.author_name} (${row.client_name})`)
      .join('\n')}`,
  });

  const ids = eligible.map((row) => `"${row.id}"`).join(',');
  await sbUpdate('testimonials', `id=in.(${ids})`, {
    branch_name: branch,
    pr_number: pr.number,
    pr_url: pr.html_url,
    status: 'previewing',
  });

  return { prUrl: pr.html_url, prNumber: pr.number, itemCount: eligible.length };
}

module.exports = { runPublishBatch, THRESHOLD, BRANCH_PREFIX };
