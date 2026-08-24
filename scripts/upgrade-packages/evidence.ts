/**
 * evidence.ts
 *
 * Deterministic evidence gatherer for the `upgrade-packages` skill.
 * Emits a JSON artifact the AI agent reads and judges — the agent never
 * touches the registry, GitHub, or GHSA directly. Citations (tarball notes
 * and kept patches, changelogUrl, advisory URL) are artifact fields, so
 * model priors can't sneak in.
 *
 * Usage:
 *   bun run upgrade-packages:evidence [--out <path>] [--only <pkg>]
 *   bun run upgrade-packages:evidence --only immer   # tracer bullet
 *
 * Defaults: --out scripts/upgrade-packages/artifact.json; cache colocated
 * at scripts/upgrade-packages/.cache/ (GHSA 1h, bun pm diff 7d). Artifact
 * schema: see `Evidence` type below.
 */

import { readdirSync } from "node:fs";

import type { BunPmDiffJson, Delta } from "./tarball-delta";
import {
  buildDelta,
  failedDelta,
  npmVersionUrl,
  selectPatchPaths,
} from "./tarball-delta";

// ────────────────────────────────────────────────────────────────────────────
// Types — the artifact contract the AI agent reads
// ────────────────────────────────────────────────────────────────────────────

type BumpClass = "patch" | "minor" | "major" | "prerelease" | "no-op";

interface OutdatedPkg {
  pkg: string;
  current: string;
  latest: string;
  bumpClass: BumpClass;
  coupledWith: string[]; // peer/dep that forces a higher band (filled naively here)
  dev: boolean;
}

interface AdvisoryVuln {
  id: string; // GHSA id
  cveId: string | null;
  severity: string;
  vulnerableRange: string | null;
  fixedIn: string | null;
  installedInRange: boolean; // script-computed vs installed version
  verdict:
    | "priority-bump"
    | "needs-higher-target"
    | "cleared-at-current"
    | "unpatched"
    | "check-failed"; // gh/parse/cache failure — inconclusive, not a real vuln
  url: string;
  error?: string;
}

interface Usage {
  importedSymbols: string[];
  typeOnlySymbols: string[];
  sites: string[]; // import file:line
  callSites: string[]; // reference file:line (codemap only)
  source: "codemap" | "grep";
}

interface Evidence {
  generatedAt: string;
  inventory: {
    direct: {
      name: string;
      version: string;
      range: "exact" | "caret" | "tilde";
      dev: boolean;
    }[];
    transitiveDuplicates: { pkg: string; versions: string[] }[];
  };
  outdated: OutdatedPkg[];
  audit: {
    bunAudit: unknown; // raw bun audit --json payload
    ghsa: { pkg: string; advisories: AdvisoryVuln[] }[];
  };
  deltas: Record<string, Delta[]>;
  usage: Record<string, Usage>;
}

// ────────────────────────────────────────────────────────────────────────────
// Shell helpers
// ────────────────────────────────────────────────────────────────────────────

async function run(
  cmd: string[],
  opts: { cwd?: string; retries?: number } = {},
): Promise<string> {
  const retries = opts.retries ?? 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (cmd[0] === "gh") await ghGate();
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      cwd: opts.cwd ?? process.cwd(),
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    if (code === 0) return stdout;
    if (attempt < retries) {
      // gh secondary rate-limit / transient failures: back off and retry.
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${cmd.join(" ")} exited ${code}\n${stderr.slice(0, 500)}`);
  }
  throw new Error("unreachable");
}

/** Run a command, return stdout even on non-zero exit (for tolerant gatherers). */
async function runSoft(
  cmd: string[],
): Promise<{ ok: boolean; stdout: string; code: number }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
  });
  // Drain stderr alongside stdout — a full pipe buffer deadlocks the subprocess.
  const [stdout, , code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, stdout, code };
}

// Pace `gh` calls to avoid GitHub's secondary rate limit (burst protection).
let lastGhCall = 0;
const GH_MIN_GAP_MS = 1000;
async function ghGate() {
  const wait = GH_MIN_GAP_MS - (Date.now() - lastGhCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGhCall = Date.now();
}

// ────────────────────────────────────────────────────────────────────────────
// Disk cache for gh release/advisory data — iterative runs don't re-fetch,
// so repeated runs (and re-runs after a rate-limit) are fast and don't re-trip it.
// ────────────────────────────────────────────────────────────────────────────

const SCRIPT_DIR = import.meta.dir;
const CACHE_DIR = `${SCRIPT_DIR}/.cache`;
const DEFAULT_OUT = `${SCRIPT_DIR}/artifact.json`;
const CACHE_MAX_AGE_MS = 1000 * 60 * 60; // 1 hour — GHSA can change
const PMDIFF_CACHE_MS = 1000 * 60 * 60 * 24 * 7; // published tarball pair is immutable
const DIFF_CONCURRENCY = 4;

function cachePath(key: string): string {
  return `${CACHE_DIR}/${key.replace(/[^a-z0-9._-]/gi, "_")}.json`;
}

async function readCache(
  key: string,
  maxAgeMs = CACHE_MAX_AGE_MS,
): Promise<string | null> {
  const f = Bun.file(cachePath(key));
  if (!(await f.exists())) return null;
  if (Date.now() - f.lastModified > maxAgeMs) return null;
  return await f.text();
}

async function writeCache(key: string, data: string): Promise<void> {
  try {
    // Bun.write auto-creates parent directories.
    await Bun.write(cachePath(key), data);
  } catch {
    // cache is best-effort
  }
}

/** bun emits a `[Xms] ".env"` header before JSON output — strip leading non-JSON lines. */
function stripBunHeader(s: string): string {
  const lines = s.split("\n");
  let i = 0;
  while (
    i < lines.length &&
    !lines[i].trim().startsWith("{") &&
    !lines[i].trim().startsWith("[")
  )
    i++;
  return lines.slice(i).join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Semver
// ────────────────────────────────────────────────────────────────────────────

function parseVer(v: string): number[] {
  const core = v.split(/[-+]/)[0];
  return core.split(".").map((n) => Number(n) || 0);
}

function cmpVer(a: string, b: string): number {
  const pa = parseVer(a);
  const pb = parseVer(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function isPrerelease(v: string): boolean {
  return /-(dev|canary|next|beta|alpha|rc|preview)/i.test(v);
}

/** 0.x semver: the second digit is the minor. */
function bumpClass(current: string, latest: string): BumpClass {
  if (cmpVer(current, latest) === 0) return "no-op";
  if (isPrerelease(latest) || isPrerelease(current)) return "prerelease";
  const [ca, cb] = parseVer(current);
  const [la, lb] = parseVer(latest);
  if (la !== ca) return "major";
  // 0.x: second digit is the minor
  if (ca === 0) return lb !== cb ? "minor" : "patch";
  return lb !== cb ? "minor" : "patch";
}

export function semverInRange(version: string, range: string | null): boolean {
  if (!range) return false;
  // Naive but covers the GHSA `vulnerable_version_range` shapes we see:
  // comma- or space-separated comparators (AND), and `||` groups (OR).
  // Not a full semver-range parser — `semver` is not added as a dep for a dev script.
  const orGroups = range.split("||");
  for (const group of orGroups) {
    // Split on commas OR whitespace between comparators (e.g. ">= 7.0.0 < 9.0.6").
    const clauses = group
      .split(/,|\s+(?=(?:>=|<=|>|<|=))/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (clauses.length === 0) continue;
    let groupOk = true;
    let parsed = 0;
    for (const clause of clauses) {
      const m = clause.match(/^(>=|<=|>|<|=)?\s*(\d[^-+]*)/);
      if (!m) {
        groupOk = false;
        break;
      }
      parsed += 1;
      const [, op, ver] = m;
      const c = cmpVer(version, ver);
      if (op === ">=" && !(c >= 0)) groupOk = false;
      if (op === ">" && !(c > 0)) groupOk = false;
      if (op === "<=" && !(c <= 0)) groupOk = false;
      if (op === "<" && !(c < 0)) groupOk = false;
      if ((!op || op === "=") && c !== 0) groupOk = false;
    }
    if (parsed > 0 && groupOk) return true;
  }
  return false;
}

export function ghsaVerdict(
  inRange: boolean,
  fixedIn: string | null,
  targetVer: string,
): AdvisoryVuln["verdict"] {
  if (inRange && fixedIn && targetVer && cmpVer(fixedIn, targetVer) <= 0) {
    return "priority-bump";
  }
  if (inRange && fixedIn && targetVer && cmpVer(fixedIn, targetVer) > 0) {
    return "needs-higher-target";
  }
  if (!inRange) return "cleared-at-current";
  return "unpatched";
}

// ────────────────────────────────────────────────────────────────────────────
// Gatherers
// ────────────────────────────────────────────────────────────────────────────

const HIGH_RISK = [
  "better-sqlite3",
  "oxc-parser",
  "oxc-resolver",
  "lightningcss",
  "zod",
  "@modelcontextprotocol/sdk",
  "chokidar",
  "tsdown",
];

function workspaceManifests(): string[] {
  const manifests = ["package.json"];
  for (const dir of ["packages", "apps"]) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          manifests.push(`${dir}/${entry.name}/package.json`);
        }
      }
    } catch {
      // Directory may not exist in this repo.
    }
  }
  return manifests;
}

async function parsePackageJson(): Promise<Evidence["inventory"]> {
  const direct: Evidence["inventory"]["direct"] = [];
  const classify = (v: string): "exact" | "caret" | "tilde" =>
    v.startsWith("^") ? "caret" : v.startsWith("~") ? "tilde" : "exact";
  const seen = new Set<string>();
  const add = (name: string, version: string, dev: boolean) => {
    if (version.startsWith("workspace:")) return;
    const key = `${name}@${version}:${dev}`;
    if (seen.has(key)) return;
    seen.add(key);
    direct.push({ name, version, range: classify(version), dev });
  };
  for (const manifest of workspaceManifests()) {
    const raw = await Bun.file(manifest)
      .text()
      .catch(() => "");
    if (!raw) continue;
    const pkg = JSON.parse(raw);
    for (const [name, version] of Object.entries<string>(
      pkg.dependencies ?? {},
    )) {
      add(name, version, false);
    }
    for (const [name, version] of Object.entries<string>(
      pkg.devDependencies ?? {},
    )) {
      add(name, version, true);
    }
  }
  // Transitive duplicates: parse bun.lock for packages resolved at multiple versions
  // where one version is a direct dep (the signal the skill cares about).
  const lock = await Bun.file("bun.lock")
    .text()
    .catch(() => "");
  const versionMap = new Map<string, Set<string>>();
  // bun.lock text format: `"name@version"` lines — collect all name@version.
  for (const m of lock.matchAll(/"(@?[^"@]+)@([^"@]+)"/g)) {
    const [, name, ver] = m;
    if (!versionMap.has(name)) versionMap.set(name, new Set());
    versionMap.get(name)!.add(ver);
  }
  const directNames = new Set(direct.map((d) => d.name));
  const transitiveDuplicates: Evidence["inventory"]["transitiveDuplicates"] =
    [];
  for (const [name, versions] of versionMap) {
    if (versions.size < 2) continue;
    const vers = [...versions];
    const hasDirect = directNames.has(name);
    const majorSplit = new Set(vers.map((v) => parseVer(v)[0])).size > 1;
    // Skill rule: flag only direct-dep conflicts or semver-major splits.
    if (hasDirect || majorSplit) {
      transitiveDuplicates.push({
        pkg: name,
        versions: vers.sort((a, b) => cmpVer(a, b)),
      });
    }
  }
  return { direct, transitiveDuplicates };
}

export function parseOutdatedTable(stdout: string): OutdatedPkg[] {
  const out: OutdatedPkg[] = [];
  const seen = new Set<string>();
  // Root table: | Package | Current | Update | Latest |
  // Workspace table (`bun outdated --filter '*'`): extra trailing Workspace column.
  // Display suffixes: " (dev)" / " (peer)" / " (optional)".
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((s) => s.trim());
    if (cells.length < 4) continue;
    const [pkgRaw, current, , latest] = cells;
    if (!pkgRaw || pkgRaw === "Package" || pkgRaw.startsWith("---")) continue;
    if (!current || !latest || current === latest) continue;
    const isDev = /\s*\(dev\)\s*$/.test(pkgRaw);
    const pkg = pkgRaw.replace(/\s*\((?:dev|peer|optional)\)\s*$/, "");
    const key = `${pkg}@${current}->${latest}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      pkg,
      current,
      latest,
      bumpClass: bumpClass(current, latest),
      coupledWith: [],
      dev: isDev,
    });
  }
  return out;
}

async function parseBunOutdated(): Promise<OutdatedPkg[]> {
  // `--filter '*'` covers every workspace package (root-only `bun outdated`
  // misses per-package deps). Adds a trailing Workspace column.
  const { ok, stdout, code } = await runSoft([
    "bun",
    "outdated",
    "--filter",
    "*",
  ]);
  const out = parseOutdatedTable(stdout);
  if (!ok && out.length === 0) {
    throw new Error(`bun outdated exited ${code} with no parseable rows`);
  }
  return out;
}

async function runBunAudit(): Promise<unknown> {
  const { stdout } = await runSoft(["bun", "audit", "--json"]);
  const body = stripBunHeader(stdout);
  try {
    return JSON.parse(body);
  } catch {
    return {
      error: "could not parse bun audit output",
      raw: body.slice(0, 500),
    };
  }
}

async function fetchGhsaList(pkg: string): Promise<unknown[]> {
  return cachedParsed(
    `ghsa:${pkg}`,
    CACHE_MAX_AGE_MS,
    () =>
      run(
        [
          "gh",
          "api",
          "-X",
          "GET",
          "/advisories",
          "-f",
          "ecosystem=npm",
          "-f",
          `affects=${pkg}`,
        ],
        { retries: 2 },
      ),
    (raw) => {
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) {
        throw new Error(
          `non-array response from gh api advisories: ${String(list).slice(0, 120)}`,
        );
      }
      return list;
    },
  );
}

function advisoryFromGhsa(
  a: {
    ghsa_id: string;
    cve_id?: string | null;
    severity?: string;
    vulnerabilities?: {
      package?: { name?: string };
      vulnerable_version_range?: string | null;
      first_patched_version?: { identifier?: string } | string | null;
    }[];
  },
  pkg: string,
  installed: Map<string, string>,
  target: Map<string, string>,
): AdvisoryVuln {
  const vuln =
    a.vulnerabilities?.find((v) => v.package?.name === pkg) ??
    a.vulnerabilities?.[0] ??
    {};
  const range = vuln.vulnerable_version_range ?? null;
  const patched = vuln.first_patched_version;
  const fixedIn =
    typeof patched === "string" ? patched : (patched?.identifier ?? null);
  const installedVer = installed.get(pkg) ?? "";
  const targetVer = target.get(pkg) ?? "";
  const inRange = installedVer ? semverInRange(installedVer, range) : false;
  return {
    id: a.ghsa_id,
    cveId: a.cve_id ?? null,
    severity: a.severity ?? "unknown",
    vulnerableRange: range,
    fixedIn,
    installedInRange: inRange,
    verdict: ghsaVerdict(inRange, fixedIn, targetVer),
    url: `https://github.com/advisories/${a.ghsa_id}`,
  };
}

function ghsaCheckFailed(
  pkg: string,
  e: unknown,
): Evidence["audit"]["ghsa"][number] {
  return {
    pkg,
    advisories: [
      {
        id: "error",
        cveId: null,
        severity: "unknown",
        vulnerableRange: null,
        fixedIn: null,
        installedInRange: false,
        verdict: "check-failed",
        url: "",
        error: e instanceof Error ? e.message : String(e),
      },
    ],
  };
}

async function ghsaSpotCheck(
  pkgs: string[],
  installed: Map<string, string>,
  target: Map<string, string>,
): Promise<Evidence["audit"]["ghsa"]> {
  const out: Evidence["audit"]["ghsa"] = [];
  for (const pkg of pkgs) {
    try {
      const list = await fetchGhsaList(pkg);
      out.push({
        pkg,
        advisories: list.map((a) =>
          advisoryFromGhsa(
            a as Parameters<typeof advisoryFromGhsa>[0],
            pkg,
            installed,
            target,
          ),
        ),
      });
    } catch (e) {
      out.push(ghsaCheckFailed(pkg, e));
    }
  }
  return out;
}

async function cachedParsed<T>(
  key: string,
  maxAgeMs: number,
  fetchText: () => Promise<string>,
  parse: (raw: string) => T,
): Promise<T> {
  const cached = await readCache(key, maxAgeMs);
  if (cached) return parse(cached);
  const raw = await fetchText();
  const value = parse(raw);
  await writeCache(key, raw);
  return value;
}

function parseDiffJson(raw: string, label: string): BunPmDiffJson {
  const body = stripBunHeader(raw);
  const data: unknown = JSON.parse(body);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${label}: expected a JSON object`);
  }
  const obj = data as Record<string, unknown>;
  if ("files" in obj && !Array.isArray(obj.files)) {
    throw new Error(`${label}: files must be an array`);
  }
  if ("notes" in obj && !Array.isArray(obj.notes)) {
    throw new Error(`${label}: notes must be an array`);
  }
  return data as BunPmDiffJson;
}

/** One current→target tarball span via `bun pm diff`. Stat first, then patches for keep-paths. */
async function gatherDeltas(
  pkg: string,
  current: string,
  target: string,
  importedSymbols: string[],
): Promise<Delta[]> {
  const changelogUrl = npmVersionUrl(pkg, target);
  try {
    const spec = `${pkg}@${current}`;
    const range = `${pkg}@${current}..${target}`;
    const stat = await cachedParsed(
      `pmdiff-stat:${range}`,
      PMDIFF_CACHE_MS,
      () =>
        run(["bun", "pm", "diff", spec, target, "--json", "--stat"], {
          retries: 1,
        }),
      (raw) => parseDiffJson(raw, `bun pm diff --stat ${range}`),
    );
    const patchPaths = selectPatchPaths(stat.files ?? [], importedSymbols);
    let patches: BunPmDiffJson | null = null;
    if (patchPaths.length > 0) {
      const patchKey = `pmdiff-patch:${range}:${Bun.hash(patchPaths.join("\0")).toString(16)}`;
      patches = await cachedParsed(
        patchKey,
        PMDIFF_CACHE_MS,
        () =>
          run(["bun", "pm", "diff", spec, target, "--json", ...patchPaths], {
            retries: 1,
          }),
        (raw) => parseDiffJson(raw, `bun pm diff patches ${range}`),
      );
    }
    return [buildDelta({ target, changelogUrl, stat, patches })];
  } catch (e) {
    return [
      failedDelta(
        target,
        changelogUrl,
        e instanceof Error ? e.message : String(e),
      ),
    ];
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  const n = Math.min(concurrency, items.length);
  if (n === 0) return out;
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Codemap (parsed imports + call sites) — primary usage source, grep fallback
// ────────────────────────────────────────────────────────────────────────────

let codemapAvailable: boolean | null = null;

async function checkCodemap(): Promise<boolean> {
  if (codemapAvailable !== null) return codemapAvailable;
  const { ok } = await runSoft([
    "bunx",
    "codemap",
    "query",
    "--json",
    "SELECT 1 AS ok",
  ]);
  codemapAvailable = ok;
  return codemapAvailable;
}

async function codemapQuery(sql: string): Promise<any[]> {
  const raw = stripBunHeader(
    await run(["bunx", "codemap", "query", "--json", sql], {
      retries: 1,
    }),
  );
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function parseSpecifiers(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    // fall through
  }
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Batched codemap usage: 2 SQL calls total for ALL packages (vs 2 per package).
 * 1) all imports whose source matches any outdated pkg (exact or subpath)
 * 2) all imported references in any of those importing files
 * Then bucket per package in JS, scoping callSites to each pkg's importing files + specifiers.
 */
async function gatherAllUsage(pkgs: string[]): Promise<Map<string, Usage>> {
  const result = new Map<string, Usage>();
  if (!pkgs.length) return result;
  if (!(await checkCodemap())) return result; // caller falls back to grep per package

  // Build WHERE: source IN (pkgs) OR source LIKE 'pkg/%' OR ...
  const inList = pkgs.map((p) => `'${sqlEscape(p)}'`).join(",");
  const likeClauses = pkgs
    .map((p) => `source LIKE '${sqlEscape(p)}/%'`)
    .join(" OR ");
  const importRows = await codemapQuery(
    `SELECT source, file_path, line_number, specifiers, is_type_only FROM imports WHERE source IN (${inList}) OR ${likeClauses}`,
  );

  // Bucket imports per package (exact source, or subpath source.startsWith(pkg + '/'))
  const perPkg = new Map<
    string,
    {
      sites: Set<string>;
      imported: Set<string>;
      typeOnly: Set<string>;
      files: Set<string>;
    }
  >();
  for (const p of pkgs)
    perPkg.set(p, {
      sites: new Set(),
      imported: new Set(),
      typeOnly: new Set(),
      files: new Set(),
    });

  for (const r of importRows) {
    const pkg = pkgs.find(
      (p) => r.source === p || r.source.startsWith(p + "/"),
    );
    if (!pkg) continue;
    const bucket = perPkg.get(pkg)!;
    bucket.sites.add(`${r.file_path}:${r.line_number}`);
    bucket.files.add(r.file_path);
    for (const s of parseSpecifiers(r.specifiers)) {
      (r.is_type_only ? bucket.typeOnly : bucket.imported).add(s);
    }
  }

  // Batched references query: all imported refs in any importing file, with name.
  const allFiles = new Set<string>();
  const allSpecs = new Set<string>();
  for (const b of perPkg.values()) {
    for (const f of b.files) allFiles.add(f);
    for (const s of b.imported) allSpecs.add(s);
    for (const s of b.typeOnly) allSpecs.add(s);
  }
  const refByFile = new Map<string, { name: string; line: number }[]>();
  if (allFiles.size && allSpecs.size) {
    const fileList = [...allFiles].map((f) => `'${sqlEscape(f)}'`).join(",");
    const specList = [...allSpecs].map((s) => `'${sqlEscape(s)}'`).join(",");
    const refRows = await codemapQuery(
      `SELECT r.file_path, r.line_start, r.name FROM "references" r JOIN bindings b ON b.reference_id = r.id WHERE b.resolution_kind='imported' AND r.name IN (${specList}) AND r.file_path IN (${fileList})`,
    );
    for (const r of refRows) {
      const key = r.file_path;
      if (!refByFile.has(key)) refByFile.set(key, []);
      refByFile.get(key)!.push({ name: r.name, line: r.line_start });
    }
  }

  for (const [pkg, b] of perPkg) {
    const specs = new Set<string>([...b.imported, ...b.typeOnly]);
    const callSites = new Set<string>();
    for (const f of b.files) {
      for (const ref of refByFile.get(f) ?? []) {
        if (specs.has(ref.name)) callSites.add(`${f}:${ref.line}`);
      }
    }
    result.set(pkg, {
      importedSymbols: [...b.imported].slice(0, 30),
      typeOnlySymbols: [...b.typeOnly].slice(0, 30),
      sites: [...b.sites].slice(0, 30),
      callSites: [...callSites].slice(0, 30),
      source: "codemap",
    });
  }
  return result;
}

async function grepUsage(pkg: string): Promise<Usage> {
  // Fallback when codemap is unavailable. Match `from "<pkg>"` / `from "<pkg>/subpath`.
  const pattern = `from ['"]${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/[^'"]*)?['"]`;
  const { stdout } = await runSoft([
    "rg",
    "-n",
    "--type",
    "ts",
    "-g",
    "!**/node_modules/**",
    pattern,
  ]);
  const sites: string[] = [];
  const imported = new Set<string>();
  for (const line of stdout.split("\n").filter(Boolean)) {
    const m = line.match(/^([^:]+):(\d+):.*(import\s+([^]*?)\s+from)/);
    if (m) {
      sites.push(`${m[1]}:${m[2]}`);
      m[4]
        .replace(/[{}\s]/g, "")
        .split(",")
        .forEach((s) => s && imported.add(s));
    }
  }
  return {
    importedSymbols: [...imported].slice(0, 20),
    typeOnlySymbols: [],
    sites: sites.slice(0, 12),
    callSites: [],
    source: "grep",
  };
}

/** Gather usage for a set of packages: batched codemap, with per-package grep fallback. */
async function gatherAllUsageWithFallback(
  pkgs: string[],
): Promise<Map<string, Usage>> {
  try {
    const mapped = await gatherAllUsage(pkgs);
    if (mapped.size === pkgs.length) return mapped;
    // codemap returned partial — fill gaps with grep
    for (const p of pkgs) {
      if (!mapped.has(p)) mapped.set(p, await grepUsage(p));
    }
    return mapped;
  } catch {
    const mapped = new Map<string, Usage>();
    for (const p of pkgs) mapped.set(p, await grepUsage(p));
    return mapped;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf("--only");
  const onlyPkg = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : DEFAULT_OUT;

  console.error("→ inventory");
  const inventory = await parsePackageJson();
  const installed = new Map(
    inventory.direct.map((d) => [d.name, d.version.replace(/^[~^]/, "")]),
  );

  console.error("→ bun outdated");
  let outdated = await parseBunOutdated();
  if (onlyPkg) outdated = outdated.filter((o) => o.pkg === onlyPkg);
  const target = new Map(outdated.map((o) => [o.pkg, o.latest]));

  console.error("→ bun audit + ghsa");
  const ghsaPkgs = (onlyPkg ? [onlyPkg] : HIGH_RISK).filter(
    (p) => installed.has(p) || target.has(p),
  );
  const [bunAudit, ghsa] = await Promise.all([
    runBunAudit(),
    ghsaSpotCheck(ghsaPkgs, installed, target),
  ]);

  console.error("→ usage (batched codemap)");
  const usageMap = await gatherAllUsageWithFallback(outdated.map((o) => o.pkg));
  const usage: Record<string, Usage> = {};
  for (const o of outdated) {
    const u = usageMap.get(o.pkg);
    if (!u) throw new Error(`usage missing for ${o.pkg}`);
    usage[o.pkg] = u;
  }

  console.error(`→ deltas (bun pm diff, ${DIFF_CONCURRENCY} at a time)`);
  const deltaEntries = await mapPool(outdated, DIFF_CONCURRENCY, async (o) => {
    console.error(`   ${o.pkg} ${o.current} → ${o.latest}`);
    const u = usage[o.pkg];
    const symbols = [
      ...(u?.importedSymbols ?? []),
      ...(u?.typeOnlySymbols ?? []),
    ];
    return [
      o.pkg,
      await gatherDeltas(o.pkg, o.current, o.latest, symbols),
    ] as const;
  });
  const deltas: Record<string, Delta[]> = {};
  for (const [pkg, list] of deltaEntries) deltas[pkg] = list;

  const evidence: Evidence = {
    generatedAt: new Date().toISOString(),
    inventory,
    outdated,
    audit: { bunAudit, ghsa },
    deltas,
    usage,
  };

  const json = JSON.stringify(evidence, null, 2);
  if (outPath) {
    await Bun.write(outPath, json);
    console.error(`✓ wrote ${outPath}`);
  } else {
    console.log(json);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error("fatal:", e);
    process.exit(1);
  });
}
