import { createClient } from "~/api/client";

import { now } from "./utils/date";

export function run() {
  createClient();
  return now();
}
