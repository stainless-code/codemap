/**
 * upgrade-packages-evidence.ts
 *
 * Deterministic evidence gatherer for the `upgrade-packages` skill.
 * Emits a JSON artifact the AI agent reads and judges — the agent never
 * touches the registry, GitHub, or GHSA directly. Citations (diffUrl,
 * changelogUrl, advisory URL) are artifact fields, so model priors can't
 * sneak in.
 *
 * Usage:
 *   bun run scripts/upgrade-packages-evidence.ts [--out <path>] [--only <pkg>]
 *   bun run scripts/upgrade-packages-evidence.ts --only immer   # tracer bullet
 *
 * Artifact schema: see `Evidence` type below.
 */

// `export {}` keeps this file a Module (not a global Script) so its `main`
// doesn't collide with other script-mode files' `main` under tsgo.
export {};

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

interface Delta {
  version: string;
  date: string | null;
  breaking: string[];
  deprecations: string[];
  features: string[];
  security: string[];
  peerEngine: string[];
  releaseNotes: string | null; // raw body, truncated
  diffUrl: string | null; // github.com/<o>/<r>/compare/<prev>...<tag>
  changelogUrl: string | null;
  source: "github-release" | "none";
  error: string | null;
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
const CACHE_MAX_AGE_MS = 1000 * 60 * 60; // 1 hour

function cachePath(key: string): string {
  return `${CACHE_DIR}/${key.replace(/[^a-z0-9._-]/gi, "_")}.json`;
}

async function readCache(key: string): Promise<string | null> {
  const f = Bun.file(cachePath(key));
  if (!(await f.exists())) return null;
  if (Date.now() - f.lastModified > CACHE_MAX_AGE_MS) return null;
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

function semverInRange(version: string, range: string | null): boolean {
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
    for (const clause of clauses) {
      const m = clause.match(/^(>=|<=|>|<|=)?\s*(\d[^-+]*)/);
      if (!m) continue;
      const [, op, ver] = m;
      const c = cmpVer(version, ver);
      if (op === ">=" && !(c >= 0)) groupOk = false;
      if (op === ">" && !(c > 0)) groupOk = false;
      if (op === "<=" && !(c <= 0)) groupOk = false;
      if (op === "<" && !(c < 0)) groupOk = false;
      if ((!op || op === "=") && c !== 0) groupOk = false;
    }
    if (groupOk) return true;
  }
  return false;
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

async function parsePackageJson(): Promise<Evidence["inventory"]> {
  const pkg = JSON.parse(await Bun.file("package.json").text());
  const direct: Evidence["inventory"]["direct"] = [];
  const classify = (v: string): "exact" | "caret" | "tilde" =>
    v.startsWith("^") ? "caret" : v.startsWith("~") ? "tilde" : "exact";
  for (const [name, version] of Object.entries<string>(
    pkg.dependencies ?? {},
  )) {
    direct.push({ name, version, range: classify(version), dev: false });
  }
  for (const [name, version] of Object.entries<string>(
    pkg.devDependencies ?? {},
  )) {
    direct.push({ name, version, range: classify(version), dev: true });
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

async function parseBunOutdated(): Promise<OutdatedPkg[]> {
  const { stdout } = await runSoft(["bun", "outdated"]);
  const out: OutdatedPkg[] = [];
  // Table rows: | <pkg> | <current> | <update> | <latest> |
  for (const line of stdout.split("\n")) {
    const m = line.match(
      /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/,
    );
    if (!m) continue;
    const [, pkg, current, , latest] = m.map((s) => s.trim());
    if (pkg === "Package" || pkg.startsWith("---")) continue;
    if (current === latest) continue;
    out.push({
      pkg,
      current,
      latest,
      bumpClass: bumpClass(current, latest),
      coupledWith: [],
    });
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

async function ghsaSpotCheck(
  pkgs: string[],
  installed: Map<string, string>,
  target: Map<string, string>,
): Promise<Evidence["audit"]["ghsa"]> {
  const out: Evidence["audit"]["ghsa"] = [];
  for (const pkg of pkgs) {
    try {
      const cacheKey = `ghsa:${pkg}`;
      const cached = await readCache(cacheKey);
      const raw =
        cached ??
        (await run(
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
        ));
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) {
        throw new Error(
          `non-array response from gh api advisories: ${String(list).slice(0, 120)}`,
        );
      }
      if (!cached) await writeCache(cacheKey, JSON.stringify(list));
      const advisories: AdvisoryVuln[] = [];
      for (const a of list) {
        const vuln =
          a.vulnerabilities?.find((v: any) => v.package?.name === pkg) ??
          a.vulnerabilities?.[0] ??
          {};
        const range: string | null = vuln.vulnerable_version_range ?? null;
        const fixedIn: string | null =
          vuln.first_patched_version?.identifier ??
          vuln.first_patched_version ??
          null;
        const installedVer = installed.get(pkg) ?? "";
        const targetVer = target.get(pkg) ?? "";
        const inRange = installedVer
          ? semverInRange(installedVer, range)
          : false;
        let verdict: AdvisoryVuln["verdict"] = "unpatched";
        if (inRange && fixedIn && targetVer && cmpVer(fixedIn, targetVer) <= 0)
          verdict = "priority-bump";
        else if (
          inRange &&
          fixedIn &&
          targetVer &&
          cmpVer(fixedIn, targetVer) > 0
        )
          verdict = "needs-higher-target";
        else if (!inRange) verdict = "cleared-at-current";
        advisories.push({
          id: a.ghsa_id,
          cveId: a.cve_id ?? null,
          severity: a.severity ?? "unknown",
          vulnerableRange: range,
          fixedIn,
          installedInRange: inRange,
          verdict,
          url: `https://github.com/advisories/${a.ghsa_id}`,
        });
      }
      out.push({ pkg, advisories });
    } catch (e) {
      out.push({
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
      });
    }
  }
  return out;
}

async function getRepoSlug(
  pkg: string,
): Promise<{ owner: string; repo: string } | null> {
  try {
    const raw = stripBunHeader(
      await run(["bun", "pm", "view", pkg, "repository", "--json"], {
        retries: 2,
      }),
    );
    const data = JSON.parse(raw);
    const url: string = data.url ?? "";
    // Preserve dots in repo names (e.g. mozilla/pdf.js); strip a trailing .git.
    const m = url.match(
      /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#].*)?$/,
    );
    return m ? { owner: m[1], repo: m[2] } : null;
  } catch {
    return null;
  }
}

async function getVersions(pkg: string): Promise<string[]> {
  try {
    const raw = stripBunHeader(
      await run(["bun", "pm", "view", pkg, "versions", "--json"], {
        retries: 2,
      }),
    );
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Walk the changelog between current and target. Naive categorization of release body. */
async function gatherDeltas(
  pkg: string,
  current: string,
  target: string,
): Promise<Delta[]> {
  if (isPrerelease(target) || isPrerelease(current)) {
    return [
      {
        version: target,
        date: null,
        breaking: [],
        deprecations: [],
        features: [],
        security: [],
        peerEngine: [],
        releaseNotes: null,
        diffUrl: null,
        changelogUrl: null,
        source: "none",
        error:
          "prerelease/moving-target build — no per-version changelog; gate on same-major-line only",
      },
    ];
  }
  const slug = await getRepoSlug(pkg);
  if (!slug) {
    return [
      {
        version: target,
        date: null,
        breaking: [],
        deprecations: [],
        features: [],
        security: [],
        peerEngine: [],
        releaseNotes: null,
        diffUrl: null,
        changelogUrl: null,
        source: "none",
        error: "no github repository found",
      },
    ];
  }
  const { owner, repo } = slug;
  const allVersions = await getVersions(pkg);
  const inRange = allVersions
    .filter(
      (v) =>
        !isPrerelease(v) && cmpVer(v, current) > 0 && cmpVer(v, target) <= 0,
    )
    .sort((a, b) => cmpVer(a, b));

  // Fetch the repo's release list once and map version → actual tag name.
  // Handles v<x>, <x>, @scope/pkg@<x>, release-<date>, etc. — whatever the repo uses.
  const releases = await fetchReleaseMap(owner, repo);
  const tagOf = (v: string): string | null => releases.get(v)?.tagName ?? null;

  const deltas: Delta[] = [];
  let prevTag = tagOf(current) ?? `v${current}`;
  for (const v of inRange) {
    const rel = tagOf(v) ? releases.get(v) : null;
    const tag = rel?.tagName ?? null;
    const diffUrl = tag
      ? `https://github.com/${owner}/${repo}/compare/${prevTag}...${tag}`
      : null;
    const body = rel?.body ?? null;
    const date = rel?.publishedAt ?? null;
    const source: Delta["source"] = rel ? "github-release" : "none";
    const error = rel
      ? null
      : `no github release for ${pkg}@${v} (${releases.size} releases scanned — likely a gh secondary rate-limit or monorepo squashed release; deep-dive via changelogUrl)`;
    // Always provide a deep-dive link: the specific tag release page when known,
    // else the repo's releases page (so the model can browse tags when the script couldn't).
    const changelogUrl = tag
      ? `https://github.com/${owner}/${repo}/releases/tag/${tag}`
      : `https://github.com/${owner}/${repo}/releases`;
    deltas.push({
      version: v,
      date,
      breaking: extractLines(body, /breaking|breaking change/i),
      deprecations: extractLines(body, /deprecat|removed export/i),
      features: extractLines(body, /^feat|feature|^add|^new/i),
      security: extractLines(
        body,
        /security|cve|prototype pollution|vulnerabilit/i,
      ),
      peerEngine: extractLines(
        body,
        /peer dep|engine|requires (node|bun|react)/i,
      ),
      releaseNotes: body,
      diffUrl,
      changelogUrl,
      source,
      error,
    });
    if (tag) prevTag = tag;
  }
  if (deltas.length === 0) {
    deltas.push({
      version: target,
      date: null,
      breaking: [],
      deprecations: [],
      features: [],
      security: [],
      peerEngine: [],
      releaseNotes: null,
      diffUrl: null,
      changelogUrl: null,
      source: "none",
      error: "no versions found in range",
    });
  }
  return deltas;
}

/** Fetch a repo's releases (with bodies) in one paginated call. Maps version → release. */
async function fetchReleaseMap(
  owner: string,
  repo: string,
): Promise<
  Map<
    string,
    { tagName: string; publishedAt: string | null; body: string | null }
  >
> {
  const map = new Map<
    string,
    { tagName: string; publishedAt: string | null; body: string | null }
  >();
  const cacheKey = `releases:${owner}/${repo}`;
  try {
    const cached = await readCache(cacheKey);
    const raw =
      cached ??
      (await run([
        "gh",
        "api",
        `repos/${owner}/${repo}/releases?per_page=100`,
      ]));
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) {
      // gh returns a JSON object (e.g. {"message":"secondary rate limit"}) on rate-limit — not an array.
      throw new Error(
        `non-array response from gh api releases: ${String(raw).slice(0, 120)}`,
      );
    }
    if (!cached) await writeCache(cacheKey, JSON.stringify(list));
    for (const r of list) {
      const m = (r.tag_name as string).match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
      if (m)
        map.set(m[1], {
          tagName: r.tag_name,
          publishedAt: r.published_at ?? null,
          body: r.body ? String(r.body).slice(0, 1200) : null,
        });
    }
  } catch {
    // repo has no releases or gh failed (secondary rate-limit / not found) — empty map; caller records error per version.
  }
  return map;
}

function extractLines(body: string | null, re: RegExp): string[] {
  if (!body) return [];
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => re.test(l) && l.length > 0)
    .slice(0, 6)
    .map((l) => l.replace(/^[#*\-\s]+/, "").slice(0, 160));
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

  console.error("→ bun audit");
  const bunAudit = await runBunAudit();

  console.error("→ ghsa spot-check");
  const ghsaPkgs = (onlyPkg ? [onlyPkg] : HIGH_RISK).filter(
    (p) => installed.has(p) || target.has(p),
  );
  const ghsa = await ghsaSpotCheck(ghsaPkgs, installed, target);

  console.error("→ deltas");
  const deltas: Record<string, Delta[]> = {};
  for (const o of outdated) {
    console.error(`   ${o.pkg} ${o.current} → ${o.latest}`);
    deltas[o.pkg] = await gatherDeltas(o.pkg, o.current, o.latest);
  }

  console.error("→ usage (batched codemap)");
  const usageMap = await gatherAllUsageWithFallback(outdated.map((o) => o.pkg));
  const usage: Record<string, Usage> = {};
  for (const o of outdated)
    usage[o.pkg] = usageMap.get(o.pkg) ?? (await grepUsage(o.pkg));

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

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
