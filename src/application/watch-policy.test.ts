import { describe, expect, it } from "bun:test";

import {
  applyWatchPolicy,
  detectWsl,
  envWatchDefaultOn,
  isWindowsDriveMount,
  watchDisabledReason,
} from "./watch-policy";

describe("watch-policy", () => {
  it("envWatchDefaultOn respects CODEMAP_NO_WATCH and CODEMAP_WATCH=0", () => {
    expect(envWatchDefaultOn({})).toBe(true);
    expect(envWatchDefaultOn({ CODEMAP_NO_WATCH: "1" })).toBe(false);
    expect(envWatchDefaultOn({ CODEMAP_WATCH: "0" })).toBe(false);
    expect(envWatchDefaultOn({ CODEMAP_WATCH: "false" })).toBe(false);
  });

  it("isWindowsDriveMount detects /mnt/<letter> paths", () => {
    expect(isWindowsDriveMount("/mnt/c/Users/foo")).toBe(true);
    expect(isWindowsDriveMount("/mnt/z")).toBe(true);
    expect(isWindowsDriveMount("/home/user/proj")).toBe(false);
    expect(isWindowsDriveMount("/Users/me/proj")).toBe(false);
  });

  it("watchDisabledReason disables WSL Windows mounts by default", () => {
    const reason = watchDisabledReason(
      "/mnt/c/Users/proj",
      {},
      {
        isWsl: () => true,
      },
    );
    expect(reason).toContain("/mnt/*");
  });

  it("CODEMAP_FORCE_WATCH=1 overrides WSL mount detection", () => {
    expect(
      watchDisabledReason(
        "/mnt/c/Users/proj",
        { CODEMAP_FORCE_WATCH: "1" },
        { isWsl: () => true },
      ),
    ).toBeNull();
  });

  it("applyWatchPolicy logs path disables watch but keeps transport alive", () => {
    const { watch } = applyWatchPolicy({
      root: "/mnt/c/repo",
      requestedWatch: true,
      label: "codemap mcp",
      env: {},
      probe: { isWsl: () => true },
    });
    expect(watch).toBe(false);
  });

  it("detectWsl uses injected probe", () => {
    expect(detectWsl({ isWsl: () => true })).toBe(true);
    expect(detectWsl({ isWsl: () => false })).toBe(false);
  });
});
