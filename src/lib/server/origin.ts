/**
 * CSRF guard for cookie-authenticated, state-changing requests.
 * Browsers always send an Origin header on cross-site POST/PATCH/DELETE; if it names a different
 * host than the one being called, the request did not come from our own pages.
 * Requests without an Origin header (curl, server-to-server) are not browser CSRF and are allowed.
 */
export function isSameOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}
