function isIpv4Loopback(host: string): boolean {
  if (!host.startsWith("127.")) return false;
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

/** Hosts safe to bind without mandatory auth (loopback only). */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || isIpv4Loopback(h);
}

/**
 * `server.listen` expects unbracketed IPv6 literals (`::1`, not `[::1]` —
 * Node rejects the bracketed form with ENOTFOUND).
 */
export function normalizeServeBindHost(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

/** Error message when a non-loopback bind lacks a token; `undefined` when OK. */
export function serveBindTokenRequiredMessage(
  host: string,
  token: string | undefined,
): string | undefined {
  if (
    !isLoopbackHost(host) &&
    (token === undefined || token.trim().length === 0)
  ) {
    return (
      "codemap serve: non-loopback bind requires --token (use a long random secret). " +
      "Example: codemap serve --host 0.0.0.0 --token $(openssl rand -hex 32)"
    );
  }
  return undefined;
}

/** Fail fast before `listen` when bind policy is violated. */
export function assertServeBindRequiresToken(
  host: string,
  token: string | undefined,
): void {
  const message = serveBindTokenRequiredMessage(host, token);
  if (message !== undefined) throw new Error(message);
}
