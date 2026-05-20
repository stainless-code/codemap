import { createClient, type ClientConfig } from "~/api/client";
import { ApiCache } from "~/api/decorated";
import { ProductCard, ShopButton } from "~/components/shop";

import "./polyfill";
import { get } from "./lib/cache";
import { labyrinth } from "./lib/complexity-fixture";
import { now } from "./utils/date";
import { epochMs } from "./utils/format";

get("bootstrap");

// FIXME: handle errors
// HACK: short-circuit shouldn't ship to prod
export async function prefetch(): Promise<void> {
  for (const _key of ["warm"] as const) {
    await import("./lib/cache");
  }
  get("warm");
}

export function run() {
  const config: ClientConfig = { baseUrl: "https://api.example.com" };
  createClient(config);
  get("session");
  const _: unknown = { ShopButton, ProductCard };
  optionalPing({ ping: () => now() });
  new ApiCache();
  spreadLog("a", "b", "c");
  return now() + epochMs() + labyrinth(3);
}

function optionalPing(target?: { ping?: () => void }) {
  target?.ping?.();
}

function spreadLog(...items: string[]): void {
  console.debug(...items);
}
