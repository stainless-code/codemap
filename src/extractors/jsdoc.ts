/**
 * JSDoc machinery — block-comment doc index + visibility-tag extraction.
 * Tier 5 (`jsdoc_tags` table) will extend this surface with structured
 * tag extraction.
 */

export interface JsDocEntry {
  end: number;
  text: string;
}

export function buildJsDocIndex(
  comments: readonly { type: string; value: string; end: number }[],
): JsDocEntry[] {
  if (!comments?.length) return [];
  const docs: JsDocEntry[] = [];
  for (const c of comments) {
    if (c.type !== "Block" || !c.value.startsWith("*")) continue;
    docs.push({ end: c.end, text: cleanJsDoc(c.value) });
  }
  return docs;
}

export function cleanJsDoc(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
}

/**
 * Binary-search the doc immediately preceding `nodeStart`, then reject
 * the match if any of `;`, `{`, `}` appears between the doc end and the
 * node start — those terminate a previous declaration and break the
 * "doc attaches to next declaration" invariant.
 */
export function findJsDoc(
  docs: JsDocEntry[],
  nodeStart: number,
  source: string,
): string | null {
  if (!docs.length) return null;
  let lo = 0;
  let hi = docs.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (docs[mid].end <= nodeStart) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return null;
  const doc = docs[best];
  for (let i = doc.end; i < nodeStart; i++) {
    const ch = source.charCodeAt(i);
    if (ch === 59 || ch === 123 || ch === 125) return null; // ; { }
  }
  return doc.text || null;
}

// Anchored on line-start (after cleanJsDoc strips the `*` prefix) so
// backticked references inside prose (`Extract @public from …`) don't
// match. Trailing word-boundary keeps `@betaTwo` from matching `@beta`.
const VISIBILITY_TAG_RE =
  /(?:^|\n)\s*@(public|private|internal|alpha|beta)(?![A-Za-z0-9_])/;

export function extractVisibility(doc: string | null): string | null {
  if (doc === null || doc === "") return null;
  const m = VISIBILITY_TAG_RE.exec(doc);
  return m?.[1] ?? null;
}
