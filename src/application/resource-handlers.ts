/**
 * Pure transport-agnostic resource fetchers — every MCP resource the
 * codemap server exposes (`codemap://recipes`, `codemap://recipes/{id}`,
 * `codemap://schema`, `codemap://skill`) is also reachable over HTTP via
 * `GET /resources/{encoded-uri}`. Same lazy-cache-on-first-read pattern
 * MCP uses; resources are constant for the server-process lifetime so
 * no invalidation needed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAgentsTemplateDir } from "../agents-init";
import { closeDb, openDb } from "../db";
import {
  getQueryRecipeCatalogEntry,
  listQueryRecipeCatalog,
} from "./query-recipes";

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
 */
export function readResource(uri: string): ResourcePayload | undefined {
  if (uri === "codemap://recipes") return readRecipesCatalog();
  if (uri.startsWith("codemap://recipes/")) {
    const id = uri.slice("codemap://recipes/".length);
    return readOneRecipe(id);
  }
  if (uri === "codemap://schema") return readSchema();
  if (uri === "codemap://skill") return readSkill();
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
