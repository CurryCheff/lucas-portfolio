// Fires the thank-you message on approval: one Gemini draft, sent out over
// both email (Resend) and WhatsApp (the local open-wa service). Called
// from admin-review.js's approve path only, after the DB write for the
// approval itself has already committed.
//
// SECURITY BOUNDARY (security-patterns.md rule 7): the string this module
// drafts via Gemini is passed ONLY to sendEmail/sendWhatsApp below. It is
// never returned to a caller that writes it to testimonial_submissions, and
// nothing here calls render-testimonial.js. Keep it that way — an
// AI-drafted note must never become the published testimonial text.

const gemini = require('./gemini');
const resend = require('./resend');
const whatsapp = require('./whatsapp');
const { sbUpdate } = require('./supabase');

const SYSTEM_PROMPT = `You draft short, warm thank-you messages on behalf of Overboard, a small software studio led by Lucas Musungo. A client just had their testimonial approved for publication on the Overboard portfolio site.

Write a brief, genuine thank-you (2-4 sentences) addressed to them by name. Mention that their testimonial has been reviewed and will appear on the site. Keep the tone warm but not gushing, and sound like a real person wrote it, not a template. Do not invent any details about the client's project beyond what's given. Sign off as Lucas.`;

async function draftMessage({ authorName, quote }) {
  const userText = `Client name: ${authorName}\nTheir testimonial: "${quote}"\n\nDraft the thank-you message now.`;
  return gemini.generateText({ systemPrompt: SYSTEM_PROMPT, userText, maxOutputTokens: 200 });
}

// Never throws — logs and returns a summary of what succeeded so the
// caller (admin-review.js) can include it in the response without ever
// having to wrap this call itself.
async function sendThankYou({ submissionId, authorName, quote, contactEmail, contactPhone }) {
  let message;
  try {
    message = await draftMessage({ authorName, quote });
  } catch (err) {
    console.error('notify-thankyou: Gemini draft failed:', err.message);
    return { email: false, whatsapp: false, error: 'Could not draft thank-you message' };
  }

  const result = { email: false, whatsapp: false };

  if (contactEmail) {
    try {
      await resend.sendEmail({
        to: contactEmail,
        subject: 'Thank you for your testimonial — Overboard',
        text: message,
      });
      result.email = true;
      await sbUpdate('testimonials', `id=eq.${submissionId}`, {
        thank_you_sent_email_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('notify-thankyou: email send failed:', err.message);
    }
  }

  if (contactPhone) {
    const waResult = await whatsapp.sendWhatsApp({ phone: contactPhone, message });
    if (waResult.ok) {
      result.whatsapp = true;
      try {
        await sbUpdate('testimonials', `id=eq.${submissionId}`, {
          thank_you_sent_whatsapp_at: new Date().toISOString(),
        });
      } catch (err) {
        // The WhatsApp message already sent — a failure to record the
        // timestamp shouldn't throw out of a function whose whole
        // contract is "never throws" (see the header comment above).
        console.error('notify-thankyou: failed to record whatsapp timestamp:', err.message);
      }
    } else {
      // Expected condition (machine off/tunnel down), not an error to
      // surface to the admin — logged for visibility only.
      console.log('notify-thankyou: whatsapp send skipped:', waResult.error);
    }
  }

  return result;
}

module.exports = { sendThankYou };
