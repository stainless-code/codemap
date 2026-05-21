import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { parsePrCommentRest, runPrCommentCmd } from "./cmd-pr-comment";

describe("parsePrCommentRest", () => {
  it("parses input path and flags", () => {
    expect(parsePrCommentRest(["pr-comment", "audit.json", "--json"])).toEqual({
      kind: "run",
      inputPath: "audit.json",
      shape: undefined,
      json: true,
    });
  });

  it("errors on missing input file", () => {
    expect(parsePrCommentRest(["pr-comment"])).toMatchObject({
      kind: "error",
    });
  });
});

describe("runPrCommentCmd stdin guard", () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it("rejects - when stdin is a TTY", async () => {
    const stderr = spyOn(console, "error").mockImplementation(() => {});
    const desc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      await runPrCommentCmd({
        root: process.cwd(),
        configFile: undefined,
        inputPath: "-",
        shape: undefined,
        json: false,
      });
      expect(stderr.mock.calls[0]?.[0]).toContain("stdin is a TTY");
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    } finally {
      stderr.mockRestore();
      if (desc) Object.defineProperty(process.stdin, "isTTY", desc);
      else Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });
});
