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
 * One indexed file's extracted data; workers return arrays of these and
 * `LanguageAdapter`s populate a {@link ParsedFilePayload} subset.
 */
export interface ParsedFile {
  /** Path relative to project root. */
  relPath: string;
  /** `true` when the file couldn't be read from disk (distinct from `parseError`). */
  error?: boolean;
  /** Parser threw but the file was read; the `files` row is still inserted. */
  parseError?: string;
  fileRow: FileRow;
  /** Extraction path: `ts` (oxc), `css` (lightningcss), or `text` (markers-only). */
  category: "ts" | "css" | "text";
  /** Worker-side parse wall-clock; surfaced by `--performance`. */
  parseMs?: number;
  symbols?: SymbolRow[];
  imports?: ImportRow[];
  exports?: ExportRow[];
  components?: ComponentRow[];
  markers?: MarkerRow[];
  typeMembers?: TypeMemberRow[];
  calls?: CallRow[];
  /** CSS-only fields (populated when `category === "css"`). */
  cssVariables?: CssVariableRow[];
  cssClasses?: CssClassRow[];
  cssKeyframes?: CssKeyframeRow[];
  /** Raw `@import` strings; main thread converts these to `imports` rows. */
  cssImportSources?: string[];
  /**
   * Verbatim file source — populated by the worker only when
   * `WorkerInput.fts5Enabled`; indexer writes to `source_fts`. Default-OFF
   * keeps worker→main serialization cost zero.
   */
  content?: string;
}
