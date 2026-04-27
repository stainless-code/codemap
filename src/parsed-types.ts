import type {
  FileRow,
  SymbolRow,
  ImportRow,
  ExportRow,
  ComponentRow,
  MarkerRow,
  CssVariableRow,
  CssClassRow,
  CssKeyframeRow,
  TypeMemberRow,
  CallRow,
} from "./db";

/**
 * One indexed file's extracted data — workers return arrays of these and
 * `LanguageAdapter`s populate a {@link ParsedFilePayload} subset of these
 * fields. Row shapes (`SymbolRow`, `ImportRow`, …) mirror the SQLite schema
 * documented in `docs/architecture.md § Schema`.
 */
export interface ParsedFile {
  /** Path relative to project root; primary key for the `files` table. */
  relPath: string;
  /**
   * Set to `true` when the file could not even be read from disk
   * (`fileRow` is then a placeholder and other fields are undefined).
   * Distinct from {@link ParsedFile.parseError} — see that field.
   */
  error?: boolean;
  /**
   * Error message from the parser when extraction threw but the file *was*
   * read successfully. The `files` row is still inserted so incremental
   * runs do not retry parsing on every pass.
   */
  parseError?: string;
  /** Row to insert into the `files` table (path, hash, size, language, …). */
  fileRow: FileRow;
  /**
   * Selects which extraction path the result came from:
   * - `ts`   — TS/TSX/JS/JSX (oxc-parser): symbols/imports/exports/etc.
   * - `css`  — CSS (lightningcss): variables/classes/keyframes/imports.
   * - `text` — Markers-only (Markdown, JSON, YAML, fallback for unknown ext).
   */
  category: "ts" | "css" | "text";
  /** Worker-side wall-clock parse time; surfaced by `--performance`. */
  parseMs?: number;
  /** Top-level + nested symbols (functions, classes, interfaces, …). */
  symbols?: SymbolRow[];
  /** `import` statements (alias-resolved separately into `dependencies`). */
  imports?: ImportRow[];
  /** Named, default, and re-exports. */
  exports?: ExportRow[];
  /** React components detected via PascalCase + JSX/hooks heuristic. */
  components?: ComponentRow[];
  /** `TODO` / `FIXME` / `HACK` / `NOTE` comments (extracted from any category). */
  markers?: MarkerRow[];
  /** Properties and method signatures of interfaces / object-literal types. */
  typeMembers?: TypeMemberRow[];
  /** Function-scoped call edges (deduped per `caller_scope` + `callee_name`). */
  calls?: CallRow[];
  /** CSS custom properties (`--var`) — only emitted when `category === "css"`. */
  cssVariables?: CssVariableRow[];
  /** CSS class definitions, with `is_module` flag for `.module.css` files. */
  cssClasses?: CssClassRow[];
  /** `@keyframes` animation definitions. */
  cssKeyframes?: CssKeyframeRow[];
  /**
   * Raw `@import` source strings from CSS — main thread converts them into
   * `imports` rows (with `resolved_path = null`) before insertion.
   */
  cssImportSources?: string[];
}
