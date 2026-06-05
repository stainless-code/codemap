import { describe, expect, it } from "bun:test";

import { MCP_TOOL_NAMES } from "./mcp-tool-allowlist";
import {
  MCP_TOOL_ANNOTATIONS,
  _setSdkSupportsMcpToolAnnotationsForTests,
  buildHttpToolCatalogEntry,
  getMcpToolAnnotations,
  sdkSupportsMcpToolAnnotations,
  withToolAnnotations,
} from "./mcp-tool-annotations";

describe("mcp-tool-annotations", () => {
  it("covers every MCP_TOOL_NAMES entry", () => {
    for (const name of MCP_TOOL_NAMES) {
      expect(MCP_TOOL_ANNOTATIONS[name]).toBeDefined();
      expect(getMcpToolAnnotations(name)).toBeDefined();
    }
  });

  it("apply tools carry destructiveHint", () => {
    for (const name of ["apply", "apply_rows", "apply_diff_input"] as const) {
      expect(getMcpToolAnnotations(name)).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      });
    }
  });

  it("query and audit tools carry readOnlyHint", () => {
    for (const name of [
      "query",
      "query_recipe",
      "query_batch",
      "audit",
      "show",
    ] as const) {
      expect(getMcpToolAnnotations(name)).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
  });

  it("sdkSupportsMcpToolAnnotations is true on pinned SDK", () => {
    expect(sdkSupportsMcpToolAnnotations()).toBe(true);
  });

  it("omits MCP annotations when M.6 guard is false", () => {
    _setSdkSupportsMcpToolAnnotationsForTests(false);
    try {
      expect(getMcpToolAnnotations("apply")).toBeUndefined();
      expect(
        withToolAnnotations("apply", {
          description: "test",
          inputSchema: {},
        }),
      ).toEqual({ description: "test", inputSchema: {} });
    } finally {
      _setSdkSupportsMcpToolAnnotationsForTests(undefined);
    }
  });

  it("index user-data mutators are not destructive", () => {
    for (const name of [
      "save_baseline",
      "drop_baseline",
      "ingest_coverage",
    ] as const) {
      expect(getMcpToolAnnotations(name)).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });
    }
    expect(getMcpToolAnnotations("ingest_coverage")?.idempotentHint).toBe(
      false,
    );
  });

  it("buildHttpToolCatalogEntry mirrors MCP hints", () => {
    const entry = buildHttpToolCatalogEntry("apply");
    expect(entry).toEqual({
      name: "apply",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
  });
});
