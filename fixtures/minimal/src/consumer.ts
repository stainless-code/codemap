import { createClient } from "~/api/client";

import { now } from "./utils/date";

// FIXME: handle errors
export function run() {
  createClient();
  return now();
}
