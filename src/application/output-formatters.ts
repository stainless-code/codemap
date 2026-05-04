/**
 * Pure transport-agnostic output formatters for `codemap query`. SARIF 2.1.0
 * for GitHub Code Scanning (and any SARIF-aware viewer); GitHub Actions
 * `::notice file=…,line=…::msg` annotations for inline PR-comment surfacing.
 *
 * Location columns auto-detected (`file_path` / `path` / `to_path` /
 * `from_path`, in that priority); `line_start` (+ optional `line_end`) for
 * the SARIF region. Recipes without a location column emit `results: []`
 * (SARIF) or no output (annotations) plus a stderr warning — they're
 * aggregates (`index-summary`, `markers-by-kind`), not findings. See
 * [`docs/architecture.md` § Output formatters](../../docs/architecture.md#cli-usage).
 *
 * Both formatters are pure: take rows + recipe metadata, return a string.
 * No I/O, no DB access. Same engine wired into both the CLI (`cmd-query.ts`)
 * and the MCP `query` / `query_recipe` tools.
 */

import { CODEMAP_VERSION } from "../version";

/** Priority-ordered column names that name a file path (D1). */
const LOCATION_COLUMNS = ["file_path", "path", "to_path", "from_path"] as const;

export interface FormatOpts {
  rows: Record<string, unknown>[];
  /**
   * `recipeId` is `undefined` for ad-hoc SQL — formatter falls back to
   * `codemap.adhoc` per plan § D2.
   */
  recipeId: string | undefined;
  /** `description` from the recipe catalog; passed straight to `rule.shortDescription`. */
  recipeDescription?: string | undefined;
  /** Body of `<id>.md`; passed to `rule.fullDescription`. Optional. */
  recipeBody?: string | undefined;
}

/**
 * Detect the file-path column on a row. Returns the column name or `null`
 * if none of the known location columns are present + populated.
 */
export function detectLocationColumn(
  row: Record<string, unknown>,
): (typeof LOCATION_COLUMNS)[number] | null {
  for (const col of LOCATION_COLUMNS) {
    const v = row[col];
    if (typeof v === "string" && v.length > 0) return col;
  }
  return null;
}

/**
 * Detect whether the row-set has any locatable rows. Used to decide whether
 * to emit a stderr warning that the recipe is not a "findings" shape.
 */
export function hasLocatableRows(rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0) return false;
  return rows.some((r) => detectLocationColumn(r) !== null);
}

/**
 * Build a one-line message for a result row. Strips location columns and
 * stringifies what's left; if `name` is present, leads with it (e.g.
 * `"foo (function): @deprecated since v2"`). Per plan § D4.
 */
export function buildMessageText(row: Record<string, unknown>): string {
  const out: string[] = [];
  const name = row["name"];
  const kind = row["kind"];
  if (typeof name === "string" && name.length > 0) {
    if (typeof kind === "string" && kind.length > 0) {
      out.push(`${name} (${kind})`);
    } else {
      out.push(name);
    }
  }
  // Stringify remaining columns (skip location + already-included name/kind +
  // line_start/line_end since they're surfaced via SARIF region / annotation
  // line). Keep deterministic by iterating in insertion order of the row.
  const skip = new Set<string>([
    ...LOCATION_COLUMNS,
    "name",
    "kind",
    "line_start",
    "line_end",
  ]);
  const extras: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k)) continue;
    if (v === null || v === undefined) continue;
    extras.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  if (extras.length > 0) {
    out.push(extras.join(", "));
  }
  if (out.length === 0) return "(no message)";
  return out.join(": ");
}

/**
 * Format the row-set as a SARIF 2.1.0 document (per plan § D2-D6). Always
 * returns a valid SARIF doc — `results: []` for empty / no-location rows so
 * SARIF tooling handles both gracefully.
 */
export function formatSarif(opts: FormatOpts): string {
  const ruleId = opts.recipeId ? `codemap.${opts.recipeId}` : "codemap.adhoc";
  const ruleShortDescription =
    opts.recipeDescription ?? opts.recipeId ?? "Ad-hoc SQL query";
  const rule: Record<string, unknown> = {
    id: ruleId,
    name: opts.recipeId ?? "adhoc",
    shortDescription: { text: ruleShortDescription },
    defaultConfiguration: { level: "note" },
  };
  if (opts.recipeBody !== undefined && opts.recipeBody.length > 0) {
    rule["fullDescription"] = { text: opts.recipeBody };
  }

  const results = opts.rows.flatMap((row) => {
    const locCol = detectLocationColumn(row);
    if (locCol === null) return [];
    const uri = row[locCol] as string;
    const lineStartRaw = row["line_start"];
    const lineEndRaw = row["line_end"];
    const region: Record<string, number> = {};
    if (typeof lineStartRaw === "number" && lineStartRaw > 0) {
      region["startLine"] = lineStartRaw;
    }
    if (typeof lineEndRaw === "number" && lineEndRaw > 0) {
      region["endLine"] = lineEndRaw;
    }
    const physicalLocation: Record<string, unknown> = {
      artifactLocation: { uri },
    };
    if (Object.keys(region).length > 0) {
      physicalLocation["region"] = region;
    }
    return [
      {
        ruleId,
        level: "note",
        message: { text: buildMessageText(row) },
        locations: [{ physicalLocation }],
      },
    ];
  });

  const sarif = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "codemap",
            informationUri: "https://github.com/stainless-code/codemap",
            version: CODEMAP_VERSION,
            rules: [rule],
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

export interface AnnotationsOpts {
  rows: Record<string, unknown>[];
  /** Same `recipeId` shape as {@link FormatOpts}; not currently rendered (annotation lines don't carry rule id). */
  recipeId: string | undefined;
  /**
   * Annotation level — `"notice" | "warning" | "error"` per GitHub Actions.
   * Default `"notice"` per plan § D7. Future per-recipe override via
   * frontmatter `sarifLevel:` (deferred to v1.x).
   */
  level?: "notice" | "warning" | "error";
}

/**
 * Escape a workflow-command **data payload** (everything after the `::`
 * delimiter) per [actions/toolkit `command.ts`](https://github.com/actions/toolkit/blob/master/packages/core/src/command.ts):
 * `%` → `%25`, `\r` → `%0D`, `\n` → `%0A`. Without this, a `%` in the message
 * (e.g. `coverage at 50%`) gets parsed as a malformed escape sequence by the
 * runner.
 */
export function escapeAnnotationData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Escape a workflow-command **property value** (the `value` in `key=value`):
 * data-payload escapes plus `:` → `%3A` and `,` → `%2C`. Without this, a
 * file path containing `:` (Windows drive letter, `C:\foo`) or `,` would
 * either prematurely terminate the property or split into two malformed
 * `key=value` pairs. Same actions/toolkit reference as
 * {@link escapeAnnotationData}.
 */
export function escapeAnnotationProperty(value: string): string {
  return escapeAnnotationData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * Maximum edge count `formatMermaid` will render before rejecting with a
 * scope-suggestion error. Recipes / ad-hoc SQL must `LIMIT` to ≤ this; the
 * `impact` engine already bounds via `--depth` / `--limit`.
 * (`docs/plans/fts5-mermaid.md` Q4 — hard-coded for v1; promote to config
 * later if real-world data shows 50 is wrong.)
 */
export const MERMAID_MAX_EDGES = 50;

export interface MermaidOpts {
  /** Rows must shape as `{from, to, label?, kind?}` — alias other columns via SELECT. */
  rows: Record<string, unknown>[];
  /** Recipe id surfaced in the error message when the row-set is unbounded. */
  recipeId: string | undefined;
}

/**
 * Render a `{from, to, label?, kind?}` row-set as a Mermaid `flowchart LR`
 * diagram (`docs/plans/fts5-mermaid.md` Q5). Rejects with a scope-suggestion
 * error when row count exceeds {@link MERMAID_MAX_EDGES} — auto-truncation
 * would be a verdict masquerading as an output mode (Q4 / moat A).
 *
 * Throws `Error` with a message naming the recipe + count + scoping knobs
 * (`LIMIT` / `--via` / `WHERE from_path LIKE`) when the contract is violated.
 */
export function formatMermaid(opts: MermaidOpts): string {
  if (opts.rows.length > MERMAID_MAX_EDGES) {
    const recipe = opts.recipeId ?? "(ad-hoc SQL)";
    throw new Error(
      `[mermaid] ${recipe} produced ${opts.rows.length} edges (> ${MERMAID_MAX_EDGES}). ` +
        `Auto-truncation is out of scope (would be a verdict, not an output mode). ` +
        `Scope the input via 'LIMIT ${MERMAID_MAX_EDGES}', '--via <backend>' (impact), or 'WHERE from_path LIKE …' (recipe / ad-hoc).`,
    );
  }

  const ids = new Map<string, string>();
  let nextId = 0;
  function nodeId(name: string): string {
    const cached = ids.get(name);
    if (cached !== undefined) return cached;
    const id = `n${nextId++}`;
    ids.set(name, id);
    return id;
  }

  const lines: string[] = ["flowchart LR"];
  const seen = new Set<string>();
  for (const row of opts.rows) {
    const from = readMermaidEndpoint(row, "from");
    const to = readMermaidEndpoint(row, "to");
    if (from === undefined || to === undefined) continue;

    const fromId = nodeId(from);
    const toId = nodeId(to);
    if (!seen.has(from)) {
      lines.push(`  ${fromId}[${quoteMermaidLabel(from)}]`);
      seen.add(from);
    }
    if (!seen.has(to)) {
      lines.push(`  ${toId}[${quoteMermaidLabel(to)}]`);
      seen.add(to);
    }

    const labelRaw = row["label"];
    const label =
      typeof labelRaw === "string" && labelRaw.length > 0
        ? `|${quoteMermaidLabel(labelRaw)}|`
        : "";
    lines.push(`  ${fromId} --> ${label} ${toId}`.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

function readMermaidEndpoint(
  row: Record<string, unknown>,
  key: "from" | "to",
): string | undefined {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Mermaid label quoting: `"` and `\` need escaping; everything else is literal. */
function quoteMermaidLabel(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Format the row-set as GitHub Actions annotation commands. One line per
 * locatable row: `::<level> file=<path>,line=<n>::<message>`.
 *
 * Per plan § D7: rows without a location column are skipped; empty input
 * → empty string. Caller decides whether to print a stderr warning.
 *
 * **Escaping:** property values (`file`) and the message payload are
 * percent-encoded per actions/toolkit so paths with `:` / `,` and messages
 * with `%` / `\r` / `\n` round-trip correctly through the GH runner.
 *
 * Reference: <https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message>
 */
export function formatAnnotations(opts: AnnotationsOpts): string {
  const level = opts.level ?? "notice";
  const lines: string[] = [];
  for (const row of opts.rows) {
    const locCol = detectLocationColumn(row);
    if (locCol === null) continue;
    const file = row[locCol] as string;
    const lineStartRaw = row["line_start"];
    const lineN =
      typeof lineStartRaw === "number" && lineStartRaw > 0
        ? lineStartRaw
        : undefined;
    const params: string[] = [`file=${escapeAnnotationProperty(file)}`];
    if (lineN !== undefined) params.push(`line=${lineN}`);
    // Collapse internal whitespace runs into a single space so the message
    // is one logical line; THEN escape so the GH runner reads it back as
    // a single annotation (escaped %0A still terminates the command).
    const message = escapeAnnotationData(
      buildMessageText(row).replace(/\s+/g, " ").trim(),
    );
    lines.push(`::${level} ${params.join(",")}::${message}`);
  }
  return lines.join("\n");
}
