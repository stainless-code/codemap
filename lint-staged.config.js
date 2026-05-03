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

/**
 * `oxlint` exits 1 when every staged file matches an `ignorePatterns` entry
 * (e.g. all-fixture commits) — filter out ignored paths before lint-staged
 * passes them to oxlint. Same for format:check via oxfmt.
 */
function lintStaged(filenames) {
  const lintable = filenames.filter((f) => {
    const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
    return !rel.startsWith("fixtures/");
  });
  if (lintable.length === 0) return "true";
  return `bun run lint ${lintable.map((f) => JSON.stringify(f)).join(" ")}`;
}

/** @type {import('lint-staged').Configuration} */
export default {
  "*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}": ["bun run format:check", lintStaged],
  "*.{css,json,md,mdc,html,yaml,yml}": "bun run format:check",
  "*.{ts,tsx}": typecheckStagedFiles,
  "*.test.ts": "bun test",
};
