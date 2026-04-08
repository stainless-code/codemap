export interface ClientConfig {
  readonly baseUrl: string;
  timeout?: number;
}

export function createClient(config?: ClientConfig) {
  return { version: 1, config };
}
