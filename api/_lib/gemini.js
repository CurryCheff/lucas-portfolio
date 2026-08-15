// Shared Gemini call, same request/response shape as api/chat.js. Kept as
// a one-shot helper (no conversation history) — chat.js's multi-turn
// history handling stays inline there since nothing else needs it.

const MODEL = 'gemini-3.6-flash'; // keep in sync with api/chat.js — see that file's comment on why this model
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Returns the reply text, or throws — callers decide how to handle failure
// (e.g. notify-thankyou.js catches this and logs rather than blocking).
async function generateText({ systemPrompt, userText, maxOutputTokens = 300, temperature = 0.7 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
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
}

module.exports = { generateText };
