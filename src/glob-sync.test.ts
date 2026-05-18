import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { globSync as tinyglobbySync } from "tinyglobby";

import { globSync } from "./glob-sync";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/minimal",
);

test("globSync single-pattern matches tinyglobby baseline", () => {
  const pattern = "**/*.{ts,tsx}";
  const a = globSync(pattern, FIXTURE).sort();
  const b = tinyglobbySync(pattern, {
    cwd: FIXTURE,
    dot: true,
    absolute: false,
    expandDirectories: false,
  }).sort();
  expect(a).toEqual(b);
});

test("globSync array-pattern unions matches", () => {
  const single = [
    ...globSync("**/*.ts", FIXTURE),
    ...globSync("**/*.tsx", FIXTURE),
  ].sort();
  const array = globSync(["**/*.ts", "**/*.tsx"], FIXTURE).sort();
  expect(new Set(array)).toEqual(new Set(single));
});

test("globSync ignore prunes matching subtrees", () => {
  const noIgnore = globSync("**/*", FIXTURE);
  const withIgnore = globSync("**/*", FIXTURE, {
    ignore: ["**/styles/**"],
  });
  expect(withIgnore.length).toBeLessThan(noIgnore.length);
  expect(withIgnore.some((p) => p.includes("/styles/"))).toBe(false);
});
