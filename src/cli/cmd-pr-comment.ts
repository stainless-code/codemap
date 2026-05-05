import { readFileSync, readSync } from "node:fs";

import {
  detectCommentInputShape,
  renderAuditComment,
  renderSarifComment,
} from "../application/pr-comment-engine";
import { bootstrapCodemap } from "./bootstrap-codemap";

interface PrCommentOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  /** Path to a JSON file. `-` reads stdin. */
  inputPath: string;
  /** `undefined` triggers `runs[]` vs `deltas` sniffing. */
  shape: "audit" | "sarif" | undefined;
  /** Emit `{ markdown, findings_count, kind }` envelope; default = bare markdown. */
  json: boolean;
}

export function printPrCommentCmdHelp(): void {
  console.log(`Usage: codemap pr-comment <input-file> [--shape audit|sarif] [--json]

Render a markdown PR-summary comment from a codemap audit JSON envelope
or a SARIF document. Designed for the cases SARIF→Code-Scanning doesn't
cover well: private repos without GHAS, repos that haven't enabled Code
Scanning, aggregate audit deltas without a single file:line anchor, and
bot-context seeding (review bots read PR conversation, not workflow
artifacts).

Args:
  <input-file>       Path to the JSON file. Use \`-\` to read from stdin.

Flags:
  --shape <kind>     Override automatic shape detection. \`audit\` for
                     codemap-audit-JSON envelopes; \`sarif\` for SARIF
                     2.1.0 docs. Default: detect from payload.
  --json             Emit JSON envelope { markdown, findings_count, kind }
                     instead of bare markdown. Useful for action.yml
                     steps that want structured access to findings_count.
  --help, -h         Show this help.

Examples:

  # Audit envelope from \`codemap audit --base origin/main --json\`
  codemap audit --base origin/main --json > audit.json
  codemap pr-comment audit.json | gh pr comment <PR> -F -

  # SARIF doc from \`codemap query --recipe deprecated-symbols --format sarif\`
  codemap query -r deprecated-symbols --format sarif > findings.sarif
  codemap pr-comment findings.sarif --json

  # Pipe via stdin (avoids the temp file)
  codemap audit --base origin/main --json | codemap pr-comment -
`);
}

export interface ParsedPrCommentRest {
  kind: "run" | "help" | "error";
  message?: string;
  inputPath?: string;
  shape?: "audit" | "sarif" | undefined;
  json?: boolean;
}

export function parsePrCommentRest(rest: string[]): ParsedPrCommentRest {
  if (rest[0] !== "pr-comment") {
    throw new Error("parsePrCommentRest: expected pr-comment");
  }
  let inputPath: string | undefined;
  let shape: "audit" | "sarif" | undefined;
  let json = false;
  let i = 1;
  while (i < rest.length) {
    const a = rest[i];
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--json") {
      json = true;
      i++;
      continue;
    }
    if (a === "--shape" || a.startsWith("--shape=")) {
      const eq = a.indexOf("=");
      const v = eq !== -1 ? a.slice(eq + 1) : rest[i + 1];
      if (v === undefined || v.startsWith("-")) {
        return {
          kind: "error",
          message: 'codemap pr-comment: --shape requires "audit" or "sarif".',
        };
      }
      if (v !== "audit" && v !== "sarif") {
        return {
          kind: "error",
          message: `codemap pr-comment: unknown --shape "${v}". Expected "audit" or "sarif".`,
        };
      }
      shape = v;
      i += eq !== -1 ? 1 : 2;
      continue;
    }
    if (a.startsWith("--")) {
      return {
        kind: "error",
        message: `codemap pr-comment: unknown option "${a}".`,
      };
    }
    if (inputPath !== undefined) {
      return {
        kind: "error",
        message: `codemap pr-comment: unexpected extra argument "${a}". Pass exactly one input path (or "-" for stdin).`,
      };
    }
    inputPath = a;
    i++;
  }
  if (inputPath === undefined) {
    return {
      kind: "error",
      message:
        'codemap pr-comment: missing <input-file> argument. Pass a path or "-" for stdin.',
    };
  }
  return { kind: "run", inputPath, shape, json };
}

export async function runPrCommentCmd(opts: PrCommentOpts): Promise<void> {
  try {
    await bootstrapCodemap(opts);

    const raw =
      opts.inputPath === "-"
        ? readStdinSync()
        : readFileSync(opts.inputPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      emitPrCommentError(
        `failed to parse JSON from ${opts.inputPath === "-" ? "stdin" : opts.inputPath}: ${err instanceof Error ? err.message : String(err)}`,
        opts.json,
      );
      return;
    }

    const detected = opts.shape ?? detectCommentInputShape(parsed);
    if (detected === "unknown") {
      emitPrCommentError(
        "could not detect input shape (no `runs[]` or `deltas` field). Pass --shape audit|sarif to override.",
        opts.json,
      );
      return;
    }
    if (detected === "empty") {
      const out = {
        markdown: "## codemap\n\n_No data._",
        findings_count: 0,
        kind: "empty" as const,
      };
      if (opts.json) console.log(JSON.stringify(out));
      else console.log(out.markdown);
      return;
    }

    const rendered =
      detected === "audit"
        ? renderAuditComment(parsed as Parameters<typeof renderAuditComment>[0])
        : renderSarifComment(
            parsed as Parameters<typeof renderSarifComment>[0],
          );

    if (opts.json) {
      console.log(JSON.stringify(rendered));
    } else {
      console.log(rendered.markdown);
    }
  } catch (err) {
    emitPrCommentError(
      err instanceof Error ? err.message : String(err),
      opts.json,
    );
  }
}

function emitPrCommentError(message: string, json: boolean) {
  if (json) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(`codemap pr-comment: ${message}`);
  }
  process.exitCode = 1;
}

/** Bun + Node fd-0 reads can EAGAIN on a TTY; loop until EOF. */
function readStdinSync(): string {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(4096);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let n: number;
    try {
      n = readSync(0, buffer, 0, buffer.length, null);
    } catch {
      break;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buffer.slice(0, n)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
