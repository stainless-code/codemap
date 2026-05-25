/** Shared terminal / JSON error helpers for `codemap show` and `codemap snippet`. */

export function describeShowSnippetFilter(
  kind: string | undefined,
  inPath: string | undefined,
): string {
  const parts: string[] = [];
  if (kind !== undefined) parts.push(`kind = "${kind}"`);
  if (inPath !== undefined) parts.push(`in = "${inPath}"`);
  return parts.length === 0 ? "" : ` (filters: ${parts.join(", ")})`;
}

export function buildExactNameEmptyMessage(
  verb: "show" | "snippet",
  name: string,
  kind: string | undefined,
  inPath: string | undefined,
): string {
  const filterDesc = describeShowSnippetFilter(kind, inPath);
  const safeName = name.replace(/'/g, "''");
  const fuzzyHint =
    verb === "show"
      ? `Try \`codemap show --query 'name:${safeName}'\` or \`codemap query --json "SELECT name, file_path FROM symbols WHERE name LIKE '%${safeName}%'"\` for fuzzy lookup.`
      : `Try \`codemap show --query 'name:${safeName}'\` for fuzzy lookup.`;
  return `codemap ${verb}: no symbol named "${name}"${filterDesc}. ${fuzzyHint}`;
}

export function emitErrorMaybeJson(message: string, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}
