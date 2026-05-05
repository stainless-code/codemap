import type { MarkerRow, SuppressionRow } from "./db";

const MARKER_RE = /\b(TODO|FIXME|HACK|NOTE)[\s:]+(.+)/g;

// Leader must start the line (modulo whitespace) so the directive never
// matches inside a string literal — both this clone's tests and recipe docs
// embed the phrase legitimately.
const SUPPRESS_RE =
  /(?:^|\n)\s*(?:\/\/|#|--|<!--|\/\*+)\s*codemap-ignore-(next-line|file)\s+([\w.\-/:@]+)/g;

export function extractMarkers(source: string, filePath: string): MarkerRow[] {
  const markers: MarkerRow[] = [];
  MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lineNum = 1;
  let lastIdx = 0;
  while ((match = MARKER_RE.exec(source)) !== null) {
    for (let i = lastIdx; i < match.index; i++) {
      if (source.charCodeAt(i) === 10) lineNum++;
    }
    lastIdx = match.index;
    markers.push({
      file_path: filePath,
      line_number: lineNum,
      kind: match[1],
      content: match[2].trim(),
    });
  }
  return markers;
}

export function extractSuppressions(
  source: string,
  filePath: string,
): SuppressionRow[] {
  const out: SuppressionRow[] = [];
  SUPPRESS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SUPPRESS_RE.exec(source)) !== null) {
    // Index of the directive keyword, not match.index — the pattern can
    // consume a leading `\n`, which would skew the line count.
    const keywordOffset = match.index + match[0].indexOf("codemap-ignore");
    let line = 1;
    for (let i = 0; i < keywordOffset; i++) {
      if (source.charCodeAt(i) === 10) line++;
    }
    const scope = match[1] as "next-line" | "file";
    const recipeId = match[2];
    // file scope encoded as 0 so a single column carries both shapes.
    const lineNumber = scope === "file" ? 0 : line + 1;
    out.push({
      file_path: filePath,
      line_number: lineNumber,
      recipe_id: recipeId,
    });
  }
  return out;
}
