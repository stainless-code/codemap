import { createClient } from "~/api/client";

/** Boundary-violation fixture: `src/components/**` → `src/api/**`. */
export function ApiBridge() {
  createClient();
  return null;
}
