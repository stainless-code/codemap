/**
 * Pure transport-agnostic output formatters for `codemap query`. SARIF 2.1.0
 * for GitHub Code Scanning (and any SARIF-aware viewer); GitHub Actions
 * `::notice file=…,line=…::msg` annotations for inline PR-comment surfacing.
 *
 * Per [docs/plans/sarif-formatter.md](../../docs/plans/sarif-formatter.md):
 * location columns auto-detected (`file_path` / `path` / `to_path` /
 * `from_path`, in that priority); `line_start` (+ optional `line_end`) for
 * the SARIF region. Recipes without a location column emit `results: []`
 * (SARIF) or no output (annotations) plus a stderr warning — they're
 * aggregates (`index-summary`, `markers-by-kind`), not findings.
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
