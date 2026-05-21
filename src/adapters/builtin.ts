import { extractCssData } from "../css-parser";
import { extractMarkers, extractSuppressions } from "../markers";
import { extractFileData } from "../parser";
import type { LanguageAdapter, ParsedFilePayload, ParseContext } from "./types";

const TS_JS_EXT = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

function parseTsJs(ctx: ParseContext): ParsedFilePayload {
  const data = extractFileData(ctx.absPath, ctx.source, ctx.relPath);
  return {
    category: "ts",
    symbols: data.symbols,
    imports: data.imports,
    exports: data.exports,
    components: data.components,
    markers: data.markers,
    suppressions: extractSuppressions(ctx.source, ctx.relPath),
    typeMembers: data.typeMembers,
    calls: data.calls,
    importSpecifiers: data.importSpecifiers,
    scopes: data.scopes,
    references: data.references,
    fileMetrics: data.fileMetrics,
    functionParams: data.functionParams,
    runtimeMarkers: data.runtimeMarkers,
    testSuites: data.testSuites,
    dynamicImports: data.dynamicImports,
    jsxElements: data.jsxElements,
    jsxAttributes: data.jsxAttributes,
    asyncCalls: data.asyncCalls,
    tryCatchRows: data.tryCatchRows,
    decorators: data.decorators,
    jsdocTags: data.jsdocTags,
    hasSideEffects: data.hasSideEffects,
  };
}

function parseCss(ctx: ParseContext): ParsedFilePayload {
  const cssData = extractCssData(ctx.absPath, ctx.source, ctx.relPath);
  return {
    category: "css",
    cssVariables: cssData.variables,
    cssClasses: cssData.classes,
    cssKeyframes: cssData.keyframes,
    markers: cssData.markers,
    suppressions: extractSuppressions(ctx.source, ctx.relPath),
    cssImportSources: cssData.importSources,
  };
}

function parseText(ctx: ParseContext): ParsedFilePayload {
  return {
    category: "text",
    markers: extractMarkers(ctx.source, ctx.relPath),
    suppressions: extractSuppressions(ctx.source, ctx.relPath),
  };
}

/**
 * Built-in adapters (oxc TS/JS, Lightning CSS, text/markers). Order matters for the first match.
 */
export const BUILTIN_ADAPTERS: readonly LanguageAdapter[] = [
  {
    id: "builtin.ts-js",
    extensions: [...TS_JS_EXT],
    parse: parseTsJs,
  },
  {
    id: "builtin.css",
    extensions: [".css"],
    parse: parseCss,
  },
  {
    id: "builtin.text",
    extensions: [
      ".md",
      ".mdx",
      ".mdc",
      ".yml",
      ".yaml",
      ".txt",
      ".json",
      ".sh",
    ],
    parse: parseText,
  },
];

// WeakMap-keyed so future plugin-registered adapter arrays (c9-plugin-layer.md)
// also memoise without leaking refs to GC'd arrays.
const adapterIndexCache = new WeakMap<
  readonly LanguageAdapter[],
  Map<string, LanguageAdapter>
>();

function buildAdapterIndex(
  adapters: readonly LanguageAdapter[],
): Map<string, LanguageAdapter> {
  const index = new Map<string, LanguageAdapter>();
  // First-match-wins: skip ext if an earlier adapter already claimed it.
  for (const a of adapters) {
    for (const ext of a.extensions) {
      const key = ext.toLowerCase();
      if (!index.has(key)) index.set(key, a);
    }
  }
  return index;
}

/**
 * First-match adapter lookup by file extension. `ext` must include the
 * leading dot (`.tsx`); returns `undefined` when nothing matches (the
 * indexer then falls back to markers-only text).
 */
export function getAdapterForExtension(
  ext: string,
  adapters: readonly LanguageAdapter[] = BUILTIN_ADAPTERS,
): LanguageAdapter | undefined {
  let index = adapterIndexCache.get(adapters);
  if (index === undefined) {
    index = buildAdapterIndex(adapters);
    adapterIndexCache.set(adapters, index);
  }
  return index.get(ext.toLowerCase());
}
