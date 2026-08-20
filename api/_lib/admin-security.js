// Shared access to the single-row admin_security table: session-epoch
// revocation (what "log out" actually does — see admin-token.js) and
// DB-backed login-attempt throttling. Unlike rate-limit.js's in-memory
// Map, this survives cold starts and is shared across concurrent Vercel
// instances, since it lives in Postgres. State is mutated only via the
// three RPCs the migration defines, so increments are atomic rather than
// a read-modify-write race between concurrent requests.

const { sbSelect, rpc } = require('./supabase');

async function getSecurityRow() {
  const rows = await sbSelect('admin_security', 'select=session_epoch,failed_attempts,locked_until&limit=1');
  const row = rows && rows[0];
  if (!row || !Number.isInteger(row.session_epoch)) {
    throw new Error('admin_security row missing or malformed — was the migration applied?');
  }
  return row;
}

// Milliseconds remaining on an active lockout, or 0 if not locked.
function lockoutRemainingMs(security) {
  if (!security || !security.locked_until) return 0;
  const remaining = new Date(security.locked_until).getTime() - Date.now();
  return remaining > 0 ? remaining : 0;
}

async function registerFailedLogin() {
  await rpc('admin_register_failed_login');
}

async function registerSuccessfulLogin() {
  await rpc('admin_reset_failed_login');
}

// Invalidates every outstanding admin token by incrementing session_epoch.
// This is the entire mechanism behind a working logout — see
// admin-token.js's header comment for how tokens embed and check it.
async function bumpSessionEpoch() {
  return rpc('admin_bump_session_epoch');
}

module.exports = { getSecurityRow, lockoutRemainingMs, registerFailedLogin, registerSuccessfulLogin, bumpSessionEpoch };
