import { describe, expect, it } from "bun:test";

import { parseAndNormalizeSearchQuery } from "./show-search-mode";

describe("parseAndNormalizeSearchQuery", () => {
  it("normalizes path: to project-relative", () => {
    const r = parseAndNormalizeSearchQuery(
      "path:src/api name:foo",
      "/tmp/project",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.path).toBe("src/api");
  });
});
