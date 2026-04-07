import packageJson from "../package.json" with { type: "json" };

/**
 * Package version from `package.json` (inlined at build time).
 */
export const CODEMAP_VERSION = packageJson.version;
