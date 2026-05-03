import type { CodemapDatabase } from "../db";

/** Walk direction. `up` = callers/dependents, `down` = callees/dependencies. */
export type ImpactDirection = "up" | "down" | "both";

/** Graph backend. `all` = every backend compatible with the resolved target. */
export type ImpactBackend = "dependencies" | "calls" | "imports" | "all";

export type ImpactTargetKind = "symbol" | "file";

/**
 * One node in the impact walk. `edge` says which relation got us here from
 * the previous hop; `name` is set for `symbol` rows only.
 */
export interface ImpactNode {
  depth: number;
  direction: "up" | "down";
  edge:
    | "called_by"
    | "calls"
    | "depends_on"
    | "depended_on_by"
    | "imports"
    | "imported_by";
  kind: ImpactTargetKind;
  name?: string;
  file_path: string;
  line_start?: number;
}

/**
 * `matched_in`: file targets → `[file_path]`; symbol targets → every file
 * declaring a matching symbol (multi-match still single envelope).
 */
export interface ImpactTarget {
  kind: ImpactTargetKind;
  name: string;
  matched_in: string[];
}

/** Why the walk stopped — surfaces in the result envelope's `summary`. */
export type ImpactTermination = "depth" | "limit" | "exhausted" | "cycle";

export interface ImpactSummary {
  nodes: number;
  max_depth_reached: number;
  by_kind: Record<string, number>;
  terminated_by: ImpactTermination;
}

export interface ImpactResult {
  target: ImpactTarget;
  direction: ImpactDirection;
  via: Array<"dependencies" | "calls" | "imports">;
  depth_limit: number;
  matches: ImpactNode[];
  summary: ImpactSummary;
  /**
   * Set when `--via <backend>` couldn't apply to the resolved target kind
   * (e.g. `--via calls` against a file target, or `--via dependencies`
   * against a symbol). Tells the agent why their backend selection
   * yielded fewer rows than expected.
   */
  skipped_backends?: Array<{
    backend: "dependencies" | "calls" | "imports";
    reason: string;
  }>;
}

export interface FindImpactOpts {
  /** Symbol name (exact, case-sensitive) OR project-relative file path. */
  target: string;
  /** Default `both`. */
  direction?: ImpactDirection | undefined;
  /** Default `all` (every backend compatible with the target kind). */
  via?: ImpactBackend | undefined;
  /** Default `3`. `0` = unbounded (still cycle-detected and limit-capped). */
  depth?: number | undefined;
  /** Default `500`. Caps total rows; truncation surfaces as `terminated_by: "limit"`. */
  limit?: number | undefined;
}

const DEFAULT_DEPTH = 3;
const DEFAULT_LIMIT = 500;
// Sentinel for "unbounded" walks — well past any real-world fan-out and
// keeps the SQL `WHERE depth < ?` clause shape uniform.
const UNBOUNDED_DEPTH_SENTINEL = 1_000_000;

/**
 * One `WITH RECURSIVE` per (direction, backend); JS-side dedup + summary.
 * Backends per target kind: file → `dependencies` + `imports`;
 * symbol → `calls`. Incompatible explicit `--via` lands in `skipped_backends`.
 */
export function findImpact(
  db: CodemapDatabase,
  opts: FindImpactOpts,
): ImpactResult {
  const direction: ImpactDirection = opts.direction ?? "both";
  const viaOpt: ImpactBackend = opts.via ?? "all";
  const depthRaw = opts.depth ?? DEFAULT_DEPTH;
  const depthLimit = depthRaw === 0 ? UNBOUNDED_DEPTH_SENTINEL : depthRaw;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const target = resolveTarget(db, opts.target);
  const { backends, skipped } = resolveBackends(viaOpt, target.kind);
  const directions: Array<"up" | "down"> =
    direction === "both" ? ["up", "down"] : [direction];

  const allNodes: ImpactNode[] = [];
  let maxDepth = 0;
  let depthCapped = false;

  for (const dir of directions) {
    for (const backend of backends) {
      const rows = walk(db, {
        target,
        direction: dir,
        backend,
        depthLimit,
        // Pull one extra row so we can detect "more available" for
        // termination_by: "depth" classification.
        rowCap: limit + 1,
      });
      for (const r of rows) {
        if (r.depth > maxDepth) maxDepth = r.depth;
        if (r.depth >= depthLimit) depthCapped = true;
        allNodes.push(r);
      }
    }
  }

  // Dedup: same (kind, name, file_path, direction) collapsed to the
  // shallowest depth across backends. Edge label kept from the first hit
  // (deterministic per `walk()` ordering).
  const dedupedMap = new Map<string, ImpactNode>();
  for (const n of allNodes) {
    const key = `${n.direction}|${n.kind}|${n.name ?? ""}|${n.file_path}`;
    const existing = dedupedMap.get(key);
    if (!existing || n.depth < existing.depth) dedupedMap.set(key, n);
  }
  const deduped = [...dedupedMap.values()].sort(
    (a, b) =>
      a.depth - b.depth ||
      a.direction.localeCompare(b.direction) ||
      a.file_path.localeCompare(b.file_path) ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );

  // "limit" wins over "depth" (truncation is the more actionable signal);
  // "depth" is heuristic — we don't probe depth+1 to confirm more existed.
  const terminationBy: ImpactTermination =
    deduped.length > limit ? "limit" : depthCapped ? "depth" : "exhausted";
  const matches = deduped.slice(0, limit);

  const byKind: Record<string, number> = {};
  for (const n of matches) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;

  const result: ImpactResult = {
    target,
    direction,
    via: backends,
    depth_limit: depthRaw,
    matches,
    summary: {
      nodes: matches.length,
      max_depth_reached: maxDepth,
      by_kind: byKind,
      terminated_by: terminationBy,
    },
  };
  if (skipped.length > 0) result.skipped_backends = skipped;
  return result;
}

/**
 * Decide whether the user-supplied string is a file path or a symbol name.
 *
 * - Contains `/` OR matches an indexed `files.path` row → file target.
 * - Otherwise → symbol target. Symbols resolve to every file declaring a
 *   matching name (caller picks via `--in <path>` if multi-match).
 *
 * Mirrors the file-vs-symbol heuristic `cmd-show.ts` uses; the engine
 * doesn't need oxc-resolver here because targets are project-relative
 * paths or bare names — no module-id resolution.
 */
function resolveTarget(db: CodemapDatabase, raw: string): ImpactTarget {
  const looksLikeFile = raw.includes("/") || raw.includes("\\");
  if (looksLikeFile) {
    return { kind: "file", name: raw, matched_in: [raw] };
  }

  const fileRow = db
    .query("SELECT path FROM files WHERE path = ? LIMIT 1")
    .get(raw) as { path: string } | null;
  if (fileRow) {
    return { kind: "file", name: raw, matched_in: [raw] };
  }

  const symFiles = db
    .query(
      "SELECT DISTINCT file_path FROM symbols WHERE name = ? ORDER BY file_path ASC",
    )
    .all(raw) as Array<{ file_path: string }>;
  return {
    kind: "symbol",
    name: raw,
    matched_in: symFiles.map((r) => r.file_path),
  };
}

function resolveBackends(
  via: ImpactBackend,
  targetKind: ImpactTargetKind,
): {
  backends: Array<"dependencies" | "calls" | "imports">;
  skipped: Array<{
    backend: "dependencies" | "calls" | "imports";
    reason: string;
  }>;
} {
  const fileBackends: Array<"dependencies" | "imports"> = [
    "dependencies",
    "imports",
  ];
  const symbolBackends: Array<"calls"> = ["calls"];

  if (via === "all") {
    return targetKind === "file"
      ? { backends: [...fileBackends], skipped: [] }
      : { backends: [...symbolBackends], skipped: [] };
  }

  if (via === "calls") {
    return targetKind === "symbol"
      ? { backends: ["calls"], skipped: [] }
      : {
          backends: [],
          skipped: [
            {
              backend: "calls",
              reason: "calls table is symbol-level; target resolved to a file",
            },
          ],
        };
  }
  if (via === "dependencies" || via === "imports") {
    return targetKind === "file"
      ? { backends: [via], skipped: [] }
      : {
          backends: [],
          skipped: [
            {
              backend: via,
              reason: `${via} table is file-level; target resolved to a symbol`,
            },
          ],
        };
  }
  return { backends: [], skipped: [] };
}

interface WalkOpts {
  target: ImpactTarget;
  direction: "up" | "down";
  backend: "dependencies" | "calls" | "imports";
  depthLimit: number;
  rowCap: number;
}

/**
 * Run one `WITH RECURSIVE` per backend × direction. Cycle detection via
 * a comma-bounded path string + `instr` check (per plan §D6) — SQLite
 * doesn't expose a native cycle predicate, so we materialize the visited
 * set per row. Bounded depth + `LIMIT` keep cyclic graphs cheap.
 */
function walk(db: CodemapDatabase, opts: WalkOpts): ImpactNode[] {
  if (opts.backend === "calls") return walkCalls(db, opts);
  return walkFileGraph(db, opts);
}

function walkCalls(db: CodemapDatabase, opts: WalkOpts): ImpactNode[] {
  const seedName = opts.target.name;
  // up: new caller_name where callee_name = current node
  // down: new callee_name where caller_name = current node
  const joinFromCol = opts.direction === "up" ? "callee_name" : "caller_name";
  const joinToCol = opts.direction === "up" ? "caller_name" : "callee_name";
  const edge: ImpactNode["edge"] =
    opts.direction === "up" ? "called_by" : "calls";

  // Seed depth = 0; `WHERE depth > 0` filters seed; `< depthLimit` is the cap.
  const sql = `
    WITH RECURSIVE walk(node, depth, path, file_path) AS (
      SELECT ?, 0, ',' || ? || ',', NULL
      UNION ALL
      SELECT c.${joinToCol}, walk.depth + 1,
             walk.path || c.${joinToCol} || ',', c.file_path
      FROM calls c
      JOIN walk ON c.${joinFromCol} = walk.node
      WHERE walk.depth < ?
        AND instr(walk.path, ',' || c.${joinToCol} || ',') = 0
    )
    SELECT node, MIN(depth) AS depth, file_path
    FROM walk
    WHERE depth > 0
    GROUP BY node
    ORDER BY depth ASC, node ASC
    LIMIT ?
  `;
  const rows = db
    .query(sql)
    .all(seedName, seedName, opts.depthLimit, opts.rowCap) as Array<{
    node: string;
    depth: number;
    file_path: string | null;
  }>;
  return rows.map((r) => {
    // Fall back to a symbol-table lookup so callers without a recorded
    // call-site file (cross-module callees that never appear as `caller`)
    // still get a `file_path` for navigation.
    const symFile = r.file_path ?? lookupSymbolFile(db, r.node);
    const node: ImpactNode = {
      depth: r.depth,
      direction: opts.direction,
      edge,
      kind: "symbol",
      name: r.node,
      // "" when the symbol isn't in the index (external / dynamic call).
      file_path: symFile ?? "",
    };
    return node;
  });
}

function walkFileGraph(db: CodemapDatabase, opts: WalkOpts): ImpactNode[] {
  const seedFile = opts.target.matched_in[0] ?? opts.target.name;
  const table = opts.backend === "imports" ? "imports" : "dependencies";
  // imports uses (file_path, resolved_path); dependencies uses (from_path, to_path).
  const fromCol = opts.backend === "imports" ? "file_path" : "from_path";
  const toCol = opts.backend === "imports" ? "resolved_path" : "to_path";
  const joinFromCol = opts.direction === "up" ? toCol : fromCol;
  const joinToCol = opts.direction === "up" ? fromCol : toCol;
  const edge: ImpactNode["edge"] =
    opts.backend === "imports"
      ? opts.direction === "up"
        ? "imported_by"
        : "imports"
      : opts.direction === "up"
        ? "depended_on_by"
        : "depends_on";

  const filterNonNull =
    opts.backend === "imports" ? `AND c.${joinToCol} IS NOT NULL` : "";

  const sql = `
    WITH RECURSIVE walk(node, depth, path) AS (
      SELECT ?, 0, ',' || ? || ','
      UNION ALL
      SELECT c.${joinToCol}, walk.depth + 1,
             walk.path || c.${joinToCol} || ','
      FROM ${table} c
      JOIN walk ON c.${joinFromCol} = walk.node
      WHERE walk.depth < ?
        AND instr(walk.path, ',' || c.${joinToCol} || ',') = 0
        ${filterNonNull}
    )
    SELECT node, MIN(depth) AS depth
    FROM walk
    WHERE depth > 0
    GROUP BY node
    ORDER BY depth ASC, node ASC
    LIMIT ?
  `;
  const rows = db
    .query(sql)
    .all(seedFile, seedFile, opts.depthLimit, opts.rowCap) as Array<{
    node: string;
    depth: number;
  }>;
  return rows.map((r) => ({
    depth: r.depth,
    direction: opts.direction,
    edge,
    kind: "file",
    file_path: r.node,
  }));
}

function lookupSymbolFile(
  db: CodemapDatabase,
  name: string,
): string | undefined {
  const r = db
    .query(
      "SELECT file_path FROM symbols WHERE name = ? ORDER BY file_path ASC LIMIT 1",
    )
    .get(name) as { file_path: string } | null;
  return r?.file_path;
}
