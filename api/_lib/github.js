// Thin fetch wrapper for the GitHub REST calls the publish/merge endpoints
// need. Plain fetch, no octokit — this is a handful of calls against one
// repo, not worth a dependency. See
// ~/.claude/skills/collect-review-publish/references/technical-gotchas.md
// for the specific quirks this file exists to get right:
//   - User-Agent is mandatory or GitHub returns a bare 403.
//   - Singular `git/ref/heads/{branch}` (exact match) vs plural
//     `git/refs/heads/{branch}` (prefix list) — easy to mix up.
//   - `mergeable` is null while GitHub computes it; poll a few times.
//   - Merge is conditional on the PR's head sha (optimistic concurrency).

function config() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  if (!token || !owner || !repo) {
    throw new Error('GITHUB_TOKEN / GITHUB_REPO_OWNER / GITHUB_REPO_NAME is not set');
  }
  return { token, owner, repo };
}

async function gh(path, options = {}) {
  const { token } = config();
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'overboard-testimonials-tool',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${options.method || 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

// Exact-match single-ref lookup — singular `ref`, not the plural `refs`
// list endpoint.
async function getBranchSha(branch) {
  const { owner, repo } = config();
  const data = await gh(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  return data.object.sha;
}

async function createBranch(newBranch, fromSha) {
  const { owner, repo } = config();
  await gh(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
  });
}

// Returns { content: string, sha: string } — sha is required to update the file.
async function getFileContent(path, ref) {
  const { owner, repo } = config();
  const data = await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`);
  if (data.encoding !== 'base64') {
    // Files over ~1MB come back with encoding: "none" — not expected for
    // index.html, but fail loudly instead of silently mangling content.
    throw new Error(`Unexpected encoding "${data.encoding}" for ${path}`);
  }
  return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
}

async function updateFile({ path, content, message, branch, sha }) {
  const { owner, repo } = config();
  return gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      sha,
    }),
  });
}

async function createPullRequest({ title, head, base, body }) {
  const { owner, repo } = config();
  return gh(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, head, base, body }),
  });
}

async function getPullRequest(prNumber) {
  const { owner, repo } = config();
  return gh(`/repos/${owner}/${repo}/pulls/${prNumber}`);
}

async function getPullRequestFiles(prNumber) {
  const { owner, repo } = config();
  return gh(`/repos/${owner}/${repo}/pulls/${prNumber}/files`);
}

async function mergePullRequest(prNumber, headSha) {
  const { owner, repo } = config();
  return gh(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ sha: headSha, merge_method: 'squash' }),
  });
}

// Polls `mergeable` up to 3 times with a short gap — it's null immediately
// after PR open while GitHub computes it, per technical-gotchas.md.
async function waitForMergeable(prNumber, attempts = 3, delayMs = 1500) {
  for (let i = 0; i < attempts; i++) {
    const pr = await getPullRequest(prNumber);
    if (pr.mergeable !== null) return pr;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return getPullRequest(prNumber);
}

module.exports = {
  getBranchSha,
  createBranch,
  getFileContent,
  updateFile,
  createPullRequest,
  getPullRequest,
  getPullRequestFiles,
  mergePullRequest,
  waitForMergeable,
};
