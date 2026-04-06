import { extractCssData } from "../css-parser";
import { extractMarkers } from "../markers";
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
    cssImportSources: cssData.importSources,
  };
}

function parseText(ctx: ParseContext): ParsedFilePayload {
  return {
    category: "text",
    markers: extractMarkers(ctx.source, ctx.relPath),
  };
}

/** Built-in adapters (oxc TS/JS, Lightning CSS, text/markers). Order matters for the first match. */
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

export function getAdapterForExtension(
  ext: string,
  adapters: readonly LanguageAdapter[] = BUILTIN_ADAPTERS,
): LanguageAdapter | undefined {
  for (const a of adapters) {
    if (a.extensions.includes(ext)) return a;
  }
  return undefined;
}
