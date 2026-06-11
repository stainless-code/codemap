import { describe, expect, it } from "bun:test";

import {
  assertServeBindRequiresToken,
  isLoopbackHost,
  serveBindTokenRequiredMessage,
} from "./serve-bind-policy";

describe("isLoopbackHost", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.0.0.2", true],
    ["localhost", true],
    ["::1", true],
    ["[::1]", true],
    ["0.0.0.0", false],
    ["::", false],
    ["192.168.1.1", false],
  ] as const)("host %s → %s", (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});

describe("serveBindTokenRequiredMessage", () => {
  it("requires token on non-loopback binds", () => {
    expect(serveBindTokenRequiredMessage("0.0.0.0", undefined)).toContain(
      "non-loopback bind requires --token",
    );
    expect(serveBindTokenRequiredMessage("::", undefined)).toContain(
      "non-loopback bind requires --token",
    );
  });

  it("allows loopback binds without token", () => {
    expect(
      serveBindTokenRequiredMessage("127.0.0.1", undefined),
    ).toBeUndefined();
    expect(
      serveBindTokenRequiredMessage("127.0.0.2", undefined),
    ).toBeUndefined();
    expect(serveBindTokenRequiredMessage("[::1]", undefined)).toBeUndefined();
  });

  it("assertServeBindRequiresToken throws with the same message", () => {
    expect(() => assertServeBindRequiresToken("0.0.0.0", undefined)).toThrow(
      /non-loopback bind requires --token/,
    );
  });

  it("treats whitespace-only token as missing on non-loopback binds", () => {
    expect(serveBindTokenRequiredMessage("0.0.0.0", "   ")).toContain(
      "non-loopback bind requires --token",
    );
  });
});
