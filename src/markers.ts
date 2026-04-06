import type { MarkerRow } from "./db";

const MARKER_RE = /\b(TODO|FIXME|HACK|NOTE)[\s:]+(.+)/g;

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
