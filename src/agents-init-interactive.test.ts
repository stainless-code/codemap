import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { styleText } from "node:util";

describe("agents-init-interactive notes", () => {
  it("passes dimNote to every note() call", () => {
    const src = readFileSync(
      new URL("./agents-init-interactive.ts", import.meta.url),
      "utf8",
    );
    const callSites = src.match(/^\s+note\(/gm) ?? [];
    expect(callSites.length).toBe(2);
    expect(src).toContain('"Codemap",\n    dimNote');
    expect(src).toContain('"Summary", dimNote');
  });

  it("dims note body text like @clack/prompts 1.5", () => {
    expect(styleText("dim", "hello")).toBe(styleText("dim", "hello"));
    expect(styleText("dim", "hello")).not.toBe("hello");
  });
});
