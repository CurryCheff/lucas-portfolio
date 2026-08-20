// Local harness reproducing enough of Vercel's routing to run this repo's
// static pages + serverless functions without the Vercel CLI:
//   - non-/api paths  -> static files, checked at the repo root first,
//                        then under public/ (mirrors Vite's dev-time merge
//                        of the project root and its publicDir)
//   - /api/<name>     -> api/<name>.js, with req.body parsed, req.query
//                        populated, and a res.status().json() shim
//
// Run with: node --env-file=.env dev-server.js
//
// Handlers are re-required per request so edits take effect without a
// restart. This busts the require-cache for the WHOLE api/ directory, not
// just the handler file being called — otherwise edits to shared
// api/_lib/* helpers are invisible until a restart. The in-memory rate
// limiters therefore reset each request here; that's a property of this
// harness, not of production. Set KEEP_MODULE_CACHE=1 to disable this and
// test a limiter.
//
// This does NOT run the Vite dev server for the main site — use `npm run
// dev` for that. This harness exists specifically to exercise the
// testimonials admin tool (public/admin/, public/submit.html, api/*.js)
// against real or local env vars without needing `vercel dev`.

const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 5175);
const KEEP_CACHE = process.env.KEEP_MODULE_CACHE === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function safeResolve(base, reqPath) {
  const resolved = path.join(base, path.normalize(reqPath).replace(/^(\.\.[/\\])+/, ''));
  return resolved.startsWith(base) ? resolved : null;
}

function serveStatic(reqPath, res) {
  const candidates = [safeResolve(ROOT, reqPath), safeResolve(PUBLIC_DIR, reqPath)].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(candidate)] || 'application/octet-stream' });
      fs.createReadStream(candidate).pipe(res);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(`Not found: ${reqPath}`);
}

function handleApi(name, query, req, res) {
  const modPath = path.join(ROOT, 'api', `${name}.js`);
  if (!name || name.includes('/') || !fs.existsSync(modPath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `No such function: ${name}` }));
    return;
  }

  let chunks = '';
  req.on('data', (chunk) => {
    chunks += chunk;
    if (chunks.length > 1e6) req.destroy();
  });

  req.on('end', async () => {
    try {
      req.body = chunks ? JSON.parse(chunks) : {};
    } catch (err) {
      req.body = {};
    }
    req.query = Object.fromEntries(query);

    const shim = {
      _status: 200,
      _headers: {},
      headersSent: false,
      setHeader(name, value) {
        this._headers[name] = value;
      },
      status(code) {
        this._status = code;
        return this;
      },
      json(obj) {
        res.writeHead(this._status, { 'Content-Type': 'application/json', ...this._headers });
        res.end(JSON.stringify(obj));
        this.headersSent = true;
      },
    };

    try {
      if (!KEEP_CACHE) {
        const apiDir = path.join(ROOT, 'api');
        for (const key of Object.keys(require.cache)) {
          if (key.startsWith(apiDir)) delete require.cache[key];
        }
      }
      const handler = require(modPath);
      await handler(req, shim);
    } catch (err) {
      console.error(`[api/${name}]`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal error — see server logs' }));
      }
    }
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      handleApi(pathname.slice(5), url.searchParams, req, res);
      return;
    }

    if (pathname.endsWith('/')) pathname += 'index.html';
    serveStatic(pathname, res);
  })
  .listen(PORT, () => {
    const flag = (name) => (process.env[name] ? 'set' : 'MISSING');
    console.log(`dev server -> http://localhost:${PORT}`);
    console.log(`  admin dashboard -> http://localhost:${PORT}/admin/`);
    console.log(`  submit form     -> http://localhost:${PORT}/submit.html?t=<token>`);
    console.log('');
    console.log('  env vars (presence only):');
    [
      'ADMIN_PASSWORD',
      'ADMIN_SESSION_SECRET',
      'SUBMIT_LINK_SECRET',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'GITHUB_TOKEN',
      'GEMINI_API_KEY',
      'RESEND_API_KEY',
      'WHATSAPP_SERVICE_URL',
      'WHATSAPP_SHARED_SECRET',
    ].forEach((name) => console.log(`    ${name.padEnd(26)} ${flag(name)}`));
  });
