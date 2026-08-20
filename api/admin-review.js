// Vercel serverless function — admin approves or rejects one submission.
// On approve: the thank-you send fires only after the DB write for the
// approval itself has committed (never send a thank-you for a decision
// that didn't actually persist), then a batch publish is attempted (a
// no-op if under threshold — see _lib/publish-batch.js).
//
// Wrapped in api/_lib/http.js's `handler()`, so any DB/network failure
// below — not just the ones with an explicit try/catch — is caught and
// turned into a clean 500 with an errorId, never an unhandled rejection.

const { requireAdmin } = require('./_lib/admin-token');
const { sbSelect, sbUpdate, eqUuid, UUID_RE } = require('./_lib/supabase');
const { sendThankYou } = require('./_lib/notify-thankyou');
const { runPublishBatch } = require('./_lib/publish-batch');
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

  const { id, decision, rejectionNote } = req.body || {};
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'id must be a valid UUID' });
    return;
  }
  if (decision !== 'approve' && decision !== 'reject') {
    res.status(400).json({ error: 'decision must be "approve" or "reject"' });
    return;
  }

  const existing = await sbSelect('testimonials', `${eqUuid('id', id)}&limit=1`);
  const row = existing[0];
  if (!row) {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }
  if (row.status !== 'pending') {
    res.status(409).json({ error: `Submission is "${row.status}", not pending — nothing to review` });
    return;
  }

  if (decision === 'reject') {
    await sbUpdate('testimonials', eqUuid('id', id), {
      status: 'rejected',
      rejected_reason: typeof rejectionNote === 'string' ? rejectionNote.slice(0, 500) : null,
    });
    res.status(200).json({ ok: true, status: 'rejected' });
    return;
  }

  // decision === 'approve'
  await sbUpdate('testimonials', eqUuid('id', id), {
    status: 'approved',
    approved_at: new Date().toISOString(),
  });

  const thankYou = await sendThankYou({
    submissionId: row.id,
    authorName: row.author_name,
    quote: row.quote,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
  });

  let publish = null;
  try {
    publish = await runPublishBatch({ force: false });
  } catch (err) {
    // Approval + thank-you already succeeded; a publish failure here is
    // reported but doesn't roll back the approval — retry via
    // POST /api/admin-publish once the underlying issue is fixed.
    console.error('admin-review: auto-publish failed:', err.message);
  }

  res.status(200).json({ ok: true, status: 'approved', thankYou, publish });
});
