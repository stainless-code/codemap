import { describe, expect, it } from "bun:test";

import { createMcpServer } from "./mcp-server";

describe("createMcpServer", () => {
  it("returns an McpServer instance with the codemap identity", () => {
    const server = createMcpServer({
      version: "0.0.0-test",
      root: "/tmp",
    });
    // McpServer doesn't expose the registered tool list directly; the
    // `.server` underlying property is the JSON-RPC server. Smoke check
    // that .connect exists (proves SDK wiring) and that the constructor
    // didn't throw on tool registration. Tool-level behavior is covered
    // in tracer 2+ via in-process SDK transport.
    expect(typeof server.connect).toBe("function");
    expect(typeof server.close).toBe("function");
  });
});
