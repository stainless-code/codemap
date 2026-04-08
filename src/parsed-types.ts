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
 * One indexed file’s extracted data (workers return arrays of these).
 */
export interface ParsedFile {
  relPath: string;
  error?: boolean;
  parseError?: string;
  fileRow: FileRow;
  category: "ts" | "css" | "text";
  symbols?: SymbolRow[];
  imports?: ImportRow[];
  exports?: ExportRow[];
  components?: ComponentRow[];
  markers?: MarkerRow[];
  typeMembers?: TypeMemberRow[];
  calls?: CallRow[];
  cssVariables?: CssVariableRow[];
  cssClasses?: CssClassRow[];
  cssKeyframes?: CssKeyframeRow[];
  cssImportSources?: string[];
}
