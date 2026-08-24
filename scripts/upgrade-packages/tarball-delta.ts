/**
 * Slim + classify a `bun pm diff --json` payload for the upgrade-packages
 * artifact. Pure — no registry, no gh. evidence.ts fetches; this file judges
 * what the agent is allowed to read.
 */

export const PATCH_MAX_CHARS = 8_000;
const RELEASE_NOTES_MAX_CHARS = 1_200;
export const FILE_LIST_CAP = 80;
export const PATCH_PATH_CAP = 40;
const HINT_CAP = 8;

export interface TarballFile {
  path: string;
  status: string;
  linesAdded: number;
  linesRemoved: number;
  formattingOnly: boolean;
  patch: string | null;
}

export interface TarballDiff {
  from: string;
  to: string;
  notes: string[];
  totals: {
    files: number;
    added: number;
    deleted: number;
    linesAdded: number;
    linesRemoved: number;
    formattingOnly: number;
  };
  files: TarballFile[];
}

export interface Delta {
  version: string;
  date: string | null;
  breaking: string[];
  deprecations: string[];
  features: string[];
  security: string[];
  peerEngine: string[];
  releaseNotes: string | null;
  changelogUrl: string;
  tarball: TarballDiff | null;
  source: "bun-pm-diff" | "none";
  error: string | null;
}

export interface BunPmDiffFile {
  path: string;
  status?: string;
  sourceMap?: boolean;
  formattingOnly?: boolean;
  linesAdded?: number;
  linesRemoved?: number;
  patch?: string;
}

export interface BunPmDiffJson {
  from?: string;
  to?: string;
  notes?: unknown;
  totals?: {
    files?: number;
    added?: number;
    deleted?: number;
    linesAdded?: number;
    linesRemoved?: number;
    formattingOnly?: number;
  };
  files?: BunPmDiffFile[];
}

const KEEP_NAME =
  /^(package\.json|changelog.*|history(?:\.(md|txt))?|news(?:\.(md|txt))?|changes(?:\.(md|txt))?|readme.*)$/i;
const DTS_EXT = /\.d\.[cm]?ts$/i;
const CHANGELOG_NAME = /^(changelog|history|news|changes)/i;

function fileName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

export function isSkipFile(
  file: Pick<BunPmDiffFile, "path" | "sourceMap">,
): boolean {
  return Boolean(file.sourceMap) || file.path.endsWith(".map");
}

function isMinifiedPath(path: string): boolean {
  return /\.(min|production)\.(m|c)?js$/i.test(path);
}

function isKeepName(path: string): boolean {
  return KEEP_NAME.test(fileName(path));
}

function isDtsPath(path: string): boolean {
  return DTS_EXT.test(path);
}

export function isKeepPath(path: string): boolean {
  return isKeepName(path) || isDtsPath(path);
}

function isChangelogPath(path: string): boolean {
  return CHANGELOG_NAME.test(fileName(path));
}

export function npmVersionUrl(pkg: string, version: string): string {
  return `https://www.npmjs.com/package/${pkg}/v/${version}`;
}

function churn(
  file: Pick<BunPmDiffFile, "linesAdded" | "linesRemoved">,
): number {
  return (file.linesAdded ?? 0) + (file.linesRemoved ?? 0);
}

function byChurnDesc(a: BunPmDiffFile, b: BunPmDiffFile): number {
  return churn(b) - churn(a);
}

function pathMentionsSymbol(path: string, symbols: string[]): boolean {
  return symbols.some((s) => s.length >= 2 && path.includes(s));
}

/** Paths to request on the second `bun pm diff` (patches only). */
export function selectPatchPaths(
  files: BunPmDiffFile[],
  importedSymbols: string[] = [],
): string[] {
  const usable = files.filter(
    (f) => f.path && !isSkipFile(f) && !f.formattingOnly,
  );
  const named = usable.filter((f) => isKeepName(f.path));
  const namedSet = new Set(named);
  const dts = usable.filter((f) => isDtsPath(f.path) && !namedSet.has(f));
  const namedOrDts = new Set([...named, ...dts]);
  const extra = usable.filter(
    (f) => !namedOrDts.has(f) && !isMinifiedPath(f.path),
  );
  const bySymbolThenChurn = (a: BunPmDiffFile, b: BunPmDiffFile): number => {
    const aHit = pathMentionsSymbol(a.path, importedSymbols) ? 1 : 0;
    const bHit = pathMentionsSymbol(b.path, importedSymbols) ? 1 : 0;
    if (aHit !== bHit) return bHit - aHit;
    return byChurnDesc(a, b);
  };
  extra.sort(bySymbolThenChurn);
  return [
    ...named.map((f) => f.path),
    ...[...dts].sort(bySymbolThenChurn).map((f) => f.path),
    ...extra.map((f) => f.path),
  ].slice(0, PATCH_PATH_CAP);
}

export function addedPatchLines(patch: string): string {
  return patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
}

export function extractDate(text: string): string | null {
  const m = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return m ? m[1] : null;
}

function extractHintLines(body: string, re: RegExp): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && re.test(l))
    .slice(0, HINT_CAP)
    .map((l) => l.replace(/^[#*\-\s]+/, "").slice(0, 160));
}

const HEADING = /^(#{1,6}\s+|[A-Z][\w\s]{2,}:$)/;

type HintKey =
  | "breaking"
  | "deprecations"
  | "features"
  | "security"
  | "peerEngine";

interface HintBuckets {
  breaking: string[];
  deprecations: string[];
  features: string[];
  security: string[];
  peerEngine: string[];
}

const HINT_KEYS: HintKey[] = [
  "breaking",
  "deprecations",
  "features",
  "security",
  "peerEngine",
];

const HEADING_BUCKET: [RegExp, HintKey][] = [
  [/breaking/i, "breaking"],
  [/deprecat/i, "deprecations"],
  [/security|advisory|\bcve\b/i, "security"],
  [/\bfeat/i, "features"],
  [/^#{1,6}\s+add/i, "features"],
  [/peer|engine/i, "peerEngine"],
];

const DOC_HINTS: [HintKey, RegExp][] = [
  ["breaking", /breaking|breaking change/i],
  ["deprecations", /deprecat|removed export/i],
  ["features", /^feat|feature|^add|^new/i],
  ["security", /security|cve|prototype pollution|vulnerabilit/i],
  ["peerEngine", /peer dep|engine|requires (node|bun|react)/i],
];

function emptyHints(): HintBuckets {
  return {
    breaking: [],
    deprecations: [],
    features: [],
    security: [],
    peerEngine: [],
  };
}

function headingBucket(line: string): HintKey | null {
  for (const [re, key] of HEADING_BUCKET) {
    if (re.test(line)) return key;
  }
  return null;
}

export function classifyChangelogLines(added: string): HintBuckets {
  const out = emptyHints();
  let section: HintKey | null = null;
  for (const raw of added.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (HEADING.test(line)) {
      section = headingBucket(line);
      continue;
    }
    if (!section) continue;
    const item = line.replace(/^[#*\-\s]+/, "").slice(0, 160);
    if (item) out[section].push(item);
  }
  return out;
}

export function classifyNote(
  note: string,
): "security" | "peerEngine" | "features" | "breaking" | null {
  if (
    /(preinstall|postinstall|preuninstall|install script|child_process|\bvm\b|eval\(|new Function|process\.env)/i.test(
      note,
    )
  ) {
    return "security";
  }
  // New `fs`/`net` imports are called out in notes; bare "fs" in a dep name is not.
  if (/\b(fs|net|http)\b/.test(note) && /import/i.test(note)) return "security";
  if (/breaking/i.test(note)) return "breaking";
  if (/(engine|peer|dependenc)/i.test(note)) return "peerEngine";
  if (/(export|entry[- ]?point|binar|\bmain\b|\bmodule\b)/i.test(note)) {
    return "features";
  }
  return null;
}

export function shouldKeepPatch(path: string, patch: string | null): boolean {
  if (!patch) return false;
  if (isMinifiedPath(path)) return false;
  return true;
}

function mergeDiffFiles(
  stat: BunPmDiffJson,
  patches: BunPmDiffJson | null,
): BunPmDiffFile[] {
  const patchByPath = new Map<string, string>();
  for (const f of patches?.files ?? []) {
    if (f.path && typeof f.patch === "string") patchByPath.set(f.path, f.patch);
  }
  return (stat.files ?? []).map((f) => ({
    ...f,
    patch: patchByPath.get(f.path) ?? f.patch,
  }));
}

export function slimFiles(files: BunPmDiffFile[]): TarballFile[] {
  const mapped: TarballFile[] = [];
  for (const f of files) {
    if (!f.path || isSkipFile(f)) continue;
    const rawPatch = typeof f.patch === "string" ? f.patch : null;
    const keep = shouldKeepPatch(f.path, rawPatch);
    mapped.push({
      path: f.path,
      status: f.status ?? "modified",
      linesAdded: f.linesAdded ?? 0,
      linesRemoved: f.linesRemoved ?? 0,
      formattingOnly: Boolean(f.formattingOnly),
      patch: keep && rawPatch ? rawPatch.slice(0, PATCH_MAX_CHARS) : null,
    });
  }
  if (mapped.length <= FILE_LIST_CAP) return mapped;
  const named = mapped.filter((f) => isKeepName(f.path));
  const namedSet = new Set(named);
  const secondary = mapped.filter(
    (f) => !namedSet.has(f) && (isDtsPath(f.path) || f.patch),
  );
  const priority = [...named, ...secondary];
  const prioritySet = new Set(priority);
  const rest = mapped
    .filter((f) => !prioritySet.has(f))
    .sort(
      (a, b) => b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved),
    );
  return [...priority, ...rest].slice(0, FILE_LIST_CAP);
}

function uniqueHints(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    if (seen.has(l)) continue;
    seen.add(l);
    out.push(l);
    if (out.length >= HINT_CAP) break;
  }
  return out;
}

function notesOf(stat: BunPmDiffJson): string[] {
  return Array.isArray(stat.notes)
    ? stat.notes.filter((n): n is string => typeof n === "string")
    : [];
}

function appendNotes(out: HintBuckets, notes: string[]): void {
  for (const note of notes) {
    const bucket = classifyNote(note);
    if (bucket) out[bucket].push(note);
  }
}

function appendDocHints(out: HintBuckets, added: string): void {
  const fromSections = classifyChangelogLines(added);
  for (const key of HINT_KEYS) out[key].push(...fromSections[key]);
  for (const [key, re] of DOC_HINTS) {
    out[key].push(...extractHintLines(added, re));
  }
}

function collectFromFiles(files: TarballFile[]): {
  hints: HintBuckets;
  releaseNotes: string | null;
  date: string | null;
} {
  const hints = emptyHints();
  let releaseNotes: string | null = null;
  let date: string | null = null;
  for (const f of files) {
    if (!f.patch) continue;
    const added = addedPatchLines(f.patch);
    if (isChangelogPath(f.path) || /^readme/i.test(fileName(f.path))) {
      if (!releaseNotes && isChangelogPath(f.path)) {
        releaseNotes = added.slice(0, RELEASE_NOTES_MAX_CHARS);
        date = extractDate(added);
      }
      appendDocHints(hints, added);
    }
    if (fileName(f.path) === "package.json") {
      hints.peerEngine.push(
        ...extractHintLines(added, /peer|engine|dependenc/i),
      );
      hints.security.push(...extractHintLines(added, /"(pre|post)?install"/i));
    }
  }
  return { hints, releaseNotes, date };
}

function tarballOf(
  stat: BunPmDiffJson,
  files: TarballFile[],
  notes: string[],
): TarballDiff {
  const totals = stat.totals ?? {};
  return {
    from: stat.from ?? "",
    to: stat.to ?? "",
    notes,
    totals: {
      files: totals.files ?? files.length,
      added: totals.added ?? 0,
      deleted: totals.deleted ?? 0,
      linesAdded: totals.linesAdded ?? 0,
      linesRemoved: totals.linesRemoved ?? 0,
      formattingOnly: totals.formattingOnly ?? 0,
    },
    files,
  };
}

export function failedDelta(
  target: string,
  changelogUrl: string,
  error: string,
): Delta {
  return {
    version: target,
    date: null,
    breaking: [],
    deprecations: [],
    features: [],
    security: [],
    peerEngine: [],
    releaseNotes: null,
    changelogUrl,
    tarball: null,
    source: "none",
    error,
  };
}

export function buildDelta(args: {
  target: string;
  changelogUrl: string;
  stat: BunPmDiffJson;
  patches: BunPmDiffJson | null;
}): Delta {
  const notes = notesOf(args.stat);
  const files = slimFiles(mergeDiffFiles(args.stat, args.patches));
  const hints = emptyHints();
  appendNotes(hints, notes);
  const fromFiles = collectFromFiles(files);
  for (const key of HINT_KEYS) hints[key].push(...fromFiles.hints[key]);
  return {
    version: args.target,
    date: fromFiles.date,
    breaking: uniqueHints(hints.breaking),
    deprecations: uniqueHints(hints.deprecations),
    features: uniqueHints(hints.features),
    security: uniqueHints(hints.security),
    peerEngine: uniqueHints(hints.peerEngine),
    releaseNotes: fromFiles.releaseNotes,
    changelogUrl: args.changelogUrl,
    tarball: tarballOf(args.stat, files, notes),
    source: "bun-pm-diff",
    error: null,
  };
}
