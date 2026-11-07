/** Shared by Proxy and route handlers; no database or Node-only imports. */
export function isSameOriginMutation(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const supplied = new URL(origin);
    const expected = new URL(process.env.APP_ORIGIN || request.url);
    // Next.js can normalize the development URL hostname to localhost.
    // Host is browser-controlled on the wire; forwarded host headers are never trusted.
    if (!process.env.APP_ORIGIN) {
      const host = request.headers.get("host");
      if (host) expected.host = host;
    }
    return ["http:", "https:"].includes(supplied.protocol)
      && supplied.origin === expected.origin && origin === supplied.origin;
  } catch {
    return false;
  }
}
