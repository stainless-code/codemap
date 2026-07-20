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

function toPosixRel(file) {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

/** Staged `src/` source `.ts` / `.tsx` (not `*.test.*`). */
function isSourceTsFile(file) {
  const rel = toPosixRel(file);
  if (!rel.startsWith("src/")) return false;
  if (/\.test\.tsx?$/.test(rel)) return false;
  return /\.tsx?$/.test(rel);
}

/** Co-located pair: `foo.ts` → `foo.test.ts`, `foo.tsx` → `foo.test.tsx`. */
function pairedTestPath(file) {
  const rel = toPosixRel(file);
  return rel.replace(/\.tsx$/, ".test.tsx").replace(/\.ts$/, ".test.ts");
}

/**
 * Run paired unit tests when a source file is staged without its test file.
 * Skips pairs already in the staged set (the `*.test.{ts,tsx}` globs run those).
 */
function relatedTests(filenames) {
  const staged = new Set(filenames.map(toPosixRel));
  const tests = [
    ...new Set(
      filenames
        .filter(isSourceTsFile)
        .map(pairedTestPath)
        .filter((t) => fs.existsSync(t) && !staged.has(t)),
    ),
  ];
  if (tests.length === 0) {
    return "true";
  }
  return `bun test ${tests.join(" ")}`;
}

/** @type {import('lint-staged').Configuration} */
export default {
  "*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}": ["bun run format:check", "bun run lint"],
  // `mdx` in format:check; nested `apps/docs/.oxfmtrc.json` ignores `content/**`
  // (oxfmt collapses Blume `:::` fences).
  "*.{css,json,md,mdc,mdx,html,yaml,yml}": "bun run format:check",
  "*.{ts,tsx}": [typecheckStagedFiles, relatedTests],
  "*.test.ts": "bun test",
  "*.test.tsx": "bun test",
  "scripts/**/*.test.mjs": "bun test",
};
