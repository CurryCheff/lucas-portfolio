// Fetch wrapper to the local open-wa companion service (whatsapp-service/),
// reached over a Cloudflare Tunnel since it runs on a machine we don't
// control the uptime of. Deliberately fail-soft: returns { ok, error }
// instead of throwing, so a forgotten try/catch at a call site can't turn
// "the machine at home is asleep" into a 500 on the approve endpoint.
// "unreachable" is an expected, routine condition here, not an incident.

const TIMEOUT_MS = 5000;

async function sendWhatsApp({ phone, message }) {
  const url = process.env.WHATSAPP_SERVICE_URL;
  const secret = process.env.WHATSAPP_SHARED_SECRET;
  if (!url || !secret) {
    return { ok: false, error: 'WHATSAPP_SERVICE_URL / WHATSAPP_SHARED_SECRET is not set' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shared-secret': secret,
      },
      body: JSON.stringify({ phone, message }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, error: `whatsapp-service responded ${res.status}: ${await res.text()}` };
    }
    const data = await res.json();
    return data && data.ok ? { ok: true } : { ok: false, error: (data && data.error) || 'unknown whatsapp-service error' };
  } catch (err) {
    // Covers: tunnel down, machine asleep, timeout — all the same "try
    // again whenever it's back up" outcome from this endpoint's view.
    return { ok: false, error: `whatsapp-service unreachable: ${err.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendWhatsApp };
