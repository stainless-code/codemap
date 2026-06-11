/** Hosts safe to bind without mandatory auth (loopback only). */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

/** Error message when a non-loopback bind lacks a token; `undefined` when OK. */
export function serveBindTokenRequiredMessage(
  host: string,
  token: string | undefined,
): string | undefined {
  if (!isLoopbackHost(host) && (token === undefined || token.length === 0)) {
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
