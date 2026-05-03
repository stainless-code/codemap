import fs from "node:fs";
import path from "node:path";

const TEMP_TSCONFIG = "tsconfig.lint-staged.json";

/**
 * Generates a temporary tsconfig that extends the real one but only includes
 * staged TypeScript files under `src/`, so tsgo typechecks only what's being committed.
 */
function typecheckStagedFiles(filenames) {
  const tsFiles = filenames.filter((f) => {
    const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
    return rel.startsWith("src/") && /\.tsx?$/.test(rel);
  });
  if (tsFiles.length === 0) {
    return "true";
  }
  const tsconfig = {
    extends: "./tsconfig.json",
    include: tsFiles.map((f) =>
      path.relative(process.cwd(), f).replace(/\\/g, "/"),
    ),
  };
  fs.writeFileSync(TEMP_TSCONFIG, JSON.stringify(tsconfig));
  return `bun run typecheck -p ${TEMP_TSCONFIG}`;
}

/** @type {import('lint-staged').Configuration} */
export default {
  "*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}": ["bun run format:check", "bun run lint"],
  "*.{css,json,md,mdc,html,yaml,yml}": "bun run format:check",
  "*.{ts,tsx}": typecheckStagedFiles,
  "*.test.ts": "bun test",
};
