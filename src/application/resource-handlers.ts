/**
 * Pure transport-agnostic resource fetchers — every MCP resource the
 * codemap server exposes (`codemap://recipes`, `codemap://recipes/{id}`,
 * `codemap://schema`, `codemap://skill`, `codemap://files/{path}`,
 * `codemap://symbols/{name}`) is also reachable over HTTP via
 * `GET /resources/{encoded-uri}`. Catalog-style resources cache lazily;
 * data-shaped resources (files / symbols) read live every time because
 * the index can change between calls under `--watch`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAgentsTemplateDir } from "../agents-init";
import { closeDb, openDb } from "../db";
import {
  getQueryRecipeCatalogEntry,
  listQueryRecipeCatalog,
} from "./query-recipes";
import { buildShowResult, findSymbolsByName } from "./show-engine";

export interface ResourcePayload {
  mimeType: string;
  text: string;
}

let recipesCache: ResourcePayload | undefined;
let schemaCache: ResourcePayload | undefined;
let skillCache: ResourcePayload | undefined;
const oneRecipeCache = new Map<string, ResourcePayload>();

/**
 * Test-only escape hatch — drops every cached payload so a temp-DB test
 * can re-read with fresh state. Production code never calls this.
 */
export function _resetResourceCachesForTests(): void {
  recipesCache = undefined;
  schemaCache = undefined;
  skillCache = undefined;
  oneRecipeCache.clear();
}

/**
 * Read a `codemap://...` resource. Returns the payload or `undefined`
 * for unknown URIs (caller decides whether to 404 / throw).
 *
 * Data-shaped URIs (`files/{path}`, `symbols/{name}`) read live from
 * `.codemap/index.db` every call — no caching, since the index can
 * change between requests under `--watch`. Catalog-style URIs
 * (`recipes`, `schema`, `skill`) cache lazily.
 */
export function readResource(uri: string): ResourcePayload | undefined {
  if (uri === "codemap://recipes") return readRecipesCatalog();
  if (uri.startsWith("codemap://recipes/")) {
    const id = uri.slice("codemap://recipes/".length);
    return readOneRecipe(id);
  }
  if (uri === "codemap://schema") return readSchema();
  if (uri === "codemap://skill") return readSkill();
  if (uri.startsWith("codemap://files/")) {
    const path = decodeURIComponent(uri.slice("codemap://files/".length));
    return readFileResource(path);
  }
  if (uri.startsWith("codemap://symbols/")) {
    return readSymbolsResource(uri);
  }
  return undefined;
}

/**
 * List every available resource (URIs only — caller fetches payloads
 * separately). Used by the MCP `resources/list` request and could be
 * surfaced via HTTP later. Mirrors what `ResourceTemplate.list` returns
 * for the recipes-template URI plus the three static URIs.
 */
export function listResources(): { uri: string; description: string }[] {
  const out: { uri: string; description: string }[] = [
    {
      uri: "codemap://recipes",
      description:
        "Bundled SQL recipes catalog (id, description, sql, optional per-row actions).",
    },
    {
      uri: "codemap://schema",
      description:
        "DDL of every table in .codemap.db (queried live from sqlite_schema).",
    },
    {
      uri: "codemap://skill",
      description: "Full text of the bundled SKILL.md.",
    },
    {
      uri: "codemap://files/{path}",
      description:
        "Per-file roll-up: symbols, imports, exports, coverage. Encode `{path}` URI-style. Reads live (no caching).",
    },
    {
      uri: "codemap://symbols/{name}",
      description:
        "Symbol lookup by exact name. Returns {matches, disambiguation?} envelope. Optional `?in=<path-prefix>` filter (mirrors `show --in`). Reads live (no caching).",
    },
  ];
  for (const entry of listQueryRecipeCatalog()) {
    out.push({
      uri: `codemap://recipes/${entry.id}`,
      description: entry.description,
    });
  }
  return out;
}

function readRecipesCatalog(): ResourcePayload {
  if (recipesCache !== undefined) return recipesCache;
  recipesCache = {
    mimeType: "application/json",
    text: JSON.stringify(listQueryRecipeCatalog()),
  };
  return recipesCache;
}

function readOneRecipe(id: string): ResourcePayload | undefined {
  const cached = oneRecipeCache.get(id);
  if (cached !== undefined) return cached;
  const entry = getQueryRecipeCatalogEntry(id);
  if (entry === undefined) return undefined;
  const payload: ResourcePayload = {
    mimeType: "application/json",
    text: JSON.stringify(entry),
  };
  oneRecipeCache.set(id, payload);
  return payload;
}

function readSchema(): ResourcePayload {
  if (schemaCache !== undefined) return schemaCache;
  const db = openDb();
  try {
    const rows = db
      .query(
        "SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string; sql: string | null }[];
    schemaCache = {
      mimeType: "application/json",
      text: JSON.stringify(
        rows
          .filter((r) => r.sql !== null)
          .map((r) => ({ name: r.name, ddl: r.sql })),
      ),
    };
  } finally {
    closeDb(db, { readonly: true });
  }
  return schemaCache;
}

function readSkill(): ResourcePayload {
  if (skillCache !== undefined) return skillCache;
  const skillPath = join(
    resolveAgentsTemplateDir(),
    "skills",
    "codemap",
    "SKILL.md",
  );
  skillCache = {
    mimeType: "text/markdown",
    text: readFileSync(skillPath, "utf8"),
  };
  return skillCache;
}

/**
 * Per-file roll-up: every shape codemap extracts about one file
 * (symbols, imports, exports, coverage). Returns `undefined` when the
 * file is not in the index. Reads live every call (no caching) since
 * the index can change between requests under `--watch`.
 */
function readFileResource(path: string): ResourcePayload | undefined {
  const db = openDb();
  try {
    // Confirm the file exists in the index — fail-closed if not, so callers
    // can distinguish "unknown URI" from "valid URI, empty roll-up".
    const file = db
      .query("SELECT path, language, line_count FROM files WHERE path = ?")
      .get(path) as
      | { path: string; language: string; line_count: number }
      | null
      | undefined;
    if (file === undefined || file === null) return undefined;

    const symbols = db
      .query(
        `SELECT name, kind, line_start, line_end, signature, is_exported,
                is_default_export, parent_name, visibility, doc_comment
         FROM symbols
         WHERE file_path = ?
         ORDER BY line_start ASC`,
      )
      .all(path);

    const imports = db
      .query(
        `SELECT source, resolved_path, specifiers, is_type_only, line_number
         FROM imports
         WHERE file_path = ?
         ORDER BY line_number ASC`,
      )
      .all(path) as {
      source: string;
      resolved_path: string | null;
      specifiers: string;
      is_type_only: number;
      line_number: number;
    }[];

    const exports = db
      .query(
        `SELECT name, kind, is_default, re_export_source
         FROM exports
         WHERE file_path = ?
         ORDER BY name ASC`,
      )
      .all(path);

    const coverage = db
      .query(
        `SELECT name, line_start, coverage_pct, hit_statements, total_statements
         FROM coverage
         WHERE file_path = ?
         ORDER BY line_start ASC`,
      )
      .all(path) as {
      name: string;
      line_start: number;
      coverage_pct: number | null;
      hit_statements: number;
      total_statements: number;
    }[];

    // Parse imports.specifiers JSON inline so consumers don't have to.
    const importsParsed = imports.map((i) => ({
      source: i.source,
      resolved_path: i.resolved_path,
      specifiers: safeParseSpecifiers(i.specifiers),
      is_type_only: i.is_type_only === 1,
      line_number: i.line_number,
    }));

    // Coverage roll-up summary (avg + count) plus per-symbol detail.
    const measured = coverage.length;
    const avg =
      measured === 0
        ? null
        : Math.round(
            (coverage.reduce((a, c) => a + (c.coverage_pct ?? 0), 0) /
              measured) *
              10,
          ) / 10;

    const payload = {
      path: file.path,
      language: file.language,
      line_count: file.line_count,
      symbols,
      imports: importsParsed,
      exports,
      coverage:
        measured === 0
          ? null
          : {
              measured_symbols: measured,
              avg_coverage_pct: avg,
              per_symbol: coverage,
            },
    };

    return {
      mimeType: "application/json",
      text: JSON.stringify(payload),
    };
  } finally {
    closeDb(db, { readonly: true });
  }
}

/**
 * Symbol lookup by exact name. Returns the same `{matches,
 * disambiguation?}` envelope as the `show` verb (per PR #39). Supports
 * `?in=<path-prefix>` query parameter mirroring `show --in <path>`.
 * Reads live every call (no caching).
 */
function readSymbolsResource(uri: string): ResourcePayload | undefined {
  // Use the URL parser to split path + search. Codemap URIs work because
  // the protocol is `codemap:` and host is `symbols`.
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  // pathname is `/<name>` — strip the leading slash. URI-decode the name
  // since callers may have encoded reserved characters.
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (name.length === 0) return undefined;

  const inPath = parsed.searchParams.get("in") ?? undefined;

  const db = openDb();
  try {
    const matches = findSymbolsByName(db, { name, inPath });
    const result = buildShowResult(matches);
    return {
      mimeType: "application/json",
      text: JSON.stringify(result),
    };
  } finally {
    closeDb(db, { readonly: true });
  }
}

/**
 * Defensive JSON.parse for `imports.specifiers` — falls back to an
 * empty array if the column ever holds malformed JSON. Production data
 * should always be valid (the indexer writes via JSON.stringify), but a
 * resource handler that throws on a bad row is worse than one that
 * returns an empty list and lets the caller see what's there.
 */
function safeParseSpecifiers(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
