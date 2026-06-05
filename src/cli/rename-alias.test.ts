import { describe, expect, it } from "bun:test";

import { formatParamsCli, resolveRenameAlias } from "./rename-alias.js";

function rewrite(rest: string[]): string[] | undefined {
  const r = resolveRenameAlias(rest);
  if (r?.kind === "rewrite") return r.argv;
  return undefined;
}

function renameError(rest: string[]): string | undefined {
  const r = resolveRenameAlias(rest);
  if (r?.kind === "error") return r.message;
  return undefined;
}

describe("resolveRenameAlias", () => {
  it("rewrites positional old/new with scoped flags", () => {
    expect(
      rewrite([
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
      rewrite([
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
      rewrite(["rename", "a", "b", "--params", "kind=function", "--dry-run"]),
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
      rewrite([
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

  it("allows apply flags before positional old/new", () => {
    expect(rewrite(["rename", "--dry-run", "helper", "worker"])).toEqual([
      "apply",
      "rename-preview",
      "--params",
      "new=worker,old=helper",
      "--dry-run",
    ]);
  });

  it("returns null for non-rename commands", () => {
    expect(resolveRenameAlias(["apply", "rename-preview"])).toBeNull();
  });

  it("returns null when help is requested", () => {
    expect(resolveRenameAlias(["rename", "--help"])).toBeNull();
  });

  it("preserves missing --params operand for downstream apply parser", () => {
    expect(rewrite(["rename", "--params"])).toEqual([
      "apply",
      "rename-preview",
      "--params",
    ]);
  });

  it("errors on missing --define-in operand", () => {
    expect(renameError(["rename", "a", "b", "--define-in"])).toContain(
      '"--define-in" requires a file path',
    );
  });

  it("errors on missing --in-file operand", () => {
    expect(renameError(["rename", "a", "b", "--in-file"])).toContain(
      '"--in-file" requires a path prefix',
    );
  });

  it("errors on missing --kind operand", () => {
    expect(renameError(["rename", "a", "b", "--kind"])).toContain(
      '"--kind" requires a symbol kind',
    );
  });

  it("errors on a single positional", () => {
    expect(renameError(["rename", "helper"])).toContain(
      "requires <old> and <new>",
    );
  });

  it("errors on a third positional", () => {
    expect(renameError(["rename", "a", "b", "c"])).toMatch(
      /unexpected argument "c"/,
    );
  });
});

describe("formatParamsCli", () => {
  it("serializes key=value pairs", () => {
    expect(formatParamsCli({ old: "a", new: "b", define_in: "src/x.ts" })).toBe(
      "define_in=src/x.ts,new=b,old=a",
    );
  });
});
