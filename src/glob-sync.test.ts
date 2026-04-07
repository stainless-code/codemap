import { expect, test } from "bun:test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { globSync as tinyglobbySync } from "tinyglobby";

import { globSync } from "./glob-sync";

test("globSync matches tinyglobby (Bun parity)", () => {
  if (typeof Bun === "undefined") return;

  const cwd = join(
    dirname(fileURLToPath(import.meta.url)),
    "../fixtures/minimal",
  );
  const pattern = "**/*.{ts,tsx}";
  const a = globSync(pattern, cwd).sort();
  const b = tinyglobbySync(pattern, {
    cwd,
    dot: true,
    absolute: false,
    expandDirectories: false,
  }).sort();
  expect(a).toEqual(b);
});
