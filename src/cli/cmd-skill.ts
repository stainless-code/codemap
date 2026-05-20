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

export type AgentContentRest =
  | { kind: "help"; verb: AgentContentKind }
  | { kind: "run"; verb: AgentContentKind }
  | { kind: "error"; message: string };

/** Parse `codemap skill` / `codemap rule` argv after bootstrap strips global flags. */
export function parseAgentContentRest(rest: string[]): AgentContentRest {
  const verb = rest[0];
  if (verb !== "skill" && verb !== "rule") {
    throw new Error(
      `parseAgentContentRest: expected first token skill|rule, got ${String(verb)}`,
    );
  }
  const args = rest.slice(1);
  if (args.length === 0) return { kind: "run", verb };
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { kind: "help", verb };
  }
  const bad = args.find((a) => a !== "--help" && a !== "-h");
  if (bad !== undefined) {
    return {
      kind: "error",
      message: `codemap ${verb}: unexpected argument "${bad}". Run \`codemap ${verb} --help\` for usage.`,
    };
  }
  return {
    kind: "error",
    message: `codemap ${verb}: unexpected extra arguments. Run \`codemap ${verb} --help\` for usage.`,
  };
}

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
