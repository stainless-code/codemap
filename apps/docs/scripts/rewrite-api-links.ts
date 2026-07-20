import {
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const DEFAULT_DIR = "apps/docs/content/reference/api";
const API_BASE = "/reference/api";
/** Hand-authored pages — never deleted by `--clean` or link-rewrite passes. */
const HAND_AUTHORED = new Set(["index.mdx"]);
/** TypeDoc scaffold names — discarded after generate; keep out of `index.mdx`. */
const TYPEDOC_SCAFFOLD = new Set([
  "_typedoc-entry.mdx",
  "_typedoc-modules.mdx",
]);

const MARKDOWN_LINK = /\[([^\]]*)\]\(((?!https?:\/\/)[^)]+)\)/g;
const MARKDOWN_HEADING = /^(#{1,6})\s+(.+)$/;
const DISAMBIGUATED_ANCHOR = /^(.+)-(\d+)$/;

interface Options {
  dir: string;
  clean: boolean;
}

function parseArgs(argv: string[]): Options {
  let dir = DEFAULT_DIR;
  let clean = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--clean") {
      clean = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage: bun apps/docs/scripts/rewrite-api-links.ts [dir] [--clean]\n\n` +
          `  dir      Generated API markdown directory (default: ${DEFAULT_DIR})\n` +
          `  --clean  Delete generated .mdx/.md files (keeps meta.ts + hand-authored index.mdx), then exit`,
      );
      process.exit(0);
    }
    if (!arg.startsWith("-")) {
      dir = arg;
    }
  }

  return { dir, clean };
}

async function collectMarkdownFiles(
  rootDir: string,
  currentDir = rootDir,
): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(rootDir, fullPath)));
      continue;
    }
    if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

/** Blume heading ids: lowercase, spaces→`-`, strip non `[a-z0-9-]`. */
function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function collectHeadingSlugs(content: string): Set<string> {
  const slugs = new Set<string>();
  const counts = new Map<string, number>();

  for (const line of content.split("\n")) {
    const match = MARKDOWN_HEADING.exec(line);
    if (!match) {
      continue;
    }

    const headingText = match[2].trim().replace(/\s*\{#[^}]+\}$/, "");
    const base = slugifyHeading(headingText);
    if (!base) {
      continue;
    }

    const seen = counts.get(base) ?? 0;
    slugs.add(seen === 0 ? base : `${base}-${seen}`);
    counts.set(base, seen + 1);
  }

  return slugs;
}

/** TypeDoc `<a id="…">` member anchors (not markdown headings). */
const HTML_ID = /<a\s+id="([^"]+)"/g;

function collectHtmlIds(content: string): Set<string> {
  const ids = new Set<string>();
  for (const match of content.matchAll(HTML_ID)) {
    ids.add(match[1]!);
  }
  return ids;
}

async function buildAnchorMaps(files: string[]): Promise<{
  slugMap: Map<string, Set<string>>;
  htmlIdMap: Map<string, Set<string>>;
}> {
  const slugMap = new Map<string, Set<string>>();
  const htmlIdMap = new Map<string, Set<string>>();

  for (const file of files) {
    const content = await readFile(file, "utf8");
    slugMap.set(file, collectHeadingSlugs(content));
    htmlIdMap.set(file, collectHtmlIds(content));
  }

  return { slugMap, htmlIdMap };
}

function isExternal(target: string): boolean {
  return (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:")
  );
}

function resolveTargetFile(
  sourceFile: string,
  rootDir: string,
  pathname: string,
): string | null {
  if (!pathname) {
    return sourceFile;
  }

  if (pathname.startsWith(API_BASE)) {
    const relative = pathname.slice(API_BASE.length).replace(/^\//, "");
    const filePath = relative
      ? path.join(rootDir, ...relative.split("/"))
      : path.join(rootDir, "index");
    return /\.mdx?$/i.test(filePath) ? filePath : `${filePath}.mdx`;
  }

  const resolved = path.resolve(path.dirname(sourceFile), pathname);
  const relativeToRoot = path.relative(rootDir, resolved);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  if (/\.mdx?$/i.test(resolved)) {
    return resolved;
  }

  return `${resolved}.mdx`;
}

/** Resolve an internal link to a `/reference/api` slug (index → `""`). */
function slugFromPathname(
  sourceFile: string,
  rootDir: string,
  pathname: string,
): string | null {
  if (!pathname) {
    return "";
  }

  const dashed = cleanPathname(pathname);

  if (dashed.endsWith(".md") || dashed.endsWith(".mdx")) {
    const targetFile = resolveTargetFile(sourceFile, rootDir, dashed);
    return targetFile ? fileToSlug(targetFile, rootDir) : null;
  }

  if (dashed.startsWith(API_BASE)) {
    return collapseIndexSlug(dashed.slice(API_BASE.length).replace(/^\//, ""));
  }

  // Bare relative slug → resolve to a file.
  if (!dashed.startsWith("/")) {
    const targetFile = resolveTargetFile(sourceFile, rootDir, dashed);
    return targetFile ? fileToSlug(targetFile, rootDir) : null;
  }

  return null;
}

function normalizeAnchor(
  anchor: string,
  targetFile: string | null,
  slugMap: Map<string, Set<string>>,
  htmlIdMap: Map<string, Set<string>>,
): string {
  if (!anchor || !targetFile) {
    return anchor;
  }

  const slugs = slugMap.get(targetFile);
  if (!slugs) {
    return anchor;
  }

  if (slugs.has(anchor)) {
    return anchor;
  }

  const match = DISAMBIGUATED_ANCHOR.exec(anchor);
  if (match && slugs.has(match[1]!)) {
    return match[1]!;
  }

  // TypeDoc `<a id>` member anchors aren't headings — docs:validate ignores
  // them. Drop only those; leave other unresolved fragments for validate.
  const htmlIds = htmlIdMap.get(targetFile);
  if (htmlIds?.has(anchor)) {
    return "";
  }

  return anchor;
}

/** Slug relative to the API root (`index.md` → empty). */
function collapseIndexSlug(slug: string): string {
  if (slug === "index") return "";
  if (slug.endsWith("/index")) return slug.slice(0, -"/index".length);
  return slug;
}

/** Dot → `-` so Blume base-prefixes the route (dotted final segments skip prefix). */
function dashify(segment: string): string {
  return segment.replace(/\./g, "-");
}

/** Drop redundant TypeDoc `src` path segments (`foo/src/bar` → `foo/bar`). */
function dropSrc(segments: string[]): string[] {
  return segments.filter((segment) => segment !== "src");
}

/** Drop `src` from a dot-joined slug segment, then dashify (`core.src` → `core`). */
function cleanSegment(segment: string): string {
  return dashify(dropSrc(segment.split(".")).join("."));
}

/** Strip ext, drop `src` segments, dashify — for incoming link pathnames. */
function cleanPathname(pathname: string): string {
  const stripped = pathname.replace(/\.mdx?$/i, "");
  return stripped
    .split("/")
    .map((segment) => cleanSegment(segment))
    .join("/");
}

/** Drop `src` from a slash-joined display title, keeping `/` for labels. */
function cleanTitle(title: string): string {
  return dropSrc(title.split("/")).join("/");
}

function fileToSlug(file: string, rootDir: string): string {
  const relative = path.relative(rootDir, file).split(path.sep).join("/");
  const withoutExt = relative.replace(/\.mdx?$/i, "");
  return cleanSegment(collapseIndexSlug(withoutExt));
}

/** Rename dotted TypeDoc slugs to dash-slugs (idempotent). */
async function renameToDashSlugs(
  files: string[],
  rootDir: string,
): Promise<string[]> {
  const renamed: string[] = [];
  for (const file of files) {
    const relative = path.relative(rootDir, file).split(path.sep).join("/");
    const dir = path.dirname(relative);
    const base = path.basename(relative).replace(/\.mdx?$/i, "");
    const dashedBase = cleanSegment(base);
    if (dashedBase === base) {
      renamed.push(file);
      continue;
    }
    const newPath = path.join(rootDir, dir, `${dashedBase}.mdx`);
    await rename(file, newPath);
    renamed.push(newPath);
  }
  return renamed;
}

function sitePathFromSlug(slug: string): string {
  return slug ? `${API_BASE}/${slug}` : API_BASE;
}

function rewriteLink(
  sourceFile: string,
  rootDir: string,
  text: string,
  target: string,
  slugMap: Map<string, Set<string>>,
  htmlIdMap: Map<string, Set<string>>,
): { next: string; linkChanged: boolean; anchorChanged: boolean } {
  if (isExternal(target)) {
    return {
      next: `[${text}](${target})`,
      linkChanged: false,
      anchorChanged: false,
    };
  }

  const displayText = cleanTitle(text);

  const hashIndex = target.indexOf("#");
  const pathname = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const anchor = hashIndex === -1 ? "" : target.slice(hashIndex + 1);

  // Pure in-page anchor (`#foo`) — keep anchor-only, normalize the anchor.
  if (!pathname && anchor) {
    const targetFile = sourceFile;
    const normalizedAnchor = normalizeAnchor(
      anchor,
      targetFile,
      slugMap,
      htmlIdMap,
    );
    if (!normalizedAnchor) {
      return {
        next: displayText,
        linkChanged: true,
        anchorChanged: true,
      };
    }
    return {
      next: `[${displayText}](#${normalizedAnchor})`,
      linkChanged: normalizedAnchor !== anchor,
      anchorChanged: normalizedAnchor !== anchor,
    };
  }

  const slug = slugFromPathname(sourceFile, rootDir, pathname);
  if (slug !== null) {
    const dashed = cleanPathname(pathname);
    const targetFile =
      dashed.endsWith(".md") || dashed.endsWith(".mdx")
        ? resolveTargetFile(sourceFile, rootDir, dashed)
        : resolveTargetFile(sourceFile, rootDir, `${dashed}.mdx`);
    const normalizedAnchor = normalizeAnchor(
      anchor,
      targetFile,
      slugMap,
      htmlIdMap,
    );
    const sourceSlug = fileToSlug(sourceFile, rootDir);
    // Same-page → `#anchor` only (self-links aren't base-prefixed → 404 under `/codemap`).
    let nextTarget: string;
    if (slug === sourceSlug) {
      nextTarget = normalizedAnchor ? `#${normalizedAnchor}` : "#";
    } else {
      const linkPath = sitePathFromSlug(slug);
      nextTarget = normalizedAnchor
        ? `${linkPath}#${normalizedAnchor}`
        : linkPath;
    }
    return {
      next: `[${displayText}](${nextTarget})`,
      linkChanged: true,
      anchorChanged: normalizedAnchor !== anchor,
    };
  }

  // Already-relative links we can't resolve to a slug — anchor normalize only.
  if (pathname && !pathname.startsWith("/")) {
    const targetFile = resolveTargetFile(sourceFile, rootDir, pathname);
    const normalizedAnchor = normalizeAnchor(
      anchor,
      targetFile,
      slugMap,
      htmlIdMap,
    );
    const nextTarget = normalizedAnchor
      ? `${pathname}#${normalizedAnchor}`
      : pathname;
    return {
      next: `[${displayText}](${nextTarget})`,
      linkChanged: normalizedAnchor !== anchor,
      anchorChanged: normalizedAnchor !== anchor,
    };
  }

  return {
    next: `[${text}](${target})`,
    linkChanged: false,
    anchorChanged: false,
  };
}

const FRONTMATTER_OPEN = /^---\r?\n/;
const H1_LINE = /^#\s+(.+?)\s*$/;

/** Quote a string as a YAML double-quoted scalar. */
function yamlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Move first body H1 into frontmatter `title` and drop the body H1. */
function extractTitle(content: string): {
  content: string;
  title: string | null;
} {
  const lines = content.split("\n");
  let h1Idx = -1;
  let title: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = H1_LINE.exec(lines[i]!);
    if (m) {
      title = cleanTitle(m[1]!);
      h1Idx = i;
      break;
    }
  }

  if (h1Idx === -1) {
    return { content, title: null };
  }

  lines.splice(h1Idx, 1);
  let body = lines.join("\n");

  if (title && FRONTMATTER_OPEN.test(content)) {
    body = body.replace(FRONTMATTER_OPEN, `---\ntitle: ${yamlString(title)}\n`);
  }

  return { content: body, title };
}

function rewriteContent(
  sourceFile: string,
  rootDir: string,
  content: string,
  slugMap: Map<string, Set<string>>,
  htmlIdMap: Map<string, Set<string>>,
): { content: string; linkCount: number; anchorCount: number } {
  let linkCount = 0;
  let anchorCount = 0;

  const rewritten = content.replace(
    MARKDOWN_LINK,
    (match, text: string, target: string) => {
      const result = rewriteLink(
        sourceFile,
        rootDir,
        text,
        target,
        slugMap,
        htmlIdMap,
      );

      if (result.linkChanged) {
        linkCount++;
      }
      if (result.anchorChanged) {
        anchorCount++;
      }

      return result.linkChanged || result.anchorChanged ? result.next : match;
    },
  );

  return { content: rewritten, linkCount, anchorCount };
}

async function cleanGeneratedMarkdown(
  rootDir: string,
  currentDir = rootDir,
): Promise<number> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  let removed = 0;

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      removed += await cleanGeneratedMarkdown(rootDir, fullPath);
      continue;
    }
    if (
      entry.isFile() &&
      /\.mdx?$/.test(entry.name) &&
      !HAND_AUTHORED.has(entry.name)
    ) {
      await unlink(fullPath);
      removed++;
    }
  }

  // Prune now-empty directories (TypeDoc's non-flattened scaffolding) so the
  // working tree stays clean. Never remove the root itself.
  if (currentDir !== rootDir) {
    const remaining = await readdir(currentDir);
    if (remaining.length === 0) {
      await rmdir(currentDir);
    }
  }

  return removed;
}

async function main(): Promise<void> {
  const { dir, clean } = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(dir);

  if (clean) {
    const removed = await cleanGeneratedMarkdown(rootDir);
    console.log(
      `rewrite-api-links: removed ${removed} generated .mdx/.md file(s) under ${rootDir}`,
    );
    return;
  }

  const collected = await collectMarkdownFiles(rootDir);
  const renamed = await renameToDashSlugs(collected, rootDir);
  // Drop TypeDoc scaffolding — `/reference/api` is the hand-authored Overview
  // (`index.mdx`); the generated package/modules table is redundant.
  const files = renamed.filter(
    (f) =>
      !TYPEDOC_SCAFFOLD.has(path.basename(f)) &&
      !HAND_AUTHORED.has(path.basename(f)),
  );
  for (const name of TYPEDOC_SCAFFOLD) {
    await unlink(path.join(rootDir, name)).catch(() => {});
  }
  const { slugMap, htmlIdMap } = await buildAnchorMaps(files);

  let totalLinks = 0;
  let totalAnchors = 0;

  for (const file of files) {
    const original = await readFile(file, "utf8");
    const {
      content: linked,
      linkCount,
      anchorCount,
    } = rewriteContent(file, rootDir, original, slugMap, htmlIdMap);
    const titled = extractTitle(linked);
    const content = titled.content;

    if (content !== original) {
      await writeFile(file, content, "utf8");
    }

    totalLinks += linkCount;
    totalAnchors += anchorCount;
  }

  console.log(
    `rewrite-api-links: ${totalLinks} link(s), ${totalAnchors} anchor(s) normalized (absolute) in ${files.length} file(s) under ${rootDir}`,
  );
}

await main();
