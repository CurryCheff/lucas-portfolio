// Vercel serverless function — public endpoint, gated by a signed submit
// token (not a login). Inserts the full testimonial row in one shot —
// public.testimonials requires client_name/author_name/quote/consented_at
// together (NOT NULL), so there's no separate "link issued" pre-row.
//
// Replay protection: link_nonce is UNIQUE on the table. A second
// submission through the same link hits a Postgres unique-violation
// (23505) on insert, which is treated as a SOFT SUCCESS — the person did
// nothing wrong by clicking submit twice — not overwritten, not an error.

const crypto = require('crypto');
const { verifySubmitToken } = require('./_lib/submit-token');
const { sbInsert } = require('./_lib/supabase');
const { getClientIp, createRateLimiter } = require('./_lib/rate-limit');

const isRateLimited = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 10 });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clamp(str, min, max) {
  const trimmed = String(str || '').trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip)).digest('hex');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (isRateLimited(getClientIp(req))) {
    res.status(429).json({ error: 'Too many attempts — please wait a few minutes and try again.' });
    return;
  }

  const { token, quote, authorName, authorRole, phone, email, consent } = req.body || {};

  const claims = verifySubmitToken(token);
  if (!claims) {
    res.status(401).json({ error: 'This link is invalid or has expired.' });
    return;
  }

  if (consent !== true) {
    res.status(400).json({ error: 'Please confirm you consent to this testimonial being published.' });
    return;
  }

  const cleanQuote = clamp(quote, 20, 600);
  const cleanAuthorName = clamp(authorName, 2, 60);
  if (!cleanQuote) {
    res.status(400).json({ error: 'Testimonial must be between 20 and 600 characters.' });
    return;
  }
  if (!cleanAuthorName) {
    res.status(400).json({ error: 'Name must be between 2 and 60 characters.' });
    return;
  }
  const cleanAuthorRole = authorRole ? clamp(authorRole, 1, 80) : null;
  const cleanEmail = email ? String(email).trim().slice(0, 200) : null;
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
    res.status(400).json({ error: "That email address doesn't look right." });
    return;
  }
  const cleanPhone = phone ? String(phone).trim().slice(0, 40) : null;

  const nowIso = new Date().toISOString();

  try {
    await sbInsert('testimonials', [
      {
        client_name: claims.clientLabel,
        link_nonce: claims.nonce,
        link_issued_at: new Date(claims.issuedAt).toISOString(),
        author_name: cleanAuthorName,
        author_role: cleanAuthorRole,
        quote: cleanQuote,
        contact_phone: cleanPhone,
        contact_email: cleanEmail,
        consented_at: nowIso,
        submitter_ip_hash: hashIp(getClientIp(req)),
      },
    ]);
  } catch (err) {
    if (/23505|duplicate key/i.test(err.message)) {
      // Already submitted through this exact link — soft success.
      res.status(200).json({ ok: true, alreadySubmitted: true });
      return;
    }
    console.error('submit: insert failed:', err.message);
    res.status(500).json({ error: 'Something went wrong — try again shortly.' });
    return;
  }

  res.status(200).json({ ok: true });
};
