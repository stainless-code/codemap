/**
 * Binding resolver per [R.12]. Two-phase: one SELECT per table into
 * memory, then per-reference resolution in scope-walk → imports →
 * globals → unresolved order. Re-export chains defer to Tier 6.
 */

import type { BindingRow, CodemapDatabase } from "../db";
import { insertBindings } from "../db";

// TypeScript built-in type names — `Record`, `Partial`, etc. plus the
// stdlib types DOM exposes (`RegExp`, `Map`, `Set`, …). Used only for
// kind='type' refs.
const TYPE_GLOBALS = new Set([
  "Record",
  "Partial",
  "Required",
  "Readonly",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "NonNullable",
  "Parameters",
  "ReturnType",
  "InstanceType",
  "Awaited",
  "ThisType",
  "ThisParameterType",
  "OmitThisParameter",
  "ConstructorParameters",
  "Uppercase",
  "Lowercase",
  "Capitalize",
  "Uncapitalize",
  "ReadonlyArray",
  "ReadonlyMap",
  "ReadonlySet",
  "Array",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Promise",
  "Date",
  "RegExp",
  "RegExpExecArray",
  "RegExpMatchArray",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "Iterable",
  "IterableIterator",
  "Iterator",
  "AsyncIterable",
  "AsyncIterator",
  "Generator",
  "AsyncGenerator",
  "MessageEvent",
  "Event",
  "EventTarget",
  "Worker",
  "Window",
  "Document",
  "HTMLElement",
  "URL",
  "URLSearchParams",
  "Buffer",
  "Uint8Array",
  "Uint16Array",
  "Uint32Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Function",
  "Object",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "BigInt",
  "ErrorEvent",
  "MessagePort",
  "MessageChannel",
  "BroadcastChannel",
  "FormData",
  "FileReader",
  "Headers",
  "Request",
  "Response",
]);

// Conservative set — DOM + Node + ES2022 mainline only. Extending bumps
// the false-positive rate on `unresolved` recipes (typo detection).
const GLOBALS = new Set([
  "console",
  "window",
  "document",
  "globalThis",
  "global",
  "process",
  "Buffer",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "queueMicrotask",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "fetch",
  "Headers",
  "Request",
  "Response",
  "URL",
  "URLSearchParams",
  "FormData",
  "Blob",
  "File",
  "FileReader",
  "Image",
  "AbortController",
  "AbortSignal",
  "structuredClone",
  "atob",
  "btoa",
  "JSON",
  "Math",
  "Date",
  "Promise",
  "Object",
  "Array",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Symbol",
  "Reflect",
  "Proxy",
  "Number",
  "String",
  "Boolean",
  "BigInt",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "Infinity",
  "NaN",
  "undefined",
  "null",
  "true",
  "false",
  "this",
  "arguments",
  "super",
  "new",
  "void",
  "typeof",
  "instanceof",
  "in",
  "of",
  "Number",
  "isNaN",
  "isFinite",
  "parseInt",
  "parseFloat",
  "encodeURIComponent",
  "decodeURIComponent",
  "encodeURI",
  "decodeURI",
  "performance",
  "import",
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "self",
]);

interface SymbolEntry {
  id: number;
  scope_local_id: number;
}

interface ImportSpec {
  source: string;
  imported_name: string;
}

interface ReExportEntry {
  /** Raw source string from `export { x } from '...'`. */
  source: string;
  /** Original local name in the source module. `'default'` for star/default. */
  imported_name: string;
}

const SOURCE_EXTS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
];

/**
 * Resolve a relative-path re-export source (`./foo`, `../bar`) against the
 * indexed-paths set. Returns the first matching file path. Bare specifiers
 * (`react`, `lodash`) return null — those are external.
 */
function resolveReExport(
  fromFile: string,
  source: string,
  indexedPaths: Set<string>,
): string | null {
  if (!source.startsWith(".")) return null;
  const fromDir = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/"))
    : "";
  // Posix-join — strip './' / '../' segments without OS-specific helpers.
  const segs: string[] = fromDir ? fromDir.split("/") : [];
  for (const part of source.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      segs.pop();
      continue;
    }
    segs.push(part);
  }
  const base = segs.join("/");
  if (indexedPaths.has(base)) return base;
  for (const ext of SOURCE_EXTS) {
    if (indexedPaths.has(base + ext)) return base + ext;
  }
  for (const ext of SOURCE_EXTS) {
    const idx = `${base}/index${ext}`;
    if (indexedPaths.has(idx)) return idx;
  }
  return null;
}

export function resolveBindings(db: CodemapDatabase): BindingRow[] {
  const symbolsByFile = new Map<string, Map<string, SymbolEntry[]>>();
  const symbolRows = db
    .query<{
      id: number;
      file_path: string;
      name: string;
      scope_local_id: number;
    }>("SELECT id, file_path, name, scope_local_id FROM symbols")
    .all();
  for (const s of symbolRows) {
    let byName = symbolsByFile.get(s.file_path);
    if (!byName) {
      byName = new Map();
      symbolsByFile.set(s.file_path, byName);
    }
    let list = byName.get(s.name);
    if (!list) {
      list = [];
      byName.set(s.name, list);
    }
    list.push({ id: s.id, scope_local_id: s.scope_local_id });
  }

  const scopeParents = new Map<string, Map<number, number | null>>();
  const scopeRows = db
    .query<{
      file_path: string;
      local_id: number;
      parent_local_id: number | null;
    }>("SELECT file_path, local_id, parent_local_id FROM scopes")
    .all();
  for (const s of scopeRows) {
    let m = scopeParents.get(s.file_path);
    if (!m) {
      m = new Map();
      scopeParents.set(s.file_path, m);
    }
    m.set(s.local_id, s.parent_local_id);
  }

  const importsByFile = new Map<string, Map<string, ImportSpec>>();
  const impRows = db
    .query<{
      file_path: string;
      source: string;
      imported_name: string;
      local_name: string;
    }>(
      "SELECT file_path, source, imported_name, local_name FROM import_specifiers",
    )
    .all();
  for (const r of impRows) {
    let m = importsByFile.get(r.file_path);
    if (!m) {
      m = new Map();
      importsByFile.set(r.file_path, m);
    }
    m.set(r.local_name, { source: r.source, imported_name: r.imported_name });
  }

  // Read resolved_path from `imports`, not `dependencies` — the latter
  // is (from_path, to_path)-only, no module specifier.
  const depsByFile = new Map<string, Map<string, string>>();
  const depRows = db
    .query<{ file_path: string; source: string; resolved_path: string | null }>(
      "SELECT file_path, source, resolved_path FROM imports WHERE resolved_path IS NOT NULL",
    )
    .all();
  for (const r of depRows) {
    if (!r.resolved_path) continue;
    let m = depsByFile.get(r.file_path);
    if (!m) {
      m = new Map();
      depsByFile.set(r.file_path, m);
    }
    m.set(r.source, r.resolved_path);
  }

  const exportsByFile = new Map<string, Set<string>>();
  // Re-export chain: (file, exported_name) → {source, imported_name}.
  // Resolved in step 2 by walking the chain until we hit a non-re-export.
  const reExportsByFile = new Map<string, Map<string, ReExportEntry>>();
  const expRows = db
    .query<{
      file_path: string;
      name: string;
      is_re_export: number;
      re_export_source: string | null;
    }>("SELECT file_path, name, is_re_export, re_export_source FROM exports")
    .all();
  for (const r of expRows) {
    let s = exportsByFile.get(r.file_path);
    if (!s) {
      s = new Set();
      exportsByFile.set(r.file_path, s);
    }
    s.add(r.name);
    if (r.is_re_export === 1 && r.re_export_source) {
      let re = reExportsByFile.get(r.file_path);
      if (!re) {
        re = new Map();
        reExportsByFile.set(r.file_path, re);
      }
      // `re_export_source` shape: `./Foo` or `./Foo.default` for
      // `export { default as X } from './Foo'` per the parser.
      const dotIdx = r.re_export_source.lastIndexOf(".");
      const sourceTail = r.re_export_source.split("/").pop() ?? "";
      const hasNameSuffix =
        sourceTail.startsWith(".") === false &&
        dotIdx > r.re_export_source.lastIndexOf("/") &&
        dotIdx > 0;
      const importedName = hasNameSuffix
        ? r.re_export_source.slice(dotIdx + 1)
        : r.name;
      const source = hasNameSuffix
        ? r.re_export_source.slice(0, dotIdx)
        : r.re_export_source;
      re.set(r.name, { source, imported_name: importedName });
    }
  }

  // Indexed-paths set for re-export resolution.
  const indexedPaths = new Set<string>(
    db
      .query<{ path: string }>("SELECT path FROM files")
      .all()
      .map((r) => r.path),
  );

  // Skip kind='member' refs — property access RHS isn't a binding.
  // Consumers querying for member usage filter `kind='member'` directly.
  const refs = db
    .query<{
      id: number;
      file_path: string;
      name: string;
      scope_local_id: number;
      kind: string;
    }>(
      "SELECT id, file_path, name, scope_local_id, kind FROM \"references\" WHERE kind != 'member'",
    )
    .all();

  const out: BindingRow[] = [];
  for (const r of refs) {
    out.push(
      resolveOne(
        r,
        symbolsByFile,
        scopeParents,
        importsByFile,
        depsByFile,
        exportsByFile,
        reExportsByFile,
        indexedPaths,
      ),
    );
  }
  return out;
}

const MAX_REEXPORT_DEPTH = 10;

/**
 * Follow re-export chains starting at (file, name). Returns the final
 * non-re-export {file, name} pair, or null on cycle/unresolvable. Bounded
 * by `MAX_REEXPORT_DEPTH` to break pathological circulars.
 */
function followReExportChain(
  startFile: string,
  startName: string,
  reExportsByFile: Map<string, Map<string, ReExportEntry>>,
  indexedPaths: Set<string>,
): { file: string; name: string } | null {
  let file = startFile;
  let name = startName;
  const visited = new Set<string>();
  for (let i = 0; i < MAX_REEXPORT_DEPTH; i++) {
    const key = `${file}|${name}`;
    if (visited.has(key)) return null;
    visited.add(key);
    const fileReExports = reExportsByFile.get(file);
    const entry = fileReExports?.get(name);
    if (!entry) return { file, name };
    const nextFile = resolveReExport(file, entry.source, indexedPaths);
    if (!nextFile) return null;
    file = nextFile;
    name = entry.imported_name;
  }
  return null;
}

function resolveOne(
  ref: {
    id: number;
    file_path: string;
    name: string;
    scope_local_id: number;
    kind: string;
  },
  symbolsByFile: Map<string, Map<string, SymbolEntry[]>>,
  scopeParents: Map<string, Map<number, number | null>>,
  importsByFile: Map<string, Map<string, ImportSpec>>,
  depsByFile: Map<string, Map<string, string>>,
  exportsByFile: Map<string, Set<string>>,
  reExportsByFile: Map<string, Map<string, ReExportEntry>>,
  indexedPaths: Set<string>,
): BindingRow {
  // Same-file scope walk — innermost match wins (shadow-correct).
  const fileSymbols = symbolsByFile.get(ref.file_path);
  const candidates = fileSymbols?.get(ref.name);
  if (candidates?.length) {
    const parents = scopeParents.get(ref.file_path);
    let scope: number | null = ref.scope_local_id;
    while (scope !== null && scope !== undefined) {
      for (const c of candidates) {
        if (c.scope_local_id === scope) {
          return {
            reference_id: ref.id,
            resolved_symbol_id: c.id,
            resolution_kind: "same-file",
            is_external: 0,
          };
        }
      }
      if (scope === 0) break;
      scope = parents?.get(scope) ?? null;
    }
  }

  const fileImports = importsByFile.get(ref.file_path);
  const imp = fileImports?.get(ref.name);
  if (imp) {
    const targetFile = depsByFile.get(ref.file_path)?.get(imp.source);
    if (targetFile) {
      const targetExports = exportsByFile.get(targetFile);
      const exportName =
        imp.imported_name === "default" ? "default" : imp.imported_name;
      if (targetExports?.has(exportName)) {
        // Follow re-export chain to the actual definition site.
        const resolved = followReExportChain(
          targetFile,
          exportName,
          reExportsByFile,
          indexedPaths,
        ) ?? { file: targetFile, name: exportName };
        const targetSymbols = symbolsByFile.get(resolved.file);
        const symList = targetSymbols?.get(resolved.name);
        const targetSym = symList?.find((s) => s.scope_local_id === 0);
        return {
          reference_id: ref.id,
          resolved_symbol_id: targetSym?.id ?? null,
          resolution_kind: "imported",
          is_external: 0,
        };
      }
    }
    // Module resolved outside the indexed set (node_modules, etc.).
    return {
      reference_id: ref.id,
      resolved_symbol_id: null,
      resolution_kind: "imported",
      is_external: 1,
    };
  }

  if (GLOBALS.has(ref.name)) {
    return {
      reference_id: ref.id,
      resolved_symbol_id: null,
      resolution_kind: "global",
      is_external: 1,
    };
  }
  if (ref.kind === "type" && TYPE_GLOBALS.has(ref.name)) {
    return {
      reference_id: ref.id,
      resolved_symbol_id: null,
      resolution_kind: "global",
      is_external: 1,
    };
  }

  return {
    reference_id: ref.id,
    resolved_symbol_id: null,
    resolution_kind: "unresolved",
    is_external: 0,
  };
}

export function persistBindings(db: CodemapDatabase, rows: BindingRow[]) {
  // Clear orphans — references re-emitted on incremental indexes have
  // new AUTOINCREMENT ids. CASCADE handles it; explicit DELETE keeps the
  // table tight after schema migrations or out-of-order writes.
  db.run(
    'DELETE FROM bindings WHERE reference_id NOT IN (SELECT id FROM "references")',
  );
  insertBindings(db, rows);
}
