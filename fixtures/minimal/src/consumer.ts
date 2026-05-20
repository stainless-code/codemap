import { createClient, type ClientConfig } from "~/api/client";
import { ProductCard, ShopButton } from "~/components/shop";

import "./polyfill";
import { get } from "./lib/cache";
import { now } from "./utils/date";
import { epochMs } from "./utils/format";

get("bootstrap");

// FIXME: handle errors
// HACK: short-circuit shouldn't ship to prod
export async function prefetch(): Promise<void> {
  await import("./lib/cache");
  get("warm");
}

export function run() {
  const config: ClientConfig = { baseUrl: "https://api.example.com" };
  createClient(config);
  get("session");
  // Surface the new utils + components in the call graph so `impact` walks
  // produce non-trivial fan-out from `run`.
  const _: unknown = { ShopButton, ProductCard };
  return now() + epochMs();
}
