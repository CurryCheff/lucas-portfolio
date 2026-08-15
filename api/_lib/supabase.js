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

module.exports = { sbSelect, sbInsert, sbUpdate };
