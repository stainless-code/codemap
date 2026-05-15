import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAgentsTemplateDir } from "../agents-init";

/**
 * `codemap skill` / `codemap rule` — print the bundled agent content
 * shipped with this installed codemap version. Pointer files written by
 * `agents init` direct agents here so package upgrades carry today's
 * content without re-running init (see `docs/plans/...`).
 */
export type AgentContentKind = "skill" | "rule";

export function printAgentContentCmdHelp(kind: AgentContentKind): void {
  const verb = kind;
  const target =
    kind === "skill"
      ? "templates/agents/skills/codemap/SKILL.md"
      : "templates/agents/rules/codemap.md";
  console.log(`Usage: codemap ${verb}

Prints the full ${kind} markdown bundled with the installed codemap
package (sourced from ${target}). Pointer files written by
\`codemap agents init\` redirect agents here so upgrading codemap
auto-refreshes the served content — no \`agents init\` re-run needed.

Examples:
  codemap ${verb}
  codemap ${verb} > .agents/${kind === "skill" ? "skills/codemap/SKILL" : "rules/codemap"}.full.md
`);
}

export function resolveAgentContentPath(kind: AgentContentKind): string {
  const root = resolveAgentsTemplateDir();
  return kind === "skill"
    ? join(root, "skills", "codemap", "SKILL.md")
    : join(root, "rules", "codemap.md");
}

export function runAgentContentCmd(kind: AgentContentKind): void {
  const path = resolveAgentContentPath(kind);
  const text = readFileSync(path, "utf8");
  process.stdout.write(text);
}
