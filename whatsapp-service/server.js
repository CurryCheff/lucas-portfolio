// Local open-wa companion process. NOT deployed to Vercel — this needs a
// persistent Node process holding a real, logged-in WhatsApp Web session
// (via a headless browser), which serverless functions can't provide.
//
// Run persistently (pm2 or a launchd plist — see README.md), expose it to
// the internet via a Cloudflare Tunnel, and point the main site's
// WHATSAPP_SERVICE_URL at the tunnel's hostname + /send.
//
// FAILS CLOSED: refuses to start if WA_SHARED_SECRET is missing or short —
// an unset secret must never mean "anyone can send WhatsApp messages
// through this service."

const http = require('http');
const { create } = require('@open-wa/wa-automate');

const PORT = Number(process.env.WA_PORT || 8787);
const SECRET = process.env.WA_SHARED_SECRET;
const MIN_SECRET_LENGTH = 32;

if (typeof SECRET !== 'string' || SECRET.length < MIN_SECRET_LENGTH) {
  throw new Error('WA_SHARED_SECRET is not set (or is shorter than 32 chars) — generate one with `openssl rand -hex 32`');
}

// Normalizes a loosely-formatted phone number into WhatsApp's expected
// chat id: digits only, country code included, no leading +/0.
function toChatId(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  return `${digits}@c.us`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

create({
  sessionId: 'overboard-testimonials',
  multiDevice: true,
  headless: process.env.WA_HEADLESS !== 'false', // set WA_HEADLESS=false for the first-run QR scan if headless hangs loading WA Web
  useChrome: true, // Puppeteer's bundled Chromium hangs loading WA Web on some versions — use the real installed Chrome instead
  qrTimeout: 0, // wait indefinitely on first run for the QR scan
}).then((client) => {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/send') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not found' }));
      return;
    }

    const providedSecret = req.headers['x-shared-secret'];
    if (providedSecret !== SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
      return;
    }

    const chatId = toChatId(body.phone);
    const message = String(body.message || '').trim();
    if (!chatId || !message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'phone and message are required' }));
      return;
    }

    try {
      await client.sendText(chatId, message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error('[whatsapp-service] sendText failed:', err);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Failed to send WhatsApp message' }));
    }
  });

  server.listen(PORT, () => {
    console.log(`whatsapp-service listening on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('[whatsapp-service] failed to start open-wa client:', err);
  process.exit(1);
});
