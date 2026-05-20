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
  ScopeRow,
  ReferenceRow,
  FileMetricsRow,
  FunctionParamRow,
  RuntimeMarkerRow,
  TestSuiteRow,
  DynamicImportRow,
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
import { dynamicImportsExtractor } from "./extractors/dynamic-imports";
import { extractVisibility } from "./extractors/jsdoc";
import { markersExtractor } from "./extractors/markers";
import { moduleSideEffectsExtractor } from "./extractors/module-side-effects";
import { buildLineMap, offsetToLine } from "./extractors/offsets";
import { referencesExtractor } from "./extractors/references";
import { runtimeMarkersExtractor } from "./extractors/runtime-markers";
import { createScopeTracker, scopesExtractor } from "./extractors/scopes";
import { symbolsExtractor } from "./extractors/symbols";
import { testsExtractor } from "./extractors/tests";
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
  scopes: ScopeRow[];
  references: ReferenceRow[];
  fileMetrics: FileMetricsRow;
  functionParams: FunctionParamRow[];
  runtimeMarkers: RuntimeMarkerRow[];
  testSuites: TestSuiteRow[];
  dynamicImports: DynamicImportRow[];
  hasSideEffects: number;
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
  referencesExtractor,
  dynamicImportsExtractor,
  moduleSideEffectsExtractor,
  runtimeMarkersExtractor,
  testsExtractor,
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
  const references: ReferenceRow[] = [];
  const functionParams: FunctionParamRow[] = [];
  const runtimeMarkers: RuntimeMarkerRow[] = [];
  const testSuites: TestSuiteRow[] = [];
  const dynamicImports: DynamicImportRow[] = [];

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
    const importIndex = imports.length;
    imports.push(staticImportToRow(relPath, imp, lineMap));
    importSpecifiers.push(
      ...staticImportSpecifierRows(relPath, imp, lineMap, importIndex),
    );
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
    references,
    functionParams,
    runtimeMarkers,
    testSuites,
    dynamicImports,
    scopes: createScopeTracker(relPath),
    complexity: createComplexityTracker(symbols),
    componentDetector: createComponentDetector(),
    claimedScopeNodes: new WeakSet(),
    moduleHasSideEffects: false,
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
    scopes: [...ctx.scopes.getRecorded()],
    references,
    fileMetrics: computeFileMetrics(relPath, source, lineMap, symbols, exports),
    functionParams,
    runtimeMarkers,
    testSuites,
    dynamicImports,
    hasSideEffects: ctx.moduleHasSideEffects ? 1 : 0,
  };
}

/**
 * Per-file metric aggregation. Pure post-processing — no extra walks.
 * Line classification is regex-light: blank if /^\s*$/, comment if /^\s*(?:\/\/|\/\*|\*|\*\/)/.
 * Imperfect on multi-line strings but cheap and good enough for top-level
 * size signals.
 */
function computeFileMetrics(
  filePath: string,
  source: string,
  lineMap: number[],
  symbols: SymbolRow[],
  exports: ExportRow[],
): FileMetricsRow {
  const totalLines = lineMap.length;
  let blank = 0;
  let comment = 0;
  for (let i = 0; i < lineMap.length; i++) {
    const start = lineMap[i]!;
    const end = i + 1 < lineMap.length ? lineMap[i + 1]! : source.length;
    const line = source.slice(start, end).trim();
    if (line.length === 0) {
      blank++;
    } else if (
      line.startsWith("//") ||
      line.startsWith("/*") ||
      line.startsWith("*") ||
      line.startsWith("*/")
    ) {
      comment++;
    }
  }
  const code = totalLines - blank - comment;
  let fn = 0;
  let cls = 0;
  let iface = 0;
  let constCount = 0;
  let letCount = 0;
  let varCount = 0;
  for (const s of symbols) {
    if (s.kind === "function") fn++;
    else if (s.kind === "class") cls++;
    else if (s.kind === "interface") iface++;
    else if (s.kind === "const") constCount++;
    else if (s.kind === "let") letCount++;
    else if (s.kind === "var") varCount++;
  }
  return {
    file_path: filePath,
    total_lines: totalLines,
    code_lines: code,
    blank_lines: blank,
    comment_lines: comment,
    let_count: letCount,
    const_count: constCount,
    var_count: varCount,
    function_count: fn,
    arrow_count: 0,
    class_count: cls,
    interface_count: iface,
    export_count: exports.length,
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
  importIndex: number,
): ImportSpecifierRow[] {
  if (imp.entries.length === 0) {
    const line = offsetToLine(lineMap, imp.start);
    const lineStartOffset = lineMap[line - 1] ?? 0;
    const tokenStart = imp.moduleRequest.start;
    const tokenEnd = imp.moduleRequest.end;
    return [
      {
        file_path: filePath,
        source: imp.moduleRequest.value,
        line,
        column_start: tokenStart - lineStartOffset,
        column_end: tokenEnd - lineStartOffset,
        imported_name: "",
        local_name: "",
        kind: "side-effect",
        is_type_only: 0,
        import_index: importIndex,
      },
    ];
  }
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
      import_index: importIndex,
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
