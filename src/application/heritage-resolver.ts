/**
 * Type heritage resolver — maps unqualified base names to definition sites
 * using same-file symbols and the import graph (mirrors bindings-engine).
 */

import type { CodemapDatabase, TypeHeritageRow } from "../db";

interface ImportSpec {
  source: string;
  imported_name: string;
}

interface ReExportEntry {
  source: string;
  imported_name: string;
}

interface SymbolEntry {
  id: number;
  kind: string;
  scope_local_id: number;
}

const TYPE_SYMBOL_KINDS = new Set(["class", "interface", "type"]);

const MAX_REEXPORT_DEPTH = 10;

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

function parseReExportSource(raw: string, fallbackName: string): ReExportEntry {
  const dotIdx = raw.lastIndexOf(".");
  const sourceTail = raw.split("/").pop() ?? "";
  const hasNameSuffix =
    !sourceTail.startsWith(".") && dotIdx > raw.lastIndexOf("/") && dotIdx > 0;
  return {
    source: hasNameSuffix ? raw.slice(0, dotIdx) : raw,
    imported_name: hasNameSuffix ? raw.slice(dotIdx + 1) : fallbackName,
  };
}

function resolveReExport(
  fromFile: string,
  source: string,
  indexedPaths: Set<string>,
): string | null {
  if (!source.startsWith(".")) return null;
  const fromDir = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/"))
    : "";
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
    const entry = reExportsByFile.get(file)?.get(name);
    if (!entry) return { file, name };
    const nextFile = resolveReExport(file, entry.source, indexedPaths);
    if (!nextFile) return null;
    file = nextFile;
    name = entry.imported_name;
  }
  return null;
}

function pickTypeSymbol(candidates: SymbolEntry[]): SymbolEntry | null {
  if (!candidates.length) return null;
  const moduleLevel = candidates.filter((s) => s.scope_local_id === 0);
  const pool = moduleLevel.length ? moduleLevel : candidates;
  for (const s of pool) {
    if (TYPE_SYMBOL_KINDS.has(s.kind)) return s;
  }
  return pool[0] ?? null;
}

function findModuleSymbol(
  filePath: string,
  name: string,
  symbolsByFile: Map<string, Map<string, SymbolEntry[]>>,
): SymbolEntry | null {
  const list = symbolsByFile.get(filePath)?.get(name);
  if (!list?.length) return null;
  return pickTypeSymbol(list);
}

function resolveHeritageRow(
  row: TypeHeritageRow,
  symbolsByFile: Map<string, Map<string, SymbolEntry[]>>,
  importsByFile: Map<string, Map<string, ImportSpec>>,
  depsByFile: Map<string, Map<string, string>>,
  exportsByFile: Map<string, Set<string>>,
  reExportsByFile: Map<string, Map<string, ReExportEntry>>,
  indexedPaths: Set<string>,
): TypeHeritageRow {
  if (row.resolution_kind === "qualified-unresolved") {
    return row;
  }

  const sameFile = findModuleSymbol(
    row.child_file_path,
    row.base_simple_name,
    symbolsByFile,
  );
  if (sameFile) {
    return {
      ...row,
      base_file_path: row.child_file_path,
      base_symbol_id: sameFile.id,
      resolution_kind: "same-file",
    };
  }

  const imp = importsByFile.get(row.child_file_path)?.get(row.base_simple_name);
  if (imp) {
    const targetFile = depsByFile.get(row.child_file_path)?.get(imp.source);
    if (targetFile) {
      const exportName =
        imp.imported_name === "default" ? "default" : imp.imported_name;
      if (exportsByFile.get(targetFile)?.has(exportName)) {
        const resolved = followReExportChain(
          targetFile,
          exportName,
          reExportsByFile,
          indexedPaths,
        ) ?? { file: targetFile, name: exportName };
        const sym = findModuleSymbol(
          resolved.file,
          resolved.name,
          symbolsByFile,
        );
        if (sym) {
          return {
            ...row,
            base_file_path: resolved.file,
            base_symbol_id: sym.id,
            resolution_kind: "imported",
          };
        }
        return {
          ...row,
          base_file_path: resolved.file,
          base_symbol_id: null,
          resolution_kind: "imported",
        };
      }
    }
  }

  return {
    ...row,
    base_file_path: null,
    base_symbol_id: null,
    resolution_kind: "unresolved",
  };
}

export function expandHeritageResolveScope(
  db: CodemapDatabase,
  changedPaths: readonly string[],
): string[] {
  if (changedPaths.length === 0) return [];
  const scope = new Set(changedPaths);
  const placeholders = changedPaths.map(() => "?").join(",");
  for (const row of db
    .query<{ file_path: string }>(
      `SELECT DISTINCT file_path FROM imports WHERE resolved_path IN (${placeholders})`,
    )
    .all(...changedPaths)) {
    scope.add(row.file_path);
  }
  for (const row of db
    .query<{ child_file_path: string }>(
      `SELECT DISTINCT child_file_path FROM type_heritage WHERE base_file_path IN (${placeholders})`,
    )
    .all(...changedPaths)) {
    scope.add(row.child_file_path);
  }
  return [...scope];
}

export function resolveTypeHeritage(
  db: CodemapDatabase,
  filePaths?: readonly string[],
): TypeHeritageRow[] {
  const symbolsByFile = new Map<string, Map<string, SymbolEntry[]>>();
  for (const s of db
    .query<{
      id: number;
      file_path: string;
      name: string;
      kind: string;
      scope_local_id: number;
    }>(
      "SELECT id, file_path, name, kind, scope_local_id FROM symbols WHERE kind IN ('class','interface','type')",
    )
    .all()) {
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
    list.push({ id: s.id, kind: s.kind, scope_local_id: s.scope_local_id });
  }

  const importsByFile = new Map<string, Map<string, ImportSpec>>();
  for (const r of db
    .query<{
      file_path: string;
      source: string;
      imported_name: string;
      local_name: string;
    }>(
      "SELECT file_path, source, imported_name, local_name FROM import_specifiers",
    )
    .all()) {
    let m = importsByFile.get(r.file_path);
    if (!m) {
      m = new Map();
      importsByFile.set(r.file_path, m);
    }
    m.set(r.local_name, { source: r.source, imported_name: r.imported_name });
  }

  const depsByFile = new Map<string, Map<string, string>>();
  for (const r of db
    .query<{ file_path: string; source: string; resolved_path: string | null }>(
      "SELECT file_path, source, resolved_path FROM imports WHERE resolved_path IS NOT NULL",
    )
    .all()) {
    if (!r.resolved_path) continue;
    let m = depsByFile.get(r.file_path);
    if (!m) {
      m = new Map();
      depsByFile.set(r.file_path, m);
    }
    m.set(r.source, r.resolved_path);
  }

  const exportsByFile = new Map<string, Set<string>>();
  const reExportsByFile = new Map<string, Map<string, ReExportEntry>>();
  for (const r of db
    .query<{
      file_path: string;
      name: string;
      is_re_export: number;
      re_export_source: string | null;
    }>("SELECT file_path, name, is_re_export, re_export_source FROM exports")
    .all()) {
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
      re.set(r.name, parseReExportSource(r.re_export_source, r.name));
    }
  }

  const indexedPaths = new Set(
    db
      .query<{ path: string }>("SELECT path FROM files")
      .all()
      .map((r) => r.path),
  );

  const where =
    filePaths && filePaths.length > 0
      ? `WHERE child_file_path IN (${filePaths.map(() => "?").join(",")})
         OR (base_file_path IS NOT NULL AND base_file_path IN (${filePaths.map(() => "?").join(",")}))`
      : "";
  const rows = db
    .query<TypeHeritageRow>(
      `SELECT id, child_file_path, child_name, child_kind, child_line_start, relation,
              base_simple_name, base_qualified_name, base_file_path, base_symbol_id,
              resolution_kind, type_args
       FROM type_heritage ${where}`,
    )
    .all(...(filePaths ?? []), ...(filePaths ?? []));

  return rows.map((row) =>
    resolveHeritageRow(
      row,
      symbolsByFile,
      importsByFile,
      depsByFile,
      exportsByFile,
      reExportsByFile,
      indexedPaths,
    ),
  );
}

export function persistTypeHeritageResolution(
  db: CodemapDatabase,
  rows: TypeHeritageRow[],
) {
  const tx = db.transaction(() => {
    for (const row of rows) {
      if (row.id == null) continue;
      db.run(
        `UPDATE type_heritage
         SET base_file_path = ?, base_symbol_id = ?, resolution_kind = ?
         WHERE id = ?`,
        [row.base_file_path, row.base_symbol_id, row.resolution_kind, row.id],
      );
    }
  });
  tx();
}
