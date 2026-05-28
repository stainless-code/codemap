import { readFileSync } from "node:fs";

import { z } from "zod";

import {
  batchItemSchema,
  handleQueryBatch,
} from "../application/tool-handlers";
import type { QueryBatchArgs } from "../application/tool-handlers";
import type { GroupByMode } from "../group-by";
import { GROUP_BY_MODES, isGroupByMode } from "../group-by";
import { getProjectRoot } from "../runtime";
import { bootstrapCodemap } from "./bootstrap-codemap";
import { readJsonFromStdin } from "./cmd-resource";
import { emitToolResult } from "./emit-tool-result";

interface QueryBatchOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  compact: boolean;
}

export function printQueryBatchCmdHelp(): void {
  console.log(`Usage: codemap query batch [--stdin | --file <path>] [--summary] [--changed-since <ref>] [--group-by owner|directory|package] [--compact]

Run N read-only SQL statements in one bootstrap. Same payload as the MCP
\`query_batch\` tool / HTTP \`POST /tool/query_batch\`.

Input (required — pick one):
  --stdin               JSON from stdin.
  --file <path>         JSON file.

JSON shapes (both accepted):
  { "statements": [ "SELECT …", { "sql": "…", "summary": true }, … ],
    "summary"?: bool, "changed_since"?: string, "group_by"?: string }
  [ "SELECT …", … ]     — batch-wide flags apply from CLI options.

Flags:
  --summary             Batch-wide summary default for bare string items.
  --changed-since <ref> Batch-wide changed_since default.
  --group-by <mode>     Batch-wide group_by (${GROUP_BY_MODES.join(" | ")}).
  --compact             Minify JSON output.
  --help, -h            Show this help.

Examples:
  echo '{"statements":["SELECT 1"]}' | codemap query batch --stdin
  codemap query batch --file queries.json --summary --compact
`);
}

export function parseQueryBatchRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      stdin: boolean;
      filePath: string | undefined;
      summary: boolean | undefined;
      changedSince: string | undefined;
      groupBy: GroupByMode | undefined;
      compact: boolean;
    } {
  if (rest[0] !== "query" || rest[1] !== "batch") {
    throw new Error("parseQueryBatchRest: expected query batch");
  }

  let stdin = false;
  let filePath: string | undefined;
  let summary: boolean | undefined;
  let changedSince: string | undefined;
  let groupBy: GroupByMode | undefined;
  let compact = false;

  for (let i = 2; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--stdin") {
      stdin = true;
      continue;
    }
    if (a === "--file") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) {
        return {
          kind: "error",
          message: 'codemap query batch: "--file" requires a path.',
        };
      }
      filePath = v;
      i++;
      continue;
    }
    if (a === "--summary") {
      summary = true;
      continue;
    }
    if (a === "--changed-since") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) {
        return {
          kind: "error",
          message: 'codemap query batch: "--changed-since" requires a git ref.',
        };
      }
      changedSince = v;
      i++;
      continue;
    }
    if (a === "--group-by") {
      const v = rest[i + 1];
      if (v === undefined || !isGroupByMode(v)) {
        return {
          kind: "error",
          message: `codemap query batch: "--group-by" must be one of: ${GROUP_BY_MODES.join(", ")}.`,
        };
      }
      groupBy = v;
      i++;
      continue;
    }
    if (a === "--compact") {
      compact = true;
      continue;
    }
    return {
      kind: "error",
      message: `codemap query batch: unknown option "${a}". Run codemap query batch --help for usage.`,
    };
  }

  if (!stdin && filePath === undefined) {
    return {
      kind: "error",
      message:
        "codemap query batch: pass --stdin or --file. Run codemap query batch --help for usage.",
    };
  }
  if (stdin && filePath !== undefined) {
    return {
      kind: "error",
      message:
        "codemap query batch: --stdin and --file are mutually exclusive.",
    };
  }

  return {
    kind: "run",
    stdin,
    filePath,
    summary,
    changedSince,
    groupBy,
    compact,
  };
}

function parseBatchInput(
  raw: unknown,
  cliDefaults: {
    summary?: boolean | undefined;
    changedSince?: string | undefined;
    groupBy?: GroupByMode | undefined;
  },
): QueryBatchArgs | { error: string } {
  let body: unknown = raw;
  if (Array.isArray(raw)) {
    body = {
      statements: raw,
      summary: cliDefaults.summary,
      changed_since: cliDefaults.changedSince,
      group_by: cliDefaults.groupBy,
    };
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      error:
        "codemap query batch: input must be a JSON object or statements array.",
    };
  }

  const obj = body as Record<string, unknown>;
  const merged = {
    statements: obj.statements,
    summary: obj.summary !== undefined ? obj.summary : cliDefaults.summary,
    changed_since:
      typeof obj.changed_since === "string"
        ? obj.changed_since
        : cliDefaults.changedSince,
    group_by:
      typeof obj.group_by === "string" && isGroupByMode(obj.group_by)
        ? obj.group_by
        : cliDefaults.groupBy,
  };

  const parsed = z.array(batchItemSchema).min(1).safeParse(merged.statements);
  if (!parsed.success) {
    return {
      error: `codemap query batch: invalid statements — ${parsed.error.message}`,
    };
  }

  return {
    statements: parsed.data,
    summary: merged.summary === true ? true : undefined,
    changed_since: merged.changed_since,
    group_by: merged.group_by,
  };
}

export async function runQueryBatchCmd(
  opts: QueryBatchOpts & {
    stdin: boolean;
    filePath: string | undefined;
    summary: boolean | undefined;
    changedSince: string | undefined;
    groupBy: GroupByMode | undefined;
  },
): Promise<void> {
  try {
    let raw: unknown;
    if (opts.stdin) {
      raw = await readJsonFromStdin();
    } else {
      raw = JSON.parse(readFileSync(opts.filePath!, "utf8")) as unknown;
    }

    const parsed = parseBatchInput(raw, {
      summary: opts.summary,
      changedSince: opts.changedSince,
      groupBy: opts.groupBy,
    });
    if ("error" in parsed) {
      emitToolResult({ ok: false, error: parsed.error }, { json: true });
      return;
    }

    await bootstrapCodemap(opts);
    const root = getProjectRoot();
    const result = handleQueryBatch(parsed, root);
    emitToolResult(result, { json: true, pretty: !opts.compact });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitToolResult({ ok: false, error: msg }, { json: true });
  }
}
