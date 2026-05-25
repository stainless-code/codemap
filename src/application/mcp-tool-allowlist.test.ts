import { describe, expect, it } from "bun:test";

import {
  isMcpToolEnabled,
  resolveMcpToolAllowlist,
} from "./mcp-tool-allowlist";

describe("mcp-tool-allowlist", () => {
  it("returns null allowlist when env unset", () => {
    expect(resolveMcpToolAllowlist({})).toEqual({
      allowlist: null,
      unknown: [],
    });
  });

  it("returns null allowlist when env is whitespace", () => {
    expect(resolveMcpToolAllowlist({ CODEMAP_MCP_TOOLS: "  " })).toEqual({
      allowlist: null,
      unknown: [],
    });
  });

  it("parses comma-separated tool names", () => {
    const { allowlist, unknown } = resolveMcpToolAllowlist({
      CODEMAP_MCP_TOOLS: "query, show",
    });
    expect(unknown).toEqual([]);
    expect(allowlist).toEqual(new Set(["query", "show"]));
  });

  it("ignores unknown names without failing", () => {
    const { allowlist, unknown } = resolveMcpToolAllowlist({
      CODEMAP_MCP_TOOLS: "query,not_a_tool,show",
    });
    expect(unknown).toEqual(["not_a_tool"]);
    expect(allowlist).toEqual(new Set(["query", "show"]));
  });

  it("query_batch is excluded unless explicitly listed", () => {
    const { allowlist } = resolveMcpToolAllowlist({
      CODEMAP_MCP_TOOLS: "query,show",
    });
    expect(isMcpToolEnabled("query_batch", allowlist)).toBe(false);
    expect(
      isMcpToolEnabled(
        "query_batch",
        resolveMcpToolAllowlist({ CODEMAP_MCP_TOOLS: "query_batch" }).allowlist,
      ),
    ).toBe(true);
  });

  it("isMcpToolEnabled allows all when allowlist is null", () => {
    expect(isMcpToolEnabled("query_batch", null)).toBe(true);
  });
});
