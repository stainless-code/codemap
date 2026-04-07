import { defineConfig } from "tsdown";

const outDir = "dist";

export default defineConfig({
  entry: ["src/index.ts", "src/parse-worker-node.ts", "src/parse-worker.ts"],
  outDir,
  format: "esm",
  platform: "node",
  dts: true,
  /** CLI `codemap` runs `dist/index.mjs`; shebang only on the main chunk (not workers). */
  banner: ({ fileName }) =>
    fileName === "index.mjs" ? { js: "#!/usr/bin/env node\n" } : undefined,
  deps: {
    neverBundle: [
      "bun",
      "better-sqlite3",
      "tinyglobby",
      "lightningcss",
      "oxc-parser",
      "oxc-resolver",
      "bun:sqlite",
    ],
  },
  clean: true,
});
