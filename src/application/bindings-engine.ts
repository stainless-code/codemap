/**
 * Binding resolver per [R.12]. Two-phase: one SELECT per table into
 * memory, then per-reference resolution in scope-walk → imports →
 * globals → unresolved order. Re-export chains defer to Tier 6.
 */

import type { BindingRow, CodemapDatabase, ReExportChainRow } from "../db";
import { insertBindings, insertReExportChains } from "../db";

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
  // DOM HTML element types — TS DOM lib.
  "Element",
  "Node",
  "HTMLDivElement",
  "HTMLSpanElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLOptionElement",
  "HTMLAnchorElement",
  "HTMLFormElement",
  "HTMLImageElement",
  "HTMLCanvasElement",
  "HTMLIFrameElement",
  "HTMLParagraphElement",
  "HTMLHeadingElement",
  "HTMLUListElement",
  "HTMLOListElement",
  "HTMLLIElement",
  "HTMLTableElement",
  "HTMLTableRowElement",
  "HTMLTableCellElement",
  "HTMLTableSectionElement",
  "HTMLLabelElement",
  "HTMLDialogElement",
  "HTMLVideoElement",
  "HTMLAudioElement",
  "HTMLMediaElement",
  "HTMLScriptElement",
  "HTMLLinkElement",
  "HTMLStyleElement",
  // SVG types.
  "SVGElement",
  "SVGSVGElement",
  "SVGGElement",
  "SVGPathElement",
  "SVGRectElement",
  "SVGCircleElement",
  "SVGEllipseElement",
  "SVGPolygonElement",
  "SVGPolylineElement",
  "SVGLineElement",
  "SVGTextElement",
  // DOM event types (TS DOM, distinct from React Synthetic events).
  "EventListener",
  "EventListenerOrEventListenerObject",
  "MouseEvent",
  "KeyboardEvent",
  "PointerEvent",
  "TouchEvent",
  "WheelEvent",
  "FocusEvent",
  "ClipboardEvent",
  "DragEvent",
  "InputEvent",
  "SubmitEvent",
  "CustomEvent",
  "AnimationEvent",
  "TransitionEvent",
  "UIEvent",
  "ProgressEvent",
  "PopStateEvent",
  "HashChangeEvent",
  "BeforeUnloadEvent",
  // Web APIs.
  "IntersectionObserver",
  "IntersectionObserverEntry",
  "IntersectionObserverInit",
  "ResizeObserver",
  "ResizeObserverEntry",
  "MutationObserver",
  "MutationRecord",
  "PerformanceObserver",
  "RequestInit",
  "RequestInfo",
  "ResponseInit",
  "Storage",
  "Location",
  "History",
  "Navigator",
  "Screen",
  "FileList",
  "DataTransfer",
  "DataTransferItem",
  "DataTransferItemList",
  "Selection",
  "Range",
  "DOMRect",
  "DOMRectReadOnly",
  "DOMTokenList",
  "NodeList",
  "HTMLCollection",
  "NamedNodeMap",
  "CSSStyleDeclaration",
  "CSSStyleSheet",
  // React ambient types (commonly used without explicit import via
  // `React.X` namespace or implicit `JSX.IntrinsicElements`).
  "ReactNode",
  "ReactElement",
  "ReactChild",
  "ReactChildren",
  "ReactFragment",
  "ReactPortal",
  "ComponentType",
  "ComponentProps",
  "ComponentPropsWithRef",
  "ComponentPropsWithoutRef",
  "PropsWithChildren",
  "PropsWithRef",
  "PropsWithoutRef",
  "FC",
  "FunctionComponent",
  "VFC",
  "VoidFunctionComponent",
  "Dispatch",
  "SetStateAction",
  "Ref",
  "RefObject",
  "MutableRefObject",
  "RefCallback",
  "ForwardedRef",
  "ForwardRefRenderFunction",
  "ForwardRefExoticComponent",
  "ExoticComponent",
  "Context",
  "Provider",
  "Consumer",
  "EffectCallback",
  "DependencyList",
  "Reducer",
  "ReducerAction",
  "ReducerState",
  "JSXElementConstructor",
  "HTMLAttributes",
  "AllHTMLAttributes",
  "DetailedHTMLProps",
  "DOMAttributes",
  "CSSProperties",
  "Key",
  "SyntheticEvent",
  "ChangeEvent",
  "FormEvent",
  "InvalidEvent",
  "ButtonHTMLAttributes",
  "InputHTMLAttributes",
  "TextareaHTMLAttributes",
  "SelectHTMLAttributes",
  "AnchorHTMLAttributes",
  "FormHTMLAttributes",
  "ImgHTMLAttributes",
  "LabelHTMLAttributes",
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
  "Bun",
  "Deno",
  "RegExp",
  "Iterator",
  "AsyncIterator",
  // React lifted into value-globals because it's commonly seen as
  // `React.useState(...)` / `React.createElement(...)` in transpiled
  // output and component code without an explicit import.
  "React",
  // Constructor-callable Web APIs (`new IntersectionObserver(…)`, etc.) not
  // already listed above.
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
  "PerformanceObserver",
  "Event",
  "CustomEvent",
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

/** In-memory indexes shared by reference binding and call-site resolution. */
export interface BindingIndexContext {
  symbolsByFile: Map<string, Map<string, SymbolEntry[]>>;
  scopeParents: Map<string, Map<number, number | null>>;
  importsByFile: Map<string, Map<string, ImportSpec>>;
  depsByFile: Map<string, Map<string, string>>;
  exportsByFile: Map<string, Set<string>>;
  reExportsByFile: Map<string, Map<string, ReExportEntry>>;
  indexedPaths: Set<string>;
}

/**
 * Split parser output `'./Foo.default'` into `{ source: './Foo', imported_name:
 * 'default' }` — the `.default` suffix encodes `export { default as X } from
 * './Foo'`. Without a suffix the export name binds to itself.
 */
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

export function loadBindingIndexContext(
  db: CodemapDatabase,
): BindingIndexContext {
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
      re.set(r.name, parseReExportSource(r.re_export_source, r.name));
    }
  }

  const indexedPaths = new Set<string>(
    db
      .query<{ path: string }>("SELECT path FROM files")
      .all()
      .map((r) => r.path),
  );

  return {
    symbolsByFile,
    scopeParents,
    importsByFile,
    depsByFile,
    exportsByFile,
    reExportsByFile,
    indexedPaths,
  };
}

/** Resolve a value reference at a scope — shared by bindings and call resolver. */
export function resolveNameAtSite(
  ctx: BindingIndexContext,
  site: {
    file_path: string;
    name: string;
    scope_local_id: number;
    kind?: string;
  },
): Pick<BindingRow, "resolved_symbol_id" | "resolution_kind" | "is_external"> {
  const binding = resolveOne(
    {
      id: 0,
      file_path: site.file_path,
      name: site.name,
      scope_local_id: site.scope_local_id,
      kind: site.kind ?? "value",
    },
    ctx.symbolsByFile,
    ctx.scopeParents,
    ctx.importsByFile,
    ctx.depsByFile,
    ctx.exportsByFile,
    ctx.reExportsByFile,
    ctx.indexedPaths,
  );
  return {
    resolved_symbol_id: binding.resolved_symbol_id,
    resolution_kind: binding.resolution_kind,
    is_external: binding.is_external,
  };
}

export function resolveBindings(db: CodemapDatabase): BindingRow[] {
  const ctx = loadBindingIndexContext(db);

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
        ctx.symbolsByFile,
        ctx.scopeParents,
        ctx.importsByFile,
        ctx.depsByFile,
        ctx.exportsByFile,
        ctx.reExportsByFile,
        ctx.indexedPaths,
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
        const viaReExport =
          resolved.file !== targetFile || resolved.name !== exportName;
        const targetSymbols = symbolsByFile.get(resolved.file);
        const symList = targetSymbols?.get(resolved.name);
        const targetSym = symList?.find((s) => s.scope_local_id === 0);
        return {
          reference_id: ref.id,
          resolved_symbol_id: targetSym?.id ?? null,
          resolution_kind: viaReExport ? "re-exported" : "imported",
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

/**
 * Materialise every (file, exported_name) re-export entry into a row
 * resolved at its terminal definition site. Re-walks the same engine
 * used by bindings-resolve, but separately so consumers querying barrel
 * files don't have to chase bindings.
 */
export function resolveReExportChains(db: CodemapDatabase): ReExportChainRow[] {
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
    if (r.is_re_export !== 1 || !r.re_export_source) continue;
    let re = reExportsByFile.get(r.file_path);
    if (!re) {
      re = new Map();
      reExportsByFile.set(r.file_path, re);
    }
    re.set(r.name, parseReExportSource(r.re_export_source, r.name));
  }

  const indexedPaths = new Set<string>(
    db
      .query<{ path: string }>("SELECT path FROM files")
      .all()
      .map((r) => r.path),
  );

  const out: ReExportChainRow[] = [];
  for (const [fromFile, names] of reExportsByFile) {
    for (const fromName of names.keys()) {
      let file = fromFile;
      let name = fromName;
      const visited = new Set<string>();
      let hops = 0;
      let truncated = 0;
      for (; hops < MAX_REEXPORT_DEPTH; hops++) {
        const key = `${file}|${name}`;
        if (visited.has(key)) {
          truncated = 1;
          break;
        }
        visited.add(key);
        const entry = reExportsByFile.get(file)?.get(name);
        if (!entry) break;
        const nextFile = resolveReExport(file, entry.source, indexedPaths);
        if (!nextFile) {
          truncated = 1;
          break;
        }
        file = nextFile;
        name = entry.imported_name;
      }
      if (hops >= MAX_REEXPORT_DEPTH) truncated = 1;
      out.push({
        from_file: fromFile,
        from_name: fromName,
        to_file: file,
        to_name: name,
        hops,
        truncated,
      });
    }
  }
  return out;
}

/** Truncates + rewrites `re_export_chains` from current exports/imports. */
export function persistReExportChains(db: CodemapDatabase) {
  db.run("DELETE FROM re_export_chains");
  insertReExportChains(db, resolveReExportChains(db));
}

/** Clears orphan binding rows + inserts the resolved set. Idempotent. */
export function persistBindings(db: CodemapDatabase, rows: BindingRow[]) {
  // Clear orphans — references re-emitted on incremental indexes have
  // new AUTOINCREMENT ids. CASCADE handles it; explicit DELETE keeps the
  // table tight after schema migrations or out-of-order writes.
  db.run(
    'DELETE FROM bindings WHERE reference_id NOT IN (SELECT id FROM "references")',
  );
  insertBindings(db, rows);
}
