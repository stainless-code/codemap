import { loadUserConfig, resolveCodemapConfig } from "../config";
import { closeDb, getMeta, openDb, SCHEMA_VERSION } from "../db";
import type { CodemapDatabase } from "../db";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";
import { CODEMAP_VERSION } from "../version";
import { QUERY_RECIPES } from "./query-recipes";

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
   * `files.last_modified`.
   */
  sample_markers?: {
    file_path: string;
    line_number: number;
    kind: string;
    content: string;
  }[];
  recipes: { id: string; description: string }[];
  intent?: {
    input: string;
    classified_as: string;
    matched_recipes: string[];
    hint: string;
  };
}

interface ContextOpts {
  root: string;
  configFile: string | undefined;
  compact: boolean;
  intent: string | null;
}

/**
 * Print **`codemap context`** usage.
 */
export function printContextCmdHelp(): void {
  console.log(`Usage: codemap context [--compact] [--for "<intent>"]

Emit a JSON envelope describing the current index — project metadata, top
hubs (fan-in), a sample of markers, and the bundled recipe catalog. Designed
for agents and editors that want a single-command "give me everything cheap".

Flags:
  --compact          Drop hubs and sample_markers; emit JSON without
                     pretty-print (smaller payload).
  --for "<intent>"   Pre-classify a free-text intent (refactor, debug, test,
                     feature, explore) and recommend recipes that match.
  --help, -h         Show this help.

Examples:
  codemap context
  codemap context --compact
  codemap context --for "refactor the auth module"
`);
}

/**
 * Parse `argv` after the bootstrap split: `rest[0]` must be `"context"`.
 */
export function parseContextRest(
  rest: string[],
):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; compact: boolean; intent: string | null } {
  if (rest[0] !== "context") {
    throw new Error("parseContextRest: expected context");
  }
  let compact = false;
  let intent: string | null = null;
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--compact") {
      compact = true;
      continue;
    }
    if (a === "--for") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--") || v.trim() === "") {
        return {
          kind: "error",
          message: 'codemap: "--for" requires an intent string in quotes.',
        };
      }
      intent = v.trim();
      i++;
      continue;
    }
    return {
      kind: "error",
      message: `codemap: unknown option "${a}". Run codemap context --help for usage.`,
    };
  }
  return { kind: "run", compact, intent };
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

/**
 * Build the envelope from an open DB. Pure-ish (reads from DB but takes no I/O
 * outside of it) — covered by unit tests against a temp DB.
 */
export function buildContextEnvelope(
  db: CodemapDatabase,
  projectRoot: string,
  opts: { compact: boolean; intent: string | null },
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
  };

  if (!opts.compact) {
    envelope.hubs = db
      .query(QUERY_RECIPES["fan-in"]!.sql)
      .all() as ContextEnvelope["hubs"];
    envelope.sample_markers = db
      .query(
        "SELECT file_path, line_number, kind, content FROM markers ORDER BY file_path ASC, line_number ASC LIMIT 20",
      )
      .all() as ContextEnvelope["sample_markers"];
  }

  if (opts.intent !== null) {
    const cls = classifyIntent(opts.intent);
    envelope.intent = { input: opts.intent, ...cls };
  }

  return envelope;
}

function readScalarInt(db: CodemapDatabase, sql: string): number {
  const row = db.query(sql).get() as { n?: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Initialize Codemap for `opts.root`, then print the context envelope as JSON.
 */
export async function runContextCmd(opts: ContextOpts): Promise<void> {
  try {
    const user = await loadUserConfig(opts.root, opts.configFile);
    initCodemap(resolveCodemapConfig(opts.root, user));
    configureResolver(getProjectRoot(), getTsconfigPath());
    const db = openDb();
    let envelope: ContextEnvelope;
    try {
      envelope = buildContextEnvelope(db, getProjectRoot(), {
        compact: opts.compact,
        intent: opts.intent,
      });
    } finally {
      closeDb(db, { readonly: true });
    }
    console.log(
      opts.compact
        ? JSON.stringify(envelope)
        : JSON.stringify(envelope, null, 2),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ error: msg }));
    process.exitCode = 1;
  }
}
