import { expect, test } from "bun:test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import fg from "fast-glob";

import { globSync } from "./glob-sync";

test("globSync matches fast-glob (Bun parity)", () => {
  if (typeof Bun === "undefined") return;

  const cwd = join(
    dirname(fileURLToPath(import.meta.url)),
    "../fixtures/minimal",
  );
  const pattern = "**/*.{ts,tsx}";
  const a = globSync(pattern, cwd).sort();
  const b = fg.sync(pattern, { cwd, dot: true, absolute: false }).sort();
  expect(a).toEqual(b);
});
