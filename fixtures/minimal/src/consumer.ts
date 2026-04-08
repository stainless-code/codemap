import { createClient, type ClientConfig } from "~/api/client";

import { now } from "./utils/date";

// FIXME: handle errors
export function run() {
  const config: ClientConfig = { baseUrl: "https://api.example.com" };
  createClient(config);
  return now();
}
