// Astro collections carry no schema here so the Blume config transform never runs;
// Blume's page pipeline rejects non-strings before build, so this guard is defense in depth.
const isString = <Value>(value: Value): value is Value & string =>
  typeof value === "string";

export const normalizeXHandle = <Value>(value: Value): string | undefined => {
  if (!isString(value)) {
    return;
  }
  const handle = value.trim().replace(/^@+/u, "");
  return handle ? `@${handle}` : undefined;
};
