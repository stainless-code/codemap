import { createClient, type ClientConfig } from "~/api/client";
import { ProductCard, ShopButton } from "~/components/shop";

import { get } from "./lib/cache";
import { now } from "./utils/date";
import { epochMs } from "./utils/format";

// FIXME: handle errors
// HACK: short-circuit shouldn't ship to prod
export function run() {
  const config: ClientConfig = { baseUrl: "https://api.example.com" };
  createClient(config);
  get("session");
  // Surface the new utils + components in the call graph so `impact` walks
  // produce non-trivial fan-out from `run`.
  const _: unknown = { ShopButton, ProductCard };
  return now() + epochMs();
}
