// Demonstrates a richer call chain (createClient → setupTransport → openSocket
// → handshake) so `codemap impact` has depth > 1 to walk against, and a
// `@deprecated` method for the deprecated-symbols + SARIF / annotations recipes.

export interface ClientConfig {
  readonly baseUrl: string;
  timeout?: number;
}

export interface Transport {
  readonly socketUrl: string;
  readonly handshakeMs: number;
}

export function createClient(config?: ClientConfig) {
  const transport = setupTransport(
    config?.baseUrl ?? "https://api.example.com",
  );
  return { version: 1, config, transport };
}

export function setupTransport(baseUrl: string): Transport {
  const socketUrl = openSocket(baseUrl);
  const handshakeMs = handshake(socketUrl);
  return { socketUrl, handshakeMs };
}

export function openSocket(baseUrl: string): string {
  return baseUrl.replace(/^http/, "ws");
}

export function handshake(socketUrl: string): number {
  // pretend we measured something
  return socketUrl.length;
}

/**
 * @deprecated Use `createClient({ baseUrl })` directly. Kept as a fixture for
 * `deprecated-symbols` + `--format sarif` / `--format annotations` recipes.
 */
export function legacyClient() {
  return createClient();
}
