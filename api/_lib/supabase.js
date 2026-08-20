// Thin PostgREST fetch wrapper — deliberately not the @supabase/supabase-js
// SDK, to keep the api/ layer dependency-free like the rest of this repo
// (see api/chat.js's header comment). The service-role key is read here
// and only here; every endpoint goes through these functions rather than
// building its own fetch calls, so there's one place that sets the
// required headers correctly.
//
// FAILS CLOSED: throws immediately if SUPABASE_URL or
// SUPABASE_SERVICE_ROLE_KEY is missing, rather than silently making
// requests that Supabase will reject (or worse, that resolve against the
// wrong project because of a typo'd URL).

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return { url: url.replace(/\/+$/, ''), key };
}

function headers(extra) {
  const { key } = config();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// `query` is a raw PostgREST query string, e.g. "status=eq.approved&order=created_at.desc"
async function sbSelect(table, query = '') {
  const { url } = config();
  const res = await fetch(`${url}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Supabase select ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbInsert(table, rows) {
  const { url } = config();
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase insert ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// `query` selects which rows to patch, e.g. "id=eq.<uuid>" or "id=in.(<a>,<b>)"
async function sbUpdate(table, query, patch) {
  const { url } = config();
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase update ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Calls a Postgres function exposed via PostgREST's /rpc/ route. Used for
// the admin_security functions (see the migration) — increments there
// need to be atomic, not a read-modify-write from this layer.
async function rpc(fnName, params = {}) {
  const { url } = config();
  const res = await fetch(`${url}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Supabase rpc ${fnName} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// --- Validated PostgREST filter builders ---
//
// sbSelect/sbUpdate take a raw query string and never encode it. Building
// that string by hand from user input is exactly how admin-review.js's
// `id=eq.${id}` became injectable (an `&` adds query params, a `#`
// truncates the query) — these throw instead of producing a filter for
// anything that isn't the shape it claims to be. Callers should still
// validate user input explicitly and return a 400 themselves; treat a
// throw from these as "this should never happen" (a bug, not bad input),
// which is exactly what the api/_lib/http.js `handler()` wrapper's 500
// backstop is for.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function eqUuid(column, value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Error(`${column} must be a UUID`);
  }
  return `${column}=eq.${value}`;
}

function eqInt(column, value) {
  if (!Number.isInteger(value)) {
    throw new Error(`${column} must be an integer`);
  }
  return `${column}=eq.${value}`;
}

function inUuids(column, values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${column} in-list must be a non-empty array`);
  }
  for (const value of values) {
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      throw new Error(`${column} in-list contains a non-UUID value`);
    }
  }
  return `${column}=in.(${values.map((value) => `"${value}"`).join(',')})`;
}

module.exports = { sbSelect, sbInsert, sbUpdate, rpc, eqUuid, eqInt, inUuids, UUID_RE };
