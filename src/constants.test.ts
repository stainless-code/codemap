import { describe, expect, it } from "bun:test";

import { LANG_MAP } from "./constants";

describe("LANG_MAP", () => {
  it("includes module-style TS/JS extensions", () => {
    expect(LANG_MAP[".mts"]).toBe("mts");
    expect(LANG_MAP[".cts"]).toBe("cts");
    expect(LANG_MAP[".mjs"]).toBe("mjs");
    expect(LANG_MAP[".cjs"]).toBe("cjs");
  });
});
