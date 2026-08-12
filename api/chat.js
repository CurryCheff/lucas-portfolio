// Vercel serverless function — proxies chat messages to Gemini so the API
// key never reaches the browser. Set GEMINI_API_KEY in the Vercel project's
// environment variables (Project Settings -> Environment Variables).
//
// CommonJS on purpose: package.json has no "type": "module", so this file
// is loaded as CommonJS by Node at runtime — matches the rest of the repo
// without touching package.json.

const MODEL = 'gemini-2.5-flash'; // change here if Google renames/deprecates this model
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `You are the assistant on Overboard's portfolio site — a small software studio led by Lucas Musungo.

About Overboard:
- Led by Lucas Musungo, a software engineer building full-stack web applications for real businesses and institutions.
- Tech stack — Frontend: JavaScript, React, Next.js, Tailwind CSS. Backend/Infra: Supabase, Vercel, AI/agent integrations, AI chatbots.

Real projects (only mention these — do not invent others):
- Chicken Slice: multi-page brand site for a Zimbabwean chicken restaurant chain, with a menu/product catalog and online ordering/cart. Built in 2-4 weeks. Client work.
- Alma Institute: multi-page website for a private school in Mutare, Zimbabwe, including admissions and enrollment information. Built in 1-2 weeks. Client work.
- Flame Grill Express: menu browsable by category, full cart and checkout flow, location/hours page. Built in under a week. This is a personal/practice build, NOT client work — say so if asked.

Contact:
- Email: musungolucas@gmail.com
- WhatsApp: Lucas and Tedd are both reachable via the WhatsApp buttons in the contact section of this page.

How to behave:
- Answer questions about Overboard, Lucas, the tech stack, and the projects above directly and helpfully.
- Keep replies concise — a few sentences, not essays.
- If someone signals interest in getting something built, ask at most 1-2 light questions (what kind of project, rough timeline) and then point them to email or WhatsApp to continue — don't try to close the deal yourself, just hand off warmly.
- If asked about something you don't know or that isn't covered here, say so honestly rather than guessing or inventing details.
- Never claim outcomes, results, or client satisfaction that aren't stated above.`;

// Very small in-memory rate limiter. Resets on cold start and doesn't
// coordinate across concurrent instances — a first-pass deterrent
// proportionate to a low-traffic portfolio site, not a real defense.
// Upgrade path if abuse becomes real: Upstash Redis or Vercel's own
// rate limiting.
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const requestLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';

  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many messages — please wait a few minutes and try again.' });
    return;
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages is required' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set');
    res.status(500).json({ error: 'Chat is not configured yet.' });
    return;
  }

  // Cap history sent + individual message length to bound cost.
  const contents = messages.slice(-20).map((m) => ({
    role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(m.content || '').slice(0, 2000) }],
  }));

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.7,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      res.status(502).json({ error: 'The AI service is unavailable right now — try again shortly, or reach out directly.' });
      return;
    }

    const data = await geminiRes.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      res.status(502).json({ error: 'No response from the AI service — try again, or reach out directly.' });
      return;
    }

    res.status(200).json({ reply });
  } catch (err) {
    console.error('Chat handler error:', err);
    res.status(500).json({ error: 'Something went wrong — try again, or reach out directly.' });
  }
};
