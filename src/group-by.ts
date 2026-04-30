import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { PATH_COLUMNS } from "./git-changed";

/**
 * Modes accepted by `codemap query --group-by <mode>`. Order matters for the
 * CLI help text: most-specific first.
 */
export const GROUP_BY_MODES = ["owner", "directory", "package"] as const;
export type GroupByMode = (typeof GROUP_BY_MODES)[number];

export function isGroupByMode(value: string): value is GroupByMode {
  return (GROUP_BY_MODES as readonly string[]).includes(value);
}

/**
 * Resolves a project-relative POSIX path to a single owner / directory /
 * workspace bucket. Returning `undefined` lands the row in `<no-owner>` /
 * `<unknown>` per the caller's convention.
 */
export type Bucketizer = (path: string) => string | undefined;

export interface GroupedRow {
  key: string;
  count: number;
  rows: unknown[];
}

const NO_PATH_KEY = "<unknown>";

/**
 * Group `rows` by the first matching path column (per `PATH_COLUMNS` order).
 * Rows with no string path column land in `<unknown>` so totals stay honest.
 *
 * Output is sorted by descending count, then key ascending — stable across
 * runs, friendly for humans scanning the top of the list first.
 */
export function groupRowsBy(
  rows: unknown[],
  bucketize: Bucketizer,
  noBucketLabel = "<no-owner>",
): GroupedRow[] {
  const buckets = new Map<string, unknown[]>();
  for (const row of rows) {
    const path = pickPath(row);
    let key: string;
    if (path === undefined) {
      key = NO_PATH_KEY;
    } else {
      key = bucketize(path) ?? noBucketLabel;
    }
    const list = buckets.get(key);
    if (list === undefined) {
      buckets.set(key, [row]);
    } else {
      list.push(row);
    }
  }

  return [...buckets.entries()]
    .map(([key, list]) => ({ key, count: list.length, rows: list }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function pickPath(row: unknown): string | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const obj = row as Record<string, unknown>;
  for (const col of PATH_COLUMNS) {
    const v = obj[col];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** Bucketizer for `--group-by directory` — first path segment. */
export function firstDirectory(path: string): string {
  const idx = path.indexOf("/");
  return idx === -1 ? path : path.slice(0, idx);
}

// ---------- CODEOWNERS ----------

interface OwnerRule {
  pattern: string;
  /** Compiled glob → regex. */
  regex: RegExp;
  owners: string[];
}

/**
 * Parse a CODEOWNERS file and return a closure that maps a project-relative
 * POSIX path to the first listed owner of the **last** matching rule (GitHub
 * semantics: later rules override earlier ones). Rows without a matching rule
 * resolve to `undefined` so the caller can apply its own no-owner label.
 *
 * Searches `.github/CODEOWNERS`, `CODEOWNERS`, then `docs/CODEOWNERS`. Returns
 * `null` if no file is present (caller should surface a clean CLI error).
 */
export function loadCodeowners(root: string): Bucketizer | null {
  const candidates = [
    join(root, ".github", "CODEOWNERS"),
    join(root, "CODEOWNERS"),
    join(root, "docs", "CODEOWNERS"),
  ];
  let body: string | undefined;
  for (const path of candidates) {
    if (existsSync(path)) {
      body = readFileSync(path, "utf-8");
      break;
    }
  }
  if (body === undefined) return null;

  const rules = parseCodeowners(body);
  return (path: string) => {
    // GitHub semantics: last matching rule wins.
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i]!;
      if (r.regex.test(path)) return r.owners[0];
    }
    return undefined;
  };
}

function parseCodeowners(body: string): OwnerRule[] {
  const out: OwnerRule[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const pattern = parts[0]!;
    const owners = parts.slice(1).filter(Boolean);
    if (owners.length === 0) continue;
    out.push({ pattern, regex: codeownersGlobToRegex(pattern), owners });
  }
  return out;
}

/**
 * GitHub CODEOWNERS glob → RegExp. Supports:
 * - `*` — zero or more characters except `/`
 * - `**\/` (double-star + slash) — zero or more directories
 * - `/**` (slash + double-star) trailing — current dir and everything beneath
 * - Leading `/` anchors the pattern at repo root; otherwise it matches anywhere
 *   in the tree (GitHub behaviour).
 * - Trailing `/` matches the directory and all descendants.
 */
export function codeownersGlobToRegex(pattern: string): RegExp {
  let p = pattern;
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  const dirMatch = p.endsWith("/");
  if (dirMatch) p = p.slice(0, -1);

  // Sentinel-swap order: handle multi-char tokens before single `*` so the
  // single-`*` pass doesn't double-replace inside `**`.
  const re = p
    .replace(/[.+^$()|{}[\]\\?]/g, (c) => `\\${c}`)
    .replace(/\*\*\//g, "::DSTAR_SLASH::")
    .replace(/\/\*\*/g, "::SLASH_DSTAR::")
    .replace(/\*\*/g, "::DSTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DSTAR_SLASH::/g, "(?:[^/]+/)*")
    .replace(/::SLASH_DSTAR::/g, "(?:/.*)?")
    .replace(/::DSTAR::/g, ".*");

  const prefix = anchored ? "^" : "(?:^|.*/)";
  const suffix = dirMatch ? "(?:/.*)?$" : "$";
  return new RegExp(prefix + re + suffix);
}

// ---------- Workspace packages ----------

/**
 * Discover workspace package roots from the repo's `package.json` `workspaces`
 * field (npm/yarn/bun) or `pnpm-workspace.yaml` `packages:` field. Each
 * entry is a project-relative POSIX directory like `packages/api`.
 *
 * Returns `[]` if there are no workspaces — the caller should treat that as
 * a single-package repo and bucket every path under `<root>`.
 */
export function discoverWorkspaceRoots(root: string): string[] {
  const out = new Set<string>();
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        workspaces?: string[] | { packages?: string[] };
      };
      const patterns = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : pkg.workspaces?.packages;
      if (Array.isArray(patterns)) {
        for (const pat of patterns) {
          for (const dir of expandWorkspaceGlob(root, pat)) out.add(dir);
        }
      }
    } catch {
      // ignore malformed package.json
    }
  }

  const pnpmPath = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpmPath)) {
    const body = readFileSync(pnpmPath, "utf-8");
    for (const pat of parsePnpmPackages(body)) {
      for (const dir of expandWorkspaceGlob(root, pat)) out.add(dir);
    }
  }

  return [...out].sort((a, b) => b.length - a.length);
}

// Tiny YAML extractor — reads the `packages:` list from pnpm-workspace.yaml without
// a YAML dep. Handles `- "pkg/*"` and `- pkg/*` shapes only; that's the documented
// pnpm format. If a project uses fancier YAML, they can fall back to --group-by directory.
function parsePnpmPackages(body: string): string[] {
  const out: string[] = [];
  let inPackages = false;
  for (const raw of body.split("\n")) {
    const line = raw.replace(/#.*$/, "");
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = /^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/.exec(line);
      if (m) {
        out.push(m[1]!.trim());
        continue;
      }
      if (/^\S/.test(line)) inPackages = false;
    }
  }
  return out;
}

// Resolve a workspace pattern (`packages/*`, `apps/web`, …) to concrete dirs.
// Only supports the trailing-`*` shape; literal dirs pass through. `**` is
// treated as a literal — workspaces nested arbitrarily deep are rare and a
// shallow pass keeps the implementation small.
function expandWorkspaceGlob(root: string, pattern: string): string[] {
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    const baseAbs = join(root, base);
    if (!existsSync(baseAbs)) return [];
    try {
      return readdirSync(baseAbs)
        .filter((name) => {
          const abs = join(baseAbs, name);
          try {
            return statSync(abs).isDirectory();
          } catch {
            return false;
          }
        })
        .map((name) => `${base}/${name}`);
    } catch {
      return [];
    }
  }
  return existsSync(join(root, pattern)) ? [pattern] : [];
}

/**
 * Bucketize a path to its workspace dir (longest matching prefix). Paths
 * outside every workspace bucket to `<root>` so monorepo + repo-root files
 * stay distinguishable.
 */
export function makePackageBucketizer(workspaceRoots: string[]): Bucketizer {
  const roots = [...workspaceRoots].sort((a, b) => b.length - a.length);
  return (path: string) => {
    for (const r of roots) {
      if (path === r || path.startsWith(`${r}/`)) return r;
    }
    return "<root>";
  };
}
