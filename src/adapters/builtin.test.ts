import { describe, expect, it } from "bun:test";

import { BUILTIN_ADAPTERS, getAdapterForExtension } from "./builtin";

describe("getAdapterForExtension", () => {
  it("resolves TS/JS extensions to builtin.ts-js", () => {
    expect(getAdapterForExtension(".ts")?.id).toBe("builtin.ts-js");
    expect(getAdapterForExtension(".tsx")?.id).toBe("builtin.ts-js");
  });

  it("resolves .css to builtin.css", () => {
    expect(getAdapterForExtension(".css")?.id).toBe("builtin.css");
  });

  it("resolves .md to builtin.text", () => {
    expect(getAdapterForExtension(".md")?.id).toBe("builtin.text");
  });

  it("returns undefined for unknown extensions", () => {
    expect(getAdapterForExtension(".unknown")).toBeUndefined();
  });

  it("lists built-in adapters", () => {
    expect(BUILTIN_ADAPTERS.length).toBeGreaterThanOrEqual(3);
  });
});
