import { describe, expect, it } from "bun:test";

import {
  formatAgentsInitTargetIdsForError,
  parseAgentsInitTargets,
} from "./agents-init-targets";

describe("parseAgentsInitTargets", () => {
  it("parses comma-separated and repeated segments", () => {
    expect(parseAgentsInitTargets(["cursor,copilot", "cursor"])).toEqual([
      "cursor",
      "copilot",
    ]);
  });

  it("rejects unknown ids with valid list", () => {
    expect(() => parseAgentsInitTargets(["nope"])).toThrow(
      /unknown integration/,
    );
    expect(() => parseAgentsInitTargets(["nope"])).toThrow(
      formatAgentsInitTargetIdsForError(),
    );
  });

  it("rejects empty segments", () => {
    expect(() => parseAgentsInitTargets([","])).toThrow(
      /requires at least one integration id/,
    );
  });
});
