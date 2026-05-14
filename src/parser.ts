import { extname } from "node:path";

import { parseSync, Visitor } from "oxc-parser";
import type {
  StaticImport,
  StaticExportEntry,
  ExportExportNameKind,
  ImportNameKind,
  VisitorObject,
} from "oxc-parser";

import type {
  SymbolRow,
  ImportRow,
  ImportSpecifierRow,
  ExportRow,
  ComponentRow,
  MarkerRow,
  TypeMemberRow,
  CallRow,
} from "./db";
import { callsExtractor } from "./extractors/calls";
import {
  complexityExtractor,
  createComplexityTracker,
} from "./extractors/complexity";
import {
  componentsExtractor,
  createComponentDetector,
} from "./extractors/components";
import { extractVisibility } from "./extractors/jsdoc";
import { markersExtractor } from "./extractors/markers";
import { buildLineMap, offsetToLine } from "./extractors/offsets";
import { createScopeTracker, scopesExtractor } from "./extractors/scopes";
import { symbolsExtractor } from "./extractors/symbols";
import type { ExtractContext, TierExtractor } from "./extractors/types";

// Re-export for parser.test.ts compatibility — implementation in extractors/jsdoc.ts.
export { extractVisibility };

interface ExtractedData {
  symbols: SymbolRow[];
  imports: ImportRow[];
  importSpecifiers: ImportSpecifierRow[];
  exports: ExportRow[];
  components: ComponentRow[];
  markers: MarkerRow[];
  typeMembers: TypeMemberRow[];
  calls: CallRow[];
}

/**
 * Merge N extractors' visitor handlers into one VisitorObject.
 * Multiple extractors on the same node type chain in registration order.
 * Per [R.17](../docs/plans/substrate-extraction.md).
 */
export function buildMultiplexedVisitor(
  extractors: readonly TierExtractor[],
  ctx: ExtractContext,
): VisitorObject {
  const merged: Record<string, Array<(node: any) => void>> = {};
  for (const extractor of extractors) {
    const scratch: VisitorObject = {};
    extractor.register(scratch, ctx);
    for (const [key, fn] of Object.entries(scratch)) {
      if (typeof fn !== "function") continue;
      (merged[key] ??= []).push(fn as (node: any) => void);
    }
  }

  const out: VisitorObject = {};
  for (const [key, fns] of Object.entries(merged)) {
    if (fns.length === 1) {
      (out as Record<string, (node: any) => void>)[key] = fns[0]!;
      continue;
    }
    (out as Record<string, (node: any) => void>)[key] = (node: any) => {
      for (const fn of fns) fn(node);
    };
  }
  return out;
}

// Order = registration order = chained-handler order on shared nodes.
// `symbolsExtractor` first so its pushes + tracker setup precede everything else.
const EXTRACTORS: readonly TierExtractor[] = [
  symbolsExtractor,
  scopesExtractor,
  complexityExtractor,
  callsExtractor,
  componentsExtractor,
  markersExtractor,
];

export function extractFileData(
  filePath: string,
  source: string,
  relPath: string,
): ExtractedData {
  const ext = extname(filePath).toLowerCase();
  const lang: "ts" | "tsx" | "js" | "jsx" =
    ext === ".tsx"
      ? "tsx"
      : ext === ".jsx"
        ? "jsx"
        : ext === ".ts" || ext === ".mts" || ext === ".cts"
          ? "ts"
          : "js";

  const isTsx = ext === ".tsx" || ext === ".jsx";

  const result = parseSync(filePath, source, { lang, preserveParens: false });
  const lineMap = buildLineMap(source);
  const mod = result.module;

  const symbols: SymbolRow[] = [];
  const imports: ImportRow[] = [];
  const importSpecifiers: ImportSpecifierRow[] = [];
  const exports: ExportRow[] = [];
  const components: ComponentRow[] = [];
  const markers: MarkerRow[] = [];
  const typeMembers: TypeMemberRow[] = [];
  const calls: CallRow[] = [];

  const exportedNames = new Set<string>();
  const defaultExportedNames = new Set<string>();

  // Pre-passes: `exportedNames` / `defaultExportedNames` feed `is_exported`
  // on every downstream symbol push. Imports surface on `mod.staticImports`
  // so the visitor never walks them.
  for (const exp of mod.staticExports) {
    for (const entry of exp.entries) {
      const exportName = entry.exportName;
      if (exportName.kind === ("Default" as ExportExportNameKind)) {
        const localName = entry.localName;
        if (localName.name) defaultExportedNames.add(localName.name);
        defaultExportedNames.add("default");
      } else if (
        exportName.kind === ("Name" as ExportExportNameKind) &&
        exportName.name
      ) {
        exportedNames.add(exportName.name);
      }

      exports.push(exportEntryToRow(relPath, entry, lineMap));
    }
  }

  for (const imp of mod.staticImports) {
    imports.push(staticImportToRow(relPath, imp, lineMap));
    importSpecifiers.push(...staticImportSpecifierRows(relPath, imp, lineMap));
  }

  const ctx: ExtractContext = {
    filePath,
    relPath,
    source,
    lang,
    isTsx,
    lineMap,
    comments: result.comments,
    exportedNames,
    defaultExportedNames,
    symbols,
    imports,
    exports,
    components,
    markers,
    typeMembers,
    calls,
    scopes: createScopeTracker(),
    complexity: createComplexityTracker(symbols),
    componentDetector: createComponentDetector(),
  };

  const multiplexedVisitor = new Visitor(
    buildMultiplexedVisitor(EXTRACTORS, ctx),
  );
  multiplexedVisitor.visit(result.program);

  for (const extractor of EXTRACTORS) {
    extractor.finalize?.(ctx);
  }

  // `visibility` is a pure function of `doc_comment` — derived in one pass
  // rather than at every push site.
  for (const s of symbols) s.visibility = extractVisibility(s.doc_comment);

  return {
    symbols,
    imports,
    importSpecifiers,
    exports,
    components,
    markers,
    typeMembers,
    calls,
  };
}

function staticImportToRow(
  filePath: string,
  imp: StaticImport,
  lineMap: number[],
): ImportRow {
  const specifiers: string[] = [];
  let isTypeOnly = true;

  for (const entry of imp.entries) {
    if (!entry.isType) isTypeOnly = false;
    const importKind = entry.importName.kind;
    if (importKind === ("Default" as ImportNameKind)) {
      specifiers.push(entry.localName.value);
    } else if (importKind === ("NamespaceObject" as ImportNameKind)) {
      specifiers.push(`* as ${entry.localName.value}`);
    } else if (importKind === ("Name" as ImportNameKind)) {
      const original = entry.importName.name!;
      const local = entry.localName.value;
      specifiers.push(
        original === local ? original : `${original} as ${local}`,
      );
    }
  }

  if (imp.entries.length === 0) {
    isTypeOnly = false; // side-effect import `import "mod"`
  }

  return {
    file_path: filePath,
    source: imp.moduleRequest.value,
    resolved_path: null, // filled later by resolver
    specifiers: JSON.stringify(specifiers),
    is_type_only: isTypeOnly ? 1 : 0,
    line_number: offsetToLine(lineMap, imp.start),
  };
}

function staticImportSpecifierRows(
  filePath: string,
  imp: StaticImport,
  lineMap: number[],
): ImportSpecifierRow[] {
  // Side-effect imports (`import "mod"`) have zero entries — produce no rows.
  if (imp.entries.length === 0) return [];
  const rows: ImportSpecifierRow[] = [];
  for (const entry of imp.entries) {
    const importKind = entry.importName.kind;
    let kind: "named" | "default" | "namespace";
    let importedName: string;
    if (importKind === ("Default" as ImportNameKind)) {
      kind = "default";
      importedName = "default";
    } else if (importKind === ("NamespaceObject" as ImportNameKind)) {
      kind = "namespace";
      importedName = "*";
    } else {
      // `Name` kind — `import { foo as bar }` puts `foo` on importName.name,
      // `bar` on localName.value.
      kind = "named";
      importedName = entry.importName.name ?? entry.localName.value;
    }
    const localName = entry.localName.value;
    // Position records the local-binding token (`bar` in `foo as bar`) —
    // the rewrite-relevant token per R.6. The original `foo` token's
    // position is not exposed by oxc's StaticImportEntry; recipes that
    // need it walk imports.specifiers JSON or query the raw AST.
    const tokenStart = entry.localName.start;
    const tokenEnd = entry.localName.end;
    const line = offsetToLine(lineMap, tokenStart);
    const lineStartOffset = lineMap[line - 1] ?? 0;
    rows.push({
      file_path: filePath,
      source: imp.moduleRequest.value,
      line,
      column_start: tokenStart - lineStartOffset,
      column_end: tokenEnd - lineStartOffset,
      imported_name: importedName,
      local_name: localName,
      kind,
      is_type_only: entry.isType ? 1 : 0,
    });
  }
  return rows;
}

function exportEntryToRow(
  filePath: string,
  entry: StaticExportEntry,
  lineMap: number[],
): ExportRow {
  const exportName = entry.exportName;
  const isDefault = exportName.kind === ("Default" as ExportExportNameKind);
  const name = isDefault
    ? "default"
    : (exportName.name ?? entry.localName.name ?? "unknown");

  let kind = "value";
  if (entry.isType) kind = "type";
  if (entry.moduleRequest) kind = "re-export";

  // Position records the exported name token where available (per R.6);
  // falls back to the entry start for default exports of anonymous values
  // (`export default function() {}`) where `exportName.start` is null.
  const nameStart = exportName.start ?? entry.start;
  const nameEnd = exportName.end ?? entry.start + name.length;
  const lineStart = offsetToLine(lineMap, nameStart);
  const lineStartOffset = lineMap[lineStart - 1]!;
  return {
    file_path: filePath,
    name,
    kind,
    is_default: isDefault ? 1 : 0,
    re_export_source: entry.moduleRequest?.value ?? null,
    line_start: lineStart,
    line_end: offsetToLine(lineMap, entry.end),
    column_start: nameStart - lineStartOffset,
    column_end: nameEnd - lineStartOffset,
    is_re_export: entry.moduleRequest ? 1 : 0,
  };
}
