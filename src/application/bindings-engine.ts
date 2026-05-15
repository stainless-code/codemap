/**
 * Binding resolver per [R.12]. Two-phase: one SELECT per table into
 * memory, then per-reference resolution in scope-walk → imports →
 * globals → unresolved order. Re-export chains defer to Tier 6.
 */

import type { BindingRow, CodemapDatabase } from "../db";
import { insertBindings } from "../db";

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
]);

interface SymbolEntry {
  id: number;
  scope_local_id: number;
}

interface ImportSpec {
  source: string;
  imported_name: string;
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
  const expRows = db
    .query<{ file_path: string; name: string }>(
      "SELECT file_path, name FROM exports",
    )
    .all();
  for (const r of expRows) {
    let s = exportsByFile.get(r.file_path);
    if (!s) {
      s = new Set();
      exportsByFile.set(r.file_path, s);
    }
    s.add(r.name);
  }

  const refs = db
    .query<{
      id: number;
      file_path: string;
      name: string;
      scope_local_id: number;
    }>('SELECT id, file_path, name, scope_local_id FROM "references"')
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
      ),
    );
  }
  return out;
}

function resolveOne(
  ref: { id: number; file_path: string; name: string; scope_local_id: number },
  symbolsByFile: Map<string, Map<string, SymbolEntry[]>>,
  scopeParents: Map<string, Map<number, number | null>>,
  importsByFile: Map<string, Map<string, ImportSpec>>,
  depsByFile: Map<string, Map<string, string>>,
  exportsByFile: Map<string, Set<string>>,
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
        const targetSymbols = symbolsByFile.get(targetFile);
        const symList = targetSymbols?.get(exportName);
        // Pick the module-scope hit; nested same-name symbols can't be the
        // export target.
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
