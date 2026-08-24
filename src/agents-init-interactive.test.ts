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
    // Bun 1.4 `styleText` is a no-op without a TTY / when NO_COLOR is set
    // (CI and this sandbox). Skip the stream check so we assert the dim codes.
    const dimmed = styleText("dim", "hello", { validateStream: false });
    expect(dimmed).toBe(styleText("dim", "hello", { validateStream: false }));
    expect(dimmed).not.toBe("hello");
  });
});
