# whatsapp-service

> **Status: paused, not working yet (as of 2026-08-15).** See "Known issue" below before picking this back up.

A local open-wa companion process for the testimonials thank-you flow. This is deliberately **not** deployed to Vercel — it holds a real, logged-in WhatsApp Web session via a headless browser, which a stateless serverless function can't do. It runs on your own machine and the main site calls it over HTTPS.

## First-time setup

```bash
cd whatsapp-service
npm install
cp .env.example .env
openssl rand -hex 32   # paste the output into .env as WA_SHARED_SECRET
```

Set the **same** value in the main repo's `.env` / Vercel env vars as `WHATSAPP_SHARED_SECRET`.

## Running it

```bash
npm start
```

On first run, a Chromium window (or a QR code printed to the terminal, depending on open-wa's config) will ask you to scan a QR code from WhatsApp on your phone (WhatsApp → Linked Devices → Link a Device). After that, the session persists in `session/` (gitignored) and future starts won't need a re-scan — until WhatsApp logs the session out on its own, which does happen occasionally.

**This only works while your machine is on, awake, and this process is running.** If the approve flow's WhatsApp send fails, that's the expected fallback for "the machine is off" — the thank-you email still goes out either way, and the testimonial still publishes; only the WhatsApp message is skipped.

## Exposing it to Vercel

Vercel's serverless functions need a stable HTTPS URL to reach this process — your machine isn't on a public IP by default. Use a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/):

```bash
brew install cloudflare/cloudflare/cloudflared
cloudflared tunnel login
cloudflared tunnel create overboard-whatsapp
cloudflared tunnel route dns overboard-whatsapp wa.<your-domain>
cloudflared tunnel run --url http://localhost:8787 overboard-whatsapp
```

Then set, in the main repo's Vercel env vars:

```
WHATSAPP_SERVICE_URL=https://wa.<your-domain>/send
WHATSAPP_SHARED_SECRET=<same value as WA_SHARED_SECRET above>
```

## Keeping it running persistently

This process needs to survive terminal close and restart on crash. Either:

**pm2** (cross-platform):
```bash
npm install -g pm2
pm2 start server.js --name whatsapp-service --cwd whatsapp-service
pm2 save
pm2 startup   # follow the printed instructions to survive a reboot
```

**launchd** (macOS, survives reboots without extra steps): create a plist in `~/Library/LaunchAgents/` pointing at `node whatsapp-service/server.js` with `KeepAlive: true`. Ask for a ready-made plist if you want one written for your exact paths.

## Known issue (2026-08-15)

`server.js` currently does not successfully log in. What we found:

- `@open-wa/wa-automate@4.76.0` (the last stable release, published **February 2025** — over a year stale) hangs during startup waiting for a WhatsApp-internal `window.Debug` object that never appears, regardless of `headless`/`useChrome` settings. Confirmed via a bare, standalone Puppeteer session (no open-wa) that the actual WhatsApp Web QR login page loads correctly in ~5 seconds — so this is an open-wa injection/compatibility issue, not a network, Chrome, or WhatsApp-availability problem.
- The only actively-maintained line is `5.0.0-alpha.*` (latest alpha as of this writing: `5.0.0-alpha.8`, published 2026-07-08). It's a ground-up rewrite — `"type": "module"`, described as a "WhatsApp automation CLI and API server" rather than an importable `create()`-style library — with no real documentation yet. `package.json` in this folder is currently pinned to it, but `server.js`'s `create()`-based integration has **not** been rewritten or tested against it — the two are not yet compatible.

**Before resuming:** either (a) rewrite `server.js` against whatever the v5 alpha's actual API turns out to be (check https://openwa.dev and the installed package's `dist/cli.cjs` / `dist/index.cjs` for current usage — this may have changed further by the time you return to this), or (b) reconsider the WhatsApp Cloud API (Meta's official Business API) as a more stable alternative — it was the original recommendation over open-wa specifically because it doesn't depend on reverse-engineering WhatsApp Web's internals, and it fits this project's serverless architecture (plain HTTPS calls, no persistent browser/session) better than open-wa ever did either way.

Everything else in this repo (testimonial collection, GitHub publish flow, Resend thank-you emails) works independently of this piece.

## Security notes

- `WA_SHARED_SECRET` is the only thing gating `/send` — treat it like a password. Don't commit `.env`.
- This process should not be reachable except through the tunnel + shared secret — don't port-forward `WA_PORT` directly.
- The `session/` directory holds your live WhatsApp session; treat it like a credential (it's gitignored, and should never be committed or shared).
