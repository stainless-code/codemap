import { describe, expect, it } from "bun:test";

import { ghsaVerdict, parseOutdatedTable, semverInRange } from "./evidence";

describe("semverInRange", () => {
  it("matches GHSA AND/OR ranges", () => {
    expect(semverInRange("8.0.0", ">= 7.0.0 < 9.0.6")).toBe(true);
    expect(semverInRange("9.0.6", ">= 7.0.0 < 9.0.6")).toBe(false);
    expect(semverInRange("3.3.18", ">=4.0.0 || >=3.0.0 <3.4.0")).toBe(true);
    expect(semverInRange("3.4.0", ">=4.0.0 || >=3.0.0 <3.4.0")).toBe(false);
  });

  it("is false for a missing range", () => {
    expect(semverInRange("1.0.0", null)).toBe(false);
  });

  it("does not treat an unparseable OR group as a match", () => {
    expect(semverInRange("1.0.0", "not-a-range || also-bad")).toBe(false);
    expect(semverInRange("1.0.0", "not-a-range < 2.0.0")).toBe(false);
  });
});

describe("ghsaVerdict", () => {
  it("picks priority-bump when the target already ships the fix", () => {
    expect(ghsaVerdict(true, "4.3.1", "4.3.1")).toBe("priority-bump");
    expect(ghsaVerdict(true, "4.3.1", "4.4.0")).toBe("priority-bump");
  });

  it("needs a higher target when the fix is past latest", () => {
    expect(ghsaVerdict(true, "5.0.0", "4.3.1")).toBe("needs-higher-target");
  });

  it("clears when the installed version is outside the range", () => {
    expect(ghsaVerdict(false, "4.3.1", "4.3.1")).toBe("cleared-at-current");
  });

  it("is unpatched when in range with no fix", () => {
    expect(ghsaVerdict(true, null, "4.3.1")).toBe("unpatched");
  });
});

describe("parseOutdatedTable", () => {
  it("parses bun outdated rows and strips (dev)", () => {
    const stdout = [
      "| Package | Current | Update | Latest |",
      "| --- | --- | --- | --- |",
      "| immer | 10.0.0 | 10.1.0 | 10.1.1 |",
      "| zod (dev) | 3.23.0 | 3.24.0 | 3.24.2 |",
      "| already | 1.0.0 | 1.0.0 | 1.0.0 |",
    ].join("\n");
    expect(parseOutdatedTable(stdout)).toEqual([
      {
        pkg: "immer",
        current: "10.0.0",
        latest: "10.1.1",
        bumpClass: "minor",
        coupledWith: [],
        dev: false,
      },
      {
        pkg: "zod",
        current: "3.23.0",
        latest: "3.24.2",
        bumpClass: "minor",
        coupledWith: [],
        dev: true,
      },
    ]);
  });

  it("parses workspace-filter rows and strips (peer)/(optional)", () => {
    const stdout = [
      "| Package | Current | Update | Latest | Workspace |",
      "| --- | --- | --- | --- | --- |",
      "| react (peer) | 19.2.7 | 19.2.8 | 19.2.8 | @stainless-code/react-layers |",
      "| alpinejs (optional) | 3.15.12 | 3.15.12 | 3.16.0 | @stainless-code/persist |",
    ].join("\n");
    expect(parseOutdatedTable(stdout)).toEqual([
      {
        pkg: "react",
        current: "19.2.7",
        latest: "19.2.8",
        bumpClass: "patch",
        coupledWith: [],
        dev: false,
      },
      {
        pkg: "alpinejs",
        current: "3.15.12",
        latest: "3.16.0",
        bumpClass: "minor",
        coupledWith: [],
        dev: false,
      },
    ]);
  });
});
