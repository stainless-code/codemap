import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bundled `templates/agents/` path — shared by `agents init` and
 * `application/*` live-fetch surfaces. Leaf module avoids
 * `application → agents-init → application` import cycles.
 */
export function resolveAgentsTemplateDir(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "templates",
    "agents",
  );
}
