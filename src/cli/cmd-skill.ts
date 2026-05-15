import { assembleAgentContent } from "../application/agent-content";
import type { AgentContentKind } from "../application/agent-content";

/**
 * `codemap skill` / `codemap rule` — print the bundled agent content
 * shipped with this installed codemap version. Pointer files written by
 * `agents init` direct agents here so package upgrades carry today's
 * content without re-running init.
 *
 * Both kinds assemble from `templates/agent-content/<kind>/*.md` so
 * future bullets can add auto-generated sections (recipes, schema) by
 * dropping new section files alongside the hand-written ones.
 */
export type { AgentContentKind };

export function printAgentContentCmdHelp(kind: AgentContentKind): void {
  const verb = kind;
  const source = `templates/agent-content/${kind}/*.md (assembled)`;
  console.log(`Usage: codemap ${verb}

Prints the full ${kind} markdown bundled with the installed codemap
package (source: ${source}). Pointer files written by
\`codemap agents init\` redirect agents here so upgrading codemap
auto-refreshes the served content — no \`agents init\` re-run needed.

Examples:
  codemap ${verb}
  codemap ${verb} > .agents/${kind === "skill" ? "skills/codemap/SKILL" : "rules/codemap"}.full.md
`);
}

export function runAgentContentCmd(kind: AgentContentKind): void {
  process.stdout.write(assembleAgentContent(kind));
}
