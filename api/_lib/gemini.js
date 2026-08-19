// Shared Gemini call, same request/response shape as api/chat.js. Kept as
// a one-shot helper (no conversation history) — chat.js's multi-turn
// history handling stays inline there since nothing else needs it.

const MODEL = 'gemini-3.6-flash'; // keep in sync with api/chat.js — see that file's comment on why this model
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Without this a stuck call rides the whole function duration and dies as a
// platform 504. Shorter than chat.js's 35s: this is a one-shot single-turn
// call with a smaller output budget, and it runs on the approve path where
// a slow email draft shouldn't hold up the response.
const TIMEOUT_MS = 30000;

// Returns the reply text, or throws — callers decide how to handle failure
// (e.g. notify-thankyou.js catches this and logs rather than blocking).
async function generateText({ systemPrompt, userText, maxOutputTokens = 300, temperature = 0.7 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          thinkingConfig: { thinkingLevel: 'low' },
          maxOutputTokens,
          temperature,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini API returned no text');
    }
    return text;
  } catch (err) {
    // Only reshape the timeout — everything above throws deliberately and
    // should reach the caller unchanged.
    if (err.name === 'AbortError') {
      throw new Error(`Gemini API timed out after ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { generateText };
