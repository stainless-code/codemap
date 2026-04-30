import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  codeownersGlobToRegex,
  discoverWorkspaceRoots,
  firstDirectory,
  groupRowsBy,
  isGroupByMode,
  loadCodeowners,
  makePackageBucketizer,
} from "./group-by";

describe("isGroupByMode", () => {
  it("accepts owner / directory / package", () => {
    expect(isGroupByMode("owner")).toBe(true);
    expect(isGroupByMode("directory")).toBe(true);
    expect(isGroupByMode("package")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isGroupByMode("file")).toBe(false);
    expect(isGroupByMode("")).toBe(false);
  });
});

describe("firstDirectory", () => {
  it("returns the first segment", () => {
    expect(firstDirectory("src/cli/foo.ts")).toBe("src");
    expect(firstDirectory("docs/architecture.md")).toBe("docs");
  });
  it("returns the path itself when there is no slash", () => {
    expect(firstDirectory("README.md")).toBe("README.md");
  });
});

describe("groupRowsBy", () => {
  it("groups rows by directory and sorts by count desc, key asc", () => {
    const rows = [
      { file_path: "src/a.ts" },
      { file_path: "src/b.ts" },
      { file_path: "docs/x.md" },
      { file_path: "src/c.ts" },
    ];
    const grouped = groupRowsBy(rows, firstDirectory);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ key: "src", count: 3 });
    expect(grouped[1]).toMatchObject({ key: "docs", count: 1 });
  });

  it("uses PATH_COLUMNS in order — picks the first present", () => {
    const rows = [{ from_path: "src/a.ts", to_path: "docs/b.md" }];
    const grouped = groupRowsBy(rows, firstDirectory);
    expect(grouped[0]?.key).toBe("src"); // from_path wins (path/file_path absent)
  });

  it("buckets path-less rows under <unknown>", () => {
    const grouped = groupRowsBy([{ count: 5 }, { count: 9 }], firstDirectory);
    expect(grouped[0]?.key).toBe("<unknown>");
    expect(grouped[0]?.count).toBe(2);
  });

  it("uses the noBucketLabel when bucketize returns undefined", () => {
    const grouped = groupRowsBy(
      [{ file_path: "src/a.ts" }],
      () => undefined,
      "<no-owner>",
    );
    expect(grouped[0]?.key).toBe("<no-owner>");
  });
});

describe("codeownersGlobToRegex", () => {
  it("matches anchored directory patterns", () => {
    const re = codeownersGlobToRegex("/src/cli/");
    expect(re.test("src/cli/foo.ts")).toBe(true);
    expect(re.test("src/other.ts")).toBe(false);
  });
  it("matches '*' as a single-segment wildcard", () => {
    const re = codeownersGlobToRegex("*.md");
    expect(re.test("README.md")).toBe(true);
    expect(re.test("docs/x.md")).toBe(true); // unanchored
    expect(re.test("docs.txt")).toBe(false);
  });
  it("matches '**' as multi-segment", () => {
    const re = codeownersGlobToRegex("/src/**/*.test.ts");
    expect(re.test("src/cli/foo.test.ts")).toBe(true);
    expect(re.test("src/foo.test.ts")).toBe(true);
    expect(re.test("docs/cli/foo.test.ts")).toBe(false);
  });
});

describe("loadCodeowners", () => {
  it("returns null when no CODEOWNERS file is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-co-"));
    try {
      expect(loadCodeowners(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses .github/CODEOWNERS and returns last-match-wins owner", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-co-"));
    try {
      mkdirSync(join(dir, ".github"));
      writeFileSync(
        join(dir, ".github/CODEOWNERS"),
        [
          "# Default catch-all",
          "* @core",
          "/src/cli/ @cli-team @core",
          "*.md @docs",
        ].join("\n"),
      );
      const match = loadCodeowners(dir);
      expect(match).not.toBeNull();
      expect(match!("src/cli/foo.ts")).toBe("@cli-team");
      expect(match!("README.md")).toBe("@docs"); // last rule wins
      expect(match!("src/db.ts")).toBe("@core"); // catch-all
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("makePackageBucketizer", () => {
  it("returns the longest matching workspace prefix", () => {
    const b = makePackageBucketizer(["packages/api", "packages/api-core"]);
    expect(b("packages/api/src/x.ts")).toBe("packages/api");
    expect(b("packages/api-core/src/x.ts")).toBe("packages/api-core");
  });
  it("buckets out-of-workspace paths to <root>", () => {
    const b = makePackageBucketizer(["packages/api"]);
    expect(b("README.md")).toBe("<root>");
  });
});

describe("discoverWorkspaceRoots", () => {
  it("expands package.json workspaces patterns", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-ws-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ workspaces: ["packages/*"] }),
      );
      mkdirSync(join(dir, "packages/api"), { recursive: true });
      mkdirSync(join(dir, "packages/web"), { recursive: true });
      const roots = discoverWorkspaceRoots(dir);
      expect(roots).toContain("packages/api");
      expect(roots).toContain("packages/web");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses pnpm-workspace.yaml packages list", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-ws-"));
    try {
      mkdirSync(join(dir, "apps/web"), { recursive: true });
      writeFileSync(
        join(dir, "pnpm-workspace.yaml"),
        ["packages:", '  - "apps/*"', "  - libs/shared"].join("\n"),
      );
      mkdirSync(join(dir, "libs/shared"), { recursive: true });
      const roots = discoverWorkspaceRoots(dir);
      expect(roots).toContain("apps/web");
      expect(roots).toContain("libs/shared");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns [] when no workspaces are declared", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-ws-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({}));
      expect(discoverWorkspaceRoots(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
