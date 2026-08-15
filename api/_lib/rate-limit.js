// Shared version of the in-memory per-IP limiter originally inlined in
// api/chat.js. Resets on cold start and doesn't coordinate across
// concurrent instances — a first-pass deterrent proportionate to a
// low-traffic portfolio site, not a real defense. Upgrade path if abuse
// becomes real: Upstash Redis or Vercel's own rate limiting.

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  return (
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// Each call site gets its own Map so a burst on /api/submit can't eat a
// caller's /api/chat quota or vice versa.
function createRateLimiter({ windowMs = 5 * 60 * 1000, max = 10 } = {}) {
  const requestLog = new Map();
  return function isRateLimited(ip) {
    const now = Date.now();
    const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < windowMs);
    timestamps.push(now);
    requestLog.set(ip, timestamps);
    return timestamps.length > max;
  };
}

module.exports = { getClientIp, createRateLimiter };
