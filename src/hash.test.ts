import { describe, expect, it } from "bun:test";

import { hashContent } from "./hash";

describe("hashContent", () => {
  it("matches SHA-256 hex for known strings", () => {
    expect(hashContent("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(hashContent("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("is stable across UTF-8", () => {
    expect(hashContent("café")).toBe(hashContent("café"));
  });
});
