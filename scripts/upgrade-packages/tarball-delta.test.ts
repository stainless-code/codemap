import { describe, expect, it } from "bun:test";

import type { BunPmDiffFile } from "./tarball-delta";
import {
  FILE_LIST_CAP,
  PATCH_MAX_CHARS,
  PATCH_PATH_CAP,
  addedPatchLines,
  buildDelta,
  classifyChangelogLines,
  classifyNote,
  extractDate,
  failedDelta,
  isKeepPath,
  isSkipFile,
  npmVersionUrl,
  selectPatchPaths,
  shouldKeepPatch,
  slimFiles,
} from "./tarball-delta";

const patch = (
  path: string,
  extra: Partial<BunPmDiffFile> = {},
): BunPmDiffFile => ({
  path,
  status: "modified",
  linesAdded: extra.linesAdded ?? 4,
  linesRemoved: extra.linesRemoved ?? 1,
  ...extra,
});

describe("isKeepPath / isSkipFile", () => {
  it("keeps changelog, package.json, readme, and declaration files", () => {
    expect(isKeepPath("CHANGELOG.md")).toBe(true);
    expect(isKeepPath("package.json")).toBe(true);
    expect(isKeepPath("README.md")).toBe(true);
    expect(isKeepPath("dist/index.d.ts")).toBe(true);
    expect(isKeepPath("dist/index.d.mts")).toBe(true);
    expect(isKeepPath("src/index.js")).toBe(false);
  });

  it("skips source maps", () => {
    expect(isSkipFile({ path: "dist/a.js.map" })).toBe(true);
    expect(isSkipFile({ path: "dist/a.js", sourceMap: true })).toBe(true);
    expect(isSkipFile({ path: "dist/a.js" })).toBe(false);
  });
});

describe("selectPatchPaths", () => {
  it("puts named keep files first, then dts, then highest churn", () => {
    const paths = selectPatchPaths([
      patch("dist/huge.js", { linesAdded: 200, linesRemoved: 50 }),
      patch("package.json", { linesAdded: 2, linesRemoved: 2 }),
      patch("dist/index.d.ts", { linesAdded: 10, linesRemoved: 1 }),
      patch("CHANGELOG.md", { linesAdded: 8, linesRemoved: 0 }),
      patch("dist/a.js.map", { linesAdded: 999, sourceMap: true }),
    ]);
    expect(paths[0]).toBe("package.json");
    expect(paths[1]).toBe("CHANGELOG.md");
    expect(paths[2]).toBe("dist/index.d.ts");
    expect(paths[3]).toBe("dist/huge.js");
    expect(paths).not.toContain("dist/a.js.map");
    expect(
      selectPatchPaths([
        patch("dist/huge.production.mjs", { linesAdded: 400 }),
        patch("src/mapset.ts", { linesAdded: 12 }),
      ]),
    ).toEqual(["src/mapset.ts"]);
  });

  it("boosts extras whose path mentions an imported symbol", () => {
    expect(
      selectPatchPaths(
        [
          patch("src/unrelated.ts", { linesAdded: 80 }),
          patch("src/produce.ts", { linesAdded: 4 }),
        ],
        ["produce"],
      ),
    ).toEqual(["src/produce.ts", "src/unrelated.ts"]);
  });

  it("does not let formatting-only dts eat PATCH_PATH_CAP", () => {
    const files = [
      ...Array.from({ length: PATCH_PATH_CAP }, (_, i) =>
        patch(`dist/n${i}.d.ts`, { linesAdded: 1, formattingOnly: true }),
      ),
      patch("src/useLottie.ts", { linesAdded: 4 }),
    ];
    expect(selectPatchPaths(files, ["useLottie"])).toEqual([
      "src/useLottie.ts",
    ]);
  });

  it("boosts a low-churn .d.ts that mentions an imported symbol", () => {
    const files = [
      ...Array.from({ length: PATCH_PATH_CAP }, (_, i) =>
        patch(`dist/n${i}.d.ts`, { linesAdded: 40 }),
      ),
      patch("build/useLottie.d.ts", { linesAdded: 7 }),
    ];
    const paths = selectPatchPaths(files, ["useLottie"]);
    expect(paths[0]).toBe("build/useLottie.d.ts");
  });

  it("caps total paths", () => {
    const files = Array.from({ length: PATCH_PATH_CAP + 20 }, (_, i) =>
      patch(`src/f${i}.js`, { linesAdded: i }),
    );
    expect(selectPatchPaths(files)).toHaveLength(PATCH_PATH_CAP);
  });
});

describe("shouldKeepPatch", () => {
  it("keeps any fetched non-minified patch", () => {
    expect(shouldKeepPatch("package.json", "@@\n+x\n")).toBe(true);
    expect(shouldKeepPatch("src/a.js", "function other() {}")).toBe(true);
    expect(shouldKeepPatch("src/a.js", null)).toBe(false);
    expect(
      shouldKeepPatch("dist/immer.production.mjs", "function produce() {}"),
    ).toBe(false);
  });
});

describe("classifyNote / addedPatchLines / extractDate", () => {
  it("buckets bun summary notes", () => {
    expect(classifyNote('engines changed: { "node": ">=0.10.0" }')).toBe(
      "peerEngine",
    );
    expect(classifyNote("dependencies immer: 11.0.0 → 11.1.0")).toBe(
      "peerEngine",
    );
    expect(classifyNote("new install script: postinstall")).toBe("security");
    expect(classifyNote("new import of child_process")).toBe("security");
    expect(classifyNote("entry point main changed")).toBe("features");
    expect(classifyNote("breaking: removed produceWithPatches")).toBe(
      "breaking",
    );
    expect(classifyNote("4 files changed")).toBe(null);
  });

  it("takes list items under changelog headings", () => {
    const added = [
      "## 2.0.0",
      "### Breaking Changes",
      "* removed produceWithPatches",
      "### Features",
      "* new enableArrayMethods",
      "### Bug Fixes",
      "* timezone RangeError",
    ].join("\n");
    const classified = classifyChangelogLines(added);
    expect(classified.breaking).toEqual(["removed produceWithPatches"]);
    expect(classified.features).toEqual(["new enableArrayMethods"]);
    expect(classified.security).toEqual([]);
  });

  it("does not treat a dep named fs as a new fs import", () => {
    expect(classifyNote("dependencies graceful-fs: 4.0.0 → 4.2.0")).toBe(
      "peerEngine",
    );
  });

  it("takes added lines and ISO dates from a changelog hunk", () => {
    const hunk = [
      "--- a/CHANGELOG.md",
      "+++ b/CHANGELOG.md",
      "@@ -1,3 +1,8 @@",
      "+## [1.11.23](https://example.com) (2026-08-17)",
      "+",
      "+### Bug Fixes",
      "+* timezone RangeError",
      " ## 1.11.22",
    ].join("\n");
    const added = addedPatchLines(hunk);
    expect(added).toContain("## [1.11.23]");
    expect(added).not.toContain("## 1.11.22");
    expect(extractDate(added)).toBe("2026-08-17");
  });
});

describe("slimFiles", () => {
  it("keeps named files ahead of a dts flood when over FILE_LIST_CAP", () => {
    const files = [
      patch("CHANGELOG.md", { linesAdded: 1 }),
      patch("package.json", { linesAdded: 1 }),
      ...Array.from({ length: FILE_LIST_CAP }, (_, i) =>
        patch(`dist/n${i}.d.ts`, { linesAdded: 2 }),
      ),
    ];
    const slim = slimFiles(files);
    expect(slim).toHaveLength(FILE_LIST_CAP);
    expect(slim[0]?.path).toBe("CHANGELOG.md");
    expect(slim[1]?.path).toBe("package.json");
  });

  it("drops maps, truncates kept patches, and caps the list", () => {
    const files: BunPmDiffFile[] = [
      patch("dist/a.js.map", { patch: "MAP", sourceMap: true }),
      patch("package.json", { patch: "x".repeat(PATCH_MAX_CHARS + 50) }),
      ...Array.from({ length: FILE_LIST_CAP + 5 }, (_, i) =>
        patch(`src/n${i}.js`, { linesAdded: i, patch: `fn${i}` }),
      ),
    ];
    const slim = slimFiles(files);
    expect(slim.every((f) => f.path !== "dist/a.js.map")).toBe(true);
    const pkg = slim.find((f) => f.path === "package.json");
    expect(pkg?.patch?.length).toBe(PATCH_MAX_CHARS);
    expect(slim.length).toBe(FILE_LIST_CAP);
    expect(slim.some((f) => f.path === "package.json")).toBe(true);
  });
});

describe("buildDelta / failedDelta / npmVersionUrl", () => {
  it("builds a bun-pm-diff delta from notes + changelog patch", () => {
    const changelog = [
      "@@ -1,1 +1,6 @@",
      "+## 2.0.0 (2026-01-02)",
      "+### Breaking Changes",
      "+* removed produceWithPatches",
      "+### Features",
      "+* new enableArrayMethods",
    ].join("\n");
    const delta = buildDelta({
      target: "2.0.0",
      changelogUrl: npmVersionUrl("immer", "2.0.0"),
      stat: {
        from: "immer@1.0.0",
        to: "immer@2.0.0",
        notes: [
          "dependencies zod: 3.0.0 → 4.0.0",
          "new import of child_process",
        ],
        totals: {
          files: 3,
          added: 0,
          deleted: 0,
          linesAdded: 10,
          linesRemoved: 2,
          formattingOnly: 0,
        },
        files: [
          patch("CHANGELOG.md", { linesAdded: 6 }),
          patch("src/produce.js", { linesAdded: 3 }),
        ],
      },
      patches: {
        files: [
          { path: "CHANGELOG.md", patch: changelog },
          {
            path: "src/produce.js",
            patch: "@@\n+export function produce() {}\n",
          },
        ],
      },
    });
    expect(delta.source).toBe("bun-pm-diff");
    expect(delta.error).toBeNull();
    expect(delta.date).toBe("2026-01-02");
    expect(delta.peerEngine.some((l) => /zod/.test(l))).toBe(true);
    expect(delta.security.some((l) => /child_process/.test(l))).toBe(true);
    expect(delta.breaking.some((l) => /produceWithPatches/.test(l))).toBe(true);
    expect(delta.releaseNotes).toContain("2.0.0");
    expect(
      delta.tarball?.files.find((f) => f.path === "src/produce.js")?.patch,
    ).toContain("produce");
    expect(delta.changelogUrl).toBe(
      "https://www.npmjs.com/package/immer/v/2.0.0",
    );
  });

  it("keeps the npm URL on a failed gather", () => {
    const delta = failedDelta(
      "1.2.3",
      npmVersionUrl("@scope/pkg", "1.2.3"),
      "bun pm diff exited 1",
    );
    expect(delta.source).toBe("none");
    expect(delta.tarball).toBeNull();
    expect(delta.changelogUrl).toBe(
      "https://www.npmjs.com/package/@scope/pkg/v/1.2.3",
    );
    expect(delta.error).toContain("exited 1");
  });
});
