import { getMeta, SCHEMA_VERSION } from "../db";
import type { CodemapDatabase } from "../db";
import { CODEMAP_VERSION } from "../version";
import { computeIndexFreshness } from "./index-freshness";
import type { IndexFreshness } from "./index-freshness";
import { QUERY_RECIPES } from "./query-recipes";
import { getIndexedContentHash, readSymbolSource } from "./show-engine";

/** Max recipe cards in `start_here.recipes`. */
const START_HERE_RECIPE_LIMIT = 4;
const DEFAULT_MARKER_LIMIT = 20;

export interface ContextBudget {
  hub_limit: number;
  signatures_per_hub: number;
  signature_max_chars: number;
  marker_limit: number;
}

/**
 * Scale hub/signature payload from indexed file count — pairs with roadmap
 * adaptive output budgets for large trees.
 */
export function resolveContextBudget(fileCount: number): ContextBudget {
  if (fileCount <= 500) {
    return {
      hub_limit: 5,
      signatures_per_hub: 3,
      signature_max_chars: 120,
      marker_limit: DEFAULT_MARKER_LIMIT,
    };
  }
  if (fileCount <= 5000) {
    return {
      hub_limit: 3,
      signatures_per_hub: 2,
      signature_max_chars: 80,
      marker_limit: 15,
    };
  }
  return {
    hub_limit: 2,
    signatures_per_hub: 1,
    signature_max_chars: 60,
    marker_limit: 10,
  };
}

/**
 * Snapshot envelope emitted by `codemap context`. Stable JSON shape any agent
 * or CLI can pipe into a prompt without parsing prose.
 */
export interface ContextEnvelope {
  codemap: {
    cli_version: string;
    schema_version: number;
  };
  project: {
    root: string;
    file_count: number;
    last_indexed_commit: string | null;
    languages: { language: string; files: number }[];
  };
  hubs?: { to_path: string; fan_in: number }[];
  /**
   * A flavor sample of TODO/FIXME/HACK/NOTE markers — the alphabetically-first
   * 20 across the repo, ordered by `(file_path, line_number)`. Not a recency
   * signal; for time-ordered output query `markers` directly, joining
   * `files.last_modified`. Debug intent biases toward FIXME/TODO kinds.
   */
  sample_markers?: {
    file_path: string;
    line_number: number;
    kind: string;
    content: string;
  }[];
  /**
   * Session-start shortcuts: intent-ranked recipe cards + hub files with export
   * signatures. Replaces a common show → explore chain after bootstrap.
   */
  start_here?: ContextStartHere;
  recipes: { id: string; description: string }[];
  index_freshness: IndexFreshness;
  intent?: {
    input: string;
    classified_as: string;
    matched_recipes: string[];
    hint: string;
  };
}

export interface ContextRecipeStarter {
  id: string;
  description: string;
  tool: "query_recipe";
}

export interface ContextHubSignature {
  name: string;
  kind: string;
  signature: string;
  /** First source line at `line_start` when `include_snippets` is requested. */
  snippet?: string;
  stale?: boolean;
  missing?: boolean;
}

export interface ContextHubLeader {
  file_path: string;
  fan_in: number;
  signatures: ContextHubSignature[];
}

export interface ContextIndexSummary {
  files: number;
  symbols: number;
  imports: number;
  components: number;
  dependencies: number;
}

export interface ContextStartHere {
  classified_as: string;
  hint: string;
  index_summary: ContextIndexSummary;
  recipes: ContextRecipeStarter[];
  hub_leaders: ContextHubLeader[];
}

export interface BuildContextEnvelopeOpts {
  compact: boolean;
  intent: string | null;
  /** MCP/HTTP only — one-line export previews on hub leader signatures. */
  include_snippets?: boolean;
}

/**
 * Map a free-text intent into a coarse category and a list of recipe ids
 * worth running first. Pure regex matching — agents can override or ignore it.
 */
export function classifyIntent(intent: string): {
  classified_as: string;
  matched_recipes: string[];
  hint: string;
} {
  const t = intent.toLowerCase();
  if (/refactor|rename|restructur|extract|move\b/.test(t)) {
    return {
      classified_as: "refactor",
      matched_recipes: [
        "fan-in",
        "fan-out",
        "barrel-files",
        "deprecated-symbols",
      ],
      hint: "Inspect fan-in / fan-out before moving symbols; barrel-files surfaces public-API hubs; deprecated-symbols flags risky callers.",
    };
  }
  if (/bug|fix|debug|error|crash|broken|regress/.test(t)) {
    return {
      classified_as: "debug",
      matched_recipes: ["markers-by-kind", "fan-in", "deprecated-symbols"],
      hint: "Markers (TODO/FIXME) and deprecated-symbols often hint at known gotchas; fan-in shows the blast radius of a change.",
    };
  }
  if (/test|coverage|spec|mock/.test(t)) {
    return {
      classified_as: "test",
      matched_recipes: ["files-largest", "fan-in", "components-by-hooks"],
      hint: "files-largest and fan-in surface high-leverage code worth testing first.",
    };
  }
  if (/add|implement|create|new feature|introduce|build/.test(t)) {
    return {
      classified_as: "feature",
      matched_recipes: ["barrel-files", "components-by-hooks", "fan-out"],
      hint: "barrel-files shows where new exports usually land; fan-out shows the dependency reach of starting points.",
    };
  }
  if (/explore|understand|read|tour|map|overview/.test(t)) {
    return {
      classified_as: "explore",
      matched_recipes: [
        "index-summary",
        "fan-in",
        "files-largest",
        "barrel-files",
      ],
      hint: "Start with index-summary for shape, fan-in for hubs, then drill into files-largest.",
    };
  }
  return {
    classified_as: "other",
    matched_recipes: ["index-summary", "fan-in", "markers-by-kind"],
    hint: "No specific category matched — the index-summary / fan-in / markers triple is a safe default.",
  };
}

/** Default session starters when no `--for` / MCP `intent` is supplied. */
export function defaultStartHereClassification(): ReturnType<
  typeof classifyIntent
> {
  return classifyIntent("explore this codebase");
}

/**
 * Build the envelope from an open DB. Pure-ish (reads from DB but takes no I/O
 * outside of it) — covered by unit tests against a temp DB.
 */
export function buildContextEnvelope(
  db: CodemapDatabase,
  projectRoot: string,
  opts: BuildContextEnvelopeOpts,
): ContextEnvelope {
  const fileCount = readScalarInt(db, "SELECT COUNT(*) AS n FROM files");
  const lastCommit = getMeta(db, "last_indexed_commit") ?? null;
  const languages = (
    db
      .query(
        "SELECT language, COUNT(*) AS files FROM files GROUP BY language ORDER BY files DESC, language ASC",
      )
      .all() as { language: string; files: number }[]
  ).map((r) => ({ language: r.language, files: r.files }));

  const envelope: ContextEnvelope = {
    codemap: {
      cli_version: CODEMAP_VERSION,
      schema_version: SCHEMA_VERSION,
    },
    project: {
      root: projectRoot,
      file_count: fileCount,
      last_indexed_commit: lastCommit,
      languages,
    },
    recipes: Object.entries(QUERY_RECIPES).map(([id, meta]) => ({
      id,
      description: meta.description,
    })),
    index_freshness: computeIndexFreshness(db, { include_disk_drift: true }),
  };

  if (!opts.compact) {
    const budget = resolveContextBudget(fileCount);
    const markerIntentClass =
      opts.intent !== null ? classifyIntent(opts.intent).classified_as : null;

    envelope.hubs = db
      .query(QUERY_RECIPES["fan-in"]!.sql)
      .all() as ContextEnvelope["hubs"];
    envelope.sample_markers = readSampleMarkers(
      db,
      markerIntentClass,
      budget.marker_limit,
    );

    const classification =
      opts.intent !== null
        ? classifyIntent(opts.intent)
        : defaultStartHereClassification();
    envelope.start_here = composeStartHere(db, classification, {
      fileCount,
      projectRoot,
      includeSnippets: opts.include_snippets === true,
    });
  }

  if (opts.intent !== null) {
    const cls = classifyIntent(opts.intent);
    envelope.intent = { input: opts.intent, ...cls };
  }

  return envelope;
}

/**
 * Compose session-start shortcuts from a classification result. Exported for
 * unit tests.
 */
export function composeStartHere(
  db: CodemapDatabase,
  classification: ReturnType<typeof classifyIntent>,
  opts: {
    fileCount: number;
    projectRoot: string;
    includeSnippets?: boolean;
  },
): ContextStartHere {
  const budget = resolveContextBudget(opts.fileCount);
  return {
    classified_as: classification.classified_as,
    hint: classification.hint,
    index_summary: readIndexSummary(db),
    recipes: composeRecipeStarters(classification.matched_recipes),
    hub_leaders: composeHubLeaders(db, {
      budget,
      projectRoot: opts.projectRoot,
      includeSnippets: opts.includeSnippets === true,
    }),
  };
}

function readIndexSummary(db: CodemapDatabase): ContextIndexSummary {
  const row = db.query(QUERY_RECIPES["index-summary"]!.sql).get() as
    | ContextIndexSummary
    | undefined;
  return {
    files: row?.files ?? 0,
    symbols: row?.symbols ?? 0,
    imports: row?.imports ?? 0,
    components: row?.components ?? 0,
    dependencies: row?.dependencies ?? 0,
  };
}

function readSampleMarkers(
  db: CodemapDatabase,
  intentClass: string | null,
  limit: number,
): ContextEnvelope["sample_markers"] {
  if (intentClass === "debug") {
    return db
      .query(
        `SELECT file_path, line_number, kind, content
         FROM markers
         WHERE kind IN ('FIXME', 'TODO', 'HACK', 'BUG')
         ORDER BY
           CASE kind
             WHEN 'FIXME' THEN 0
             WHEN 'BUG' THEN 1
             WHEN 'TODO' THEN 2
             WHEN 'HACK' THEN 3
             ELSE 4
           END,
           file_path ASC,
           line_number ASC
         LIMIT ?`,
      )
      .all(limit) as ContextEnvelope["sample_markers"];
  }

  return db
    .query(
      `SELECT file_path, line_number, kind, content
       FROM markers
       ORDER BY file_path ASC, line_number ASC
       LIMIT ?`,
    )
    .all(limit) as ContextEnvelope["sample_markers"];
}

function composeRecipeStarters(recipeIds: string[]): ContextRecipeStarter[] {
  const starters: ContextRecipeStarter[] = [];
  for (const id of recipeIds) {
    if (starters.length >= START_HERE_RECIPE_LIMIT) break;
    const meta = QUERY_RECIPES[id];
    if (meta === undefined) continue;
    starters.push({
      id,
      description: meta.description,
      tool: "query_recipe",
    });
  }
  return starters;
}

function composeHubLeaders(
  db: CodemapDatabase,
  opts: {
    budget: ContextBudget;
    projectRoot: string;
    includeSnippets: boolean;
  },
): ContextHubLeader[] {
  const hubs = db
    .query(
      `SELECT to_path AS file_path, COUNT(*) AS fan_in
       FROM dependencies
       GROUP BY to_path
       ORDER BY fan_in DESC, to_path ASC
       LIMIT ?`,
    )
    .all(opts.budget.hub_limit) as { file_path: string; fan_in: number }[];

  return hubs.map((hub) => ({
    file_path: hub.file_path,
    fan_in: hub.fan_in,
    signatures: readHubSignatures(db, hub.file_path, opts),
  }));
}

function readHubSignatures(
  db: CodemapDatabase,
  filePath: string,
  opts: {
    budget: ContextBudget;
    projectRoot: string;
    includeSnippets: boolean;
  },
): ContextHubLeader["signatures"] {
  const rows = db
    .query(
      `SELECT name, kind, signature, line_start, line_end
       FROM symbols
       WHERE file_path = ? AND is_exported = 1
       ORDER BY
         CASE kind
           WHEN 'function' THEN 0
           WHEN 'class' THEN 1
           WHEN 'interface' THEN 2
           WHEN 'type' THEN 3
           ELSE 4
         END,
         line_start ASC
       LIMIT ?`,
    )
    .all(filePath, opts.budget.signatures_per_hub) as {
    name: string;
    kind: string;
    signature: string;
    line_start: number;
    line_end: number;
  }[];

  return rows.map((row) => {
    const sig: ContextHubSignature = {
      name: row.name,
      kind: row.kind,
      signature: truncateSignature(
        row.signature,
        opts.budget.signature_max_chars,
      ),
    };
    if (opts.includeSnippets) {
      const indexedHash = getIndexedContentHash(db, filePath);
      const read = readSymbolSource({
        projectRoot: opts.projectRoot,
        match: {
          file_path: filePath,
          name: row.name,
          kind: row.kind,
          line_start: row.line_start,
          line_end: row.line_start,
          signature: row.signature,
          is_exported: 1,
          parent_name: null,
          visibility: null,
        },
        indexedContentHash: indexedHash,
      });
      if (read.source !== undefined) {
        sig.snippet = read.source.split("\n")[0] ?? read.source;
      }
      if (read.stale === true) sig.stale = true;
      if (read.missing === true) sig.missing = true;
    }
    return sig;
  });
}

function truncateSignature(signature: string, maxChars: number): string {
  if (signature.length <= maxChars) return signature;
  return `${signature.slice(0, maxChars - 1)}…`;
}

function readScalarInt(db: CodemapDatabase, sql: string): number {
  const row = db.query(sql).get() as { n?: number } | undefined;
  return row?.n ?? 0;
}
