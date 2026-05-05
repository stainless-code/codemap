/**
 * Markdown PR-summary renderer for `codemap audit --json` or
 * `codemap query --format sarif` output. Targets the surfaces SARIF →
 * Code-Scanning doesn't cover (private repos without GHAS, aggregate
 * audit deltas, bot-context seeding). v1.0 ships (b) summary-comment
 * shape; (c) inline reviews deferred per Q4. Plan:
 * `docs/plans/github-marketplace-action.md`.
 */

interface SarifResult {
  ruleId: string;
  level?: string;
  message: { text: string };
  locations?: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: { startLine?: number; endLine?: number };
    };
  }>;
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription?: { text: string };
}

interface SarifDocument {
  version: string;
  runs: Array<{
    tool: { driver: { name: string; rules: SarifRule[] } };
    results: SarifResult[];
  }>;
}

interface AuditDelta {
  base: { source: string; ref?: string; sha?: string; name?: string };
  added: Record<string, unknown>[];
  removed: Record<string, unknown>[];
}

interface AuditEnvelope {
  head: { sha?: string; commit?: string };
  deltas: Record<string, AuditDelta>;
}

/** `findings_count` lets callers skip posting on clean PRs. */
export interface RenderedComment {
  markdown: string;
  findings_count: number;
  kind: "audit" | "sarif" | "empty";
}

/** SARIF → `runs[]`; audit → `deltas`; `{}` → `empty` for explicit no-data handling. */
export function detectCommentInputShape(
  obj: unknown,
): "audit" | "sarif" | "empty" | "unknown" {
  if (typeof obj !== "object" || obj === null) return "unknown";
  const o = obj as Record<string, unknown>;
  if (Array.isArray(o["runs"])) return "sarif";
  if (typeof o["deltas"] === "object" && o["deltas"] !== null) return "audit";
  if (Object.keys(o).length === 0) return "empty";
  return "unknown";
}

/** Removed rows render in the same delta section — losing a dep / deprecation is signal too. */
export function renderAuditComment(envelope: AuditEnvelope): RenderedComment {
  const lines: string[] = [];
  lines.push("## codemap audit");
  lines.push("");

  const deltaEntries = Object.entries(envelope.deltas);
  let totalAdded = 0;
  let totalRemoved = 0;
  for (const [, delta] of deltaEntries) {
    totalAdded += delta.added.length;
    totalRemoved += delta.removed.length;
  }

  if (totalAdded === 0 && totalRemoved === 0) {
    lines.push("✅ No structural drift across audited deltas.");
    return {
      markdown: lines.join("\n"),
      findings_count: 0,
      kind: "audit",
    };
  }

  const summaryParts = deltaEntries
    .map(([key, delta]) => {
      const a = delta.added.length;
      const r = delta.removed.length;
      if (a === 0 && r === 0) return null;
      return `**${key}**: +${a} / -${r}`;
    })
    .filter((s): s is string => s !== null);
  lines.push(summaryParts.join(" · "));
  lines.push("");

  for (const [key, delta] of deltaEntries) {
    if (delta.added.length === 0 && delta.removed.length === 0) continue;
    lines.push(`### ${key}`);
    lines.push("");
    lines.push(`Baseline: ${describeBase(delta.base)}`);
    lines.push("");
    if (delta.added.length > 0) {
      lines.push(`<details><summary>➕ ${delta.added.length} added</summary>`);
      lines.push("");
      for (const row of delta.added.slice(0, 50)) {
        lines.push(`- ${formatRowLine(row)}`);
      }
      if (delta.added.length > 50) {
        lines.push(`- … and ${delta.added.length - 50} more`);
      }
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
    if (delta.removed.length > 0) {
      lines.push(
        `<details><summary>➖ ${delta.removed.length} removed</summary>`,
      );
      lines.push("");
      for (const row of delta.removed.slice(0, 50)) {
        lines.push(`- ${formatRowLine(row)}`);
      }
      if (delta.removed.length > 50) {
        lines.push(`- … and ${delta.removed.length - 50} more`);
      }
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  return {
    markdown: lines.join("\n").trim(),
    findings_count: totalAdded,
    kind: "audit",
  };
}

/** Grouped by ruleId so consumers see "5 deprecated · 12 untested-and-dead", not a flat list. */
export function renderSarifComment(doc: SarifDocument): RenderedComment {
  const lines: string[] = [];
  lines.push("## codemap findings");
  lines.push("");

  const results = doc.runs?.[0]?.results ?? [];
  if (results.length === 0) {
    lines.push("✅ No findings.");
    return {
      markdown: lines.join("\n"),
      findings_count: 0,
      kind: "sarif",
    };
  }

  const byRule = new Map<string, SarifResult[]>();
  for (const r of results) {
    const list = byRule.get(r.ruleId) ?? [];
    list.push(r);
    byRule.set(r.ruleId, list);
  }

  // Header summary line.
  const summaryParts: string[] = [];
  for (const [ruleId, ruleResults] of byRule) {
    summaryParts.push(`**${ruleId}**: ${ruleResults.length}`);
  }
  lines.push(summaryParts.join(" · "));
  lines.push("");

  for (const [ruleId, ruleResults] of byRule) {
    lines.push(`### ${ruleId} (${ruleResults.length})`);
    lines.push("");
    lines.push(
      `<details><summary>${ruleResults.length} finding${ruleResults.length === 1 ? "" : "s"}</summary>`,
    );
    lines.push("");
    for (const r of ruleResults.slice(0, 50)) {
      lines.push(`- ${formatSarifLine(r)}`);
    }
    if (ruleResults.length > 50) {
      lines.push(`- … and ${ruleResults.length - 50} more`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  return {
    markdown: lines.join("\n").trim(),
    findings_count: results.length,
    kind: "sarif",
  };
}

function describeBase(base: AuditDelta["base"]): string {
  if (base.source === "ref") {
    return `\`${base.ref ?? "(unknown ref)"}\` (${(base.sha ?? "").slice(0, 8)})`;
  }
  if (base.source === "baseline") {
    return `saved baseline \`${base.name ?? "(unknown)"}\``;
  }
  return `\`${base.source}\``;
}

function formatRowLine(row: Record<string, unknown>): string {
  const path =
    (row["file_path"] as string | undefined) ??
    (row["path"] as string | undefined) ??
    (row["to_path"] as string | undefined);
  const fromPath = row["from_path"] as string | undefined;
  const name = row["name"] as string | undefined;
  const kind = row["kind"] as string | undefined;
  const lineStart = row["line_start"];
  if (fromPath !== undefined && path !== undefined) {
    return `\`${fromPath}\` → \`${path}\``;
  }
  if (path !== undefined) {
    const loc =
      typeof lineStart === "number" && lineStart > 0
        ? `${path}:${lineStart}`
        : path;
    if (name !== undefined) {
      const nameLabel =
        kind !== undefined ? `\`${name}\` (${kind})` : `\`${name}\``;
      return `${nameLabel} — \`${loc}\``;
    }
    return `\`${loc}\``;
  }
  return `\`${JSON.stringify(row)}\``;
}

function formatSarifLine(r: SarifResult): string {
  const loc = r.locations?.[0]?.physicalLocation;
  const uri = loc?.artifactLocation?.uri;
  const startLine = loc?.region?.startLine;
  const where =
    uri === undefined
      ? ""
      : startLine === undefined
        ? ` — \`${uri}\``
        : ` — \`${uri}:${startLine}\``;
  return `${r.message.text}${where}`;
}
