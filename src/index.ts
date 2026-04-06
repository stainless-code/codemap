import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./cli";

export * from "./api";
export {
  defineConfig,
  type CodemapUserConfig,
  type ResolvedCodemapConfig,
} from "./config";

function isMainModule(): boolean {
  if (
    typeof import.meta !== "undefined" &&
    (import.meta as { main?: boolean }).main
  ) {
    return true;
  }
  const arg1 = process.argv[1];
  if (!arg1) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(arg1);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
