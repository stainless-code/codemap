import { describe, expect, it } from "bun:test";

import { formatParamsCli, resolveRenameAlias } from "./rename-alias.js";

describe("resolveRenameAlias", () => {
  it("rewrites positional old/new with scoped flags", () => {
    expect(
      resolveRenameAlias([
        "rename",
        "helper",
        "worker",
        "--define-in",
        "src/a.ts",
        "--yes",
      ]),
    ).toEqual([
      "apply",
      "rename-preview",
      "--params",
      "define_in=src/a.ts,new=worker,old=helper",
      "--yes",
    ]);
  });

  it("rewrites --params form", () => {
    expect(
      resolveRenameAlias([
        "rename",
        "--params",
        "old=foo,new=bar,define_in=src/x.ts",
        "--dry-run",
      ]),
    ).toEqual([
      "apply",
      "rename-preview",
      "--params",
      "define_in=src/x.ts,new=bar,old=foo",
      "--dry-run",
    ]);
  });

  it("merges --params with positional when both present", () => {
    expect(
      resolveRenameAlias([
        "rename",
        "a",
        "b",
        "--params",
        "kind=function",
        "--dry-run",
      ]),
    ).toEqual([
      "apply",
      "rename-preview",
      "--params",
      "kind=function,new=b,old=a",
      "--dry-run",
    ]);
  });

  it("maps --in-file and --kind to recipe params", () => {
    expect(
      resolveRenameAlias([
        "rename",
        "Foo",
        "Bar",
        "--in-file",
        "src/lib/",
        "--kind",
        "function",
      ]),
    ).toEqual([
      "apply",
      "rename-preview",
      "--params",
      "in_file=src/lib/,kind=function,new=Bar,old=Foo",
    ]);
  });

  it("returns null for non-rename commands", () => {
    expect(resolveRenameAlias(["apply", "rename-preview"])).toBeNull();
  });

  it("returns null when help is requested", () => {
    expect(resolveRenameAlias(["rename", "--help"])).toBeNull();
  });

  it("preserves missing --params operand for downstream apply parser", () => {
    expect(resolveRenameAlias(["rename", "--params"])).toEqual([
      "apply",
      "rename-preview",
      "--params",
    ]);
  });
});

describe("formatParamsCli", () => {
  it("serializes key=value pairs", () => {
    expect(formatParamsCli({ old: "a", new: "b", define_in: "src/x.ts" })).toBe(
      "define_in=src/x.ts,new=b,old=a",
    );
  });
});
