import { transform } from "lightningcss";

import type {
  CssVariableRow,
  CssClassRow,
  CssKeyframeRow,
  MarkerRow,
} from "./db";
import { extractMarkers } from "./markers";

interface CssExtractedData {
  variables: CssVariableRow[];
  classes: CssClassRow[];
  keyframes: CssKeyframeRow[];
  markers: MarkerRow[];
  importSources: string[];
}

export function extractCssData(
  filePath: string,
  source: string,
  relPath: string,
): CssExtractedData {
  const variables: CssVariableRow[] = [];
  const classes: CssClassRow[] = [];
  const keyframes: CssKeyframeRow[] = [];
  const markers: MarkerRow[] = [];
  const importSources: string[] = [];
  const isModule = relPath.endsWith(".module.css");
  const seenClasses = new Set<string>();

  try {
    transform({
      filename: filePath,
      code: Buffer.from(source),
      errorRecovery: true,
      analyzeDependencies: true,
      customAtRules: {
        // Tailwind v4 @theme blocks
        theme: { body: "declaration-list" },
      },
      visitor: {
        Declaration: {
          custom(property: any) {
            variables.push({
              file_path: relPath,
              name: property.name,
              value: stringifyCssValue(property.value),
              scope: ":root",
              line_number: property.loc?.line ?? 0,
            });
            return undefined;
          },
        },
        Rule: {
          style(rule) {
            const line = rule.value.loc?.line ?? 0;
            extractClassNames(
              rule.value.selectors,
              relPath,
              isModule,
              line,
              classes,
              seenClasses,
            );
            return undefined;
          },
          keyframes(rule) {
            const name = rule.value.name;
            if (typeof name === "string") {
              keyframes.push({
                file_path: relPath,
                name,
                line_number: rule.value.loc?.line ?? 0,
              });
            } else if (name && typeof name === "object" && "value" in name) {
              keyframes.push({
                file_path: relPath,
                name: name.value,
                line_number: rule.value.loc?.line ?? 0,
              });
            }
            return undefined;
          },
          custom: {
            theme(rule) {
              const decls = rule.body?.value;
              if (decls && typeof decls === "object") {
                const declarations = (decls as any).declarations ?? [];
                for (const decl of declarations) {
                  if (decl.property === "custom" && decl.value?.name) {
                    variables.push({
                      file_path: relPath,
                      name: decl.value.name,
                      value: stringifyCssValue(decl.value.value),
                      scope: "@theme",
                      line_number: decl.value.loc?.line ?? 0,
                    });
                  }
                }
              }
              return undefined;
            },
          },
        },
      },
    });
  } catch {
    // If Lightning CSS can't parse the file at all, fall back to regex
    const lines = source.split("\n");
    extractCssVariablesRegex(lines, relPath, variables);
    extractCssClassesRegex(lines, relPath, isModule, classes, seenClasses);
    extractCssKeyframesRegex(lines, relPath, keyframes);
  }

  // Extract @import sources from raw source (more reliable with Tailwind syntax)
  extractImportSources(source, importSources);

  markers.push(...extractMarkers(source, relPath));

  return { variables, classes, keyframes, markers, importSources };
}

function stringifyCssValue(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((v) => stringifyToken(v)).join(" ");
  }
  return JSON.stringify(value);
}

function stringifyToken(token: any): string {
  if (!token) return "";
  if (typeof token === "string") return token;
  if (token.type === "length")
    return `${token.value?.value ?? 0}${token.value?.unit ?? ""}`;
  if (token.type === "percentage") return `${token.value ?? 0}%`;
  if (token.type === "color") return stringifyColor(token.value);
  if (token.type === "token") {
    const t = token.value;
    if (t?.type === "ident") return t.value;
    if (t?.type === "number") return String(t.value);
    if (t?.type === "dimension") return `${t.value}${t.unit ?? ""}`;
    if (t?.type === "comma") return ",";
    if (t?.type === "string") return `"${t.value}"`;
    return t?.value ?? "";
  }
  if (token.type === "var") return `var(${token.value?.name ?? ""})`;
  if (token.type === "env") return `env(${token.value?.name ?? ""})`;
  return "";
}

function stringifyColor(color: any): string {
  if (!color) return "";
  if (color.type === "rgb") return `rgb(${color.r}, ${color.g}, ${color.b})`;
  if (color.type === "rgba")
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.alpha})`;
  return JSON.stringify(color);
}

function extractClassNames(
  selectors: any[][],
  filePath: string,
  isModule: boolean,
  line: number,
  classes: CssClassRow[],
  seen: Set<string>,
) {
  if (!selectors) return;
  for (const selector of selectors) {
    for (const component of selector) {
      if (component.type === "class" && !seen.has(component.name)) {
        seen.add(component.name);
        classes.push({
          file_path: filePath,
          name: component.name,
          is_module: isModule ? 1 : 0,
          line_number: line,
        });
      }
    }
  }
}

const CSS_VAR_RE = /^\s*(--[\w-]+)\s*:\s*(.+?)\s*;/gm;

function extractCssVariablesRegex(
  lines: string[],
  filePath: string,
  variables: CssVariableRow[],
) {
  for (let i = 0; i < lines.length; i++) {
    CSS_VAR_RE.lastIndex = 0;
    const match = CSS_VAR_RE.exec(lines[i]);
    if (match) {
      variables.push({
        file_path: filePath,
        name: match[1],
        value: match[2],
        scope: "unknown",
        line_number: i + 1,
      });
    }
  }
}

const CSS_CLASS_RE = /\.([a-zA-Z_][\w-]*)/g;

function extractCssClassesRegex(
  lines: string[],
  filePath: string,
  isModule: boolean,
  classes: CssClassRow[],
  seen: Set<string>,
) {
  for (let i = 0; i < lines.length; i++) {
    CSS_CLASS_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CSS_CLASS_RE.exec(lines[i])) !== null) {
      if (!seen.has(match[1])) {
        seen.add(match[1]);
        classes.push({
          file_path: filePath,
          name: match[1],
          is_module: isModule ? 1 : 0,
          line_number: i + 1,
        });
      }
    }
  }
}

const KEYFRAMES_RE = /@keyframes\s+([\w-]+)/g;

function extractCssKeyframesRegex(
  lines: string[],
  filePath: string,
  keyframes: CssKeyframeRow[],
) {
  for (let i = 0; i < lines.length; i++) {
    KEYFRAMES_RE.lastIndex = 0;
    const match = KEYFRAMES_RE.exec(lines[i]);
    if (match) {
      keyframes.push({
        file_path: filePath,
        name: match[1],
        line_number: i + 1,
      });
    }
  }
}

const IMPORT_RE = /@import\s+(?:url\()?['"]([^'"]+)['"]\)?/g;

function extractImportSources(source: string, importSources: string[]) {
  let match: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    importSources.push(match[1]);
  }
}
