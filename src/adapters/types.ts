import type { ParsedFile } from "../parsed-types";

/**
 * Input for a {@link LanguageAdapter}. Paths are absolute / project-relative as noted.
 */
export interface ParseContext {
  /**
   * Absolute path on disk (for parsers that need a real `filename`).
   */
  absPath: string;
  /**
   * Path relative to project root (stored in DB rows).
   */
  relPath: string;
  source: string;
}

/**
 * Partial parse result merged into {@link ParsedFile} after `fileRow` is built.
 * Set `parseError` when extraction fails but the file should still be indexed.
 */
export type ParsedFilePayload = Pick<
  ParsedFile,
  | "category"
  | "symbols"
  | "imports"
  | "exports"
  | "components"
  | "markers"
  | "typeMembers"
  | "calls"
  | "cssVariables"
  | "cssClasses"
  | "cssKeyframes"
  | "cssImportSources"
  | "parseError"
>;

/**
 * Pluggable extractor for a set of file extensions.
 *
 * @remarks
 * Built-in adapters live in {@link ./builtin.ts}. Future optional packages can register
 * additional adapters (or replace built-ins) once a public registration API exists.
 */
export interface LanguageAdapter {
  readonly id: string;
  /**
   * Extensions with leading dot, e.g. `.ts`, `.tsx`.
   */
  readonly extensions: readonly string[];
  parse(ctx: ParseContext): ParsedFilePayload;
}
