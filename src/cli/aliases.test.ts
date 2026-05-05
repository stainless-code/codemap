import { describe, expect, it } from "bun:test";

import { listQueryRecipeCatalog } from "../application/query-recipes";
import {
  isOutcomeAlias,
  OUTCOME_ALIASES,
  resolveOutcomeAlias,
} from "./aliases";

describe("OUTCOME_ALIASES", () => {
  it("caps at 5 aliases (avoids alias-sprawl per roadmap)", () => {
    expect(Object.keys(OUTCOME_ALIASES)).toHaveLength(5);
  });

  it("every aliased recipe id exists in the bundled catalog", () => {
    const catalog = new Set(listQueryRecipeCatalog().map((r) => r.id));
    for (const recipeId of Object.values(OUTCOME_ALIASES)) {
      expect(catalog.has(recipeId)).toBe(true);
    }
  });
});

describe("isOutcomeAlias", () => {
  it("returns true for each declared alias", () => {
    for (const alias of Object.keys(OUTCOME_ALIASES)) {
      expect(isOutcomeAlias(alias)).toBe(true);
    }
  });

  it("returns false for the wrapped recipe ids and other tokens", () => {
    expect(isOutcomeAlias("untested-and-dead")).toBe(false);
    expect(isOutcomeAlias("query")).toBe(false);
    expect(isOutcomeAlias("audit")).toBe(false);
    expect(isOutcomeAlias("")).toBe(false);
  });
});

describe("resolveOutcomeAlias", () => {
  it("rewrites a bare alias to query --recipe <id>", () => {
    expect(resolveOutcomeAlias(["dead-code"])).toEqual([
      "query",
      "--recipe",
      "untested-and-dead",
    ]);
    expect(resolveOutcomeAlias(["coverage-gaps"])).toEqual([
      "query",
      "--recipe",
      "worst-covered-exports",
    ]);
  });

  it("preserves trailing args verbatim (flags pass through)", () => {
    expect(
      resolveOutcomeAlias(["deprecated", "--json", "--format", "sarif"]),
    ).toEqual([
      "query",
      "--recipe",
      "deprecated-symbols",
      "--json",
      "--format",
      "sarif",
    ]);
    expect(
      resolveOutcomeAlias([
        "boundaries",
        "--ci",
        "--changed-since",
        "origin/main",
      ]),
    ).toEqual([
      "query",
      "--recipe",
      "boundary-violations",
      "--ci",
      "--changed-since",
      "origin/main",
    ]);
  });

  it("returns null for non-aliases (caller falls through to existing dispatch)", () => {
    expect(resolveOutcomeAlias(["query", "SELECT", "1"])).toBeNull();
    expect(resolveOutcomeAlias(["audit", "--json"])).toBeNull();
    expect(resolveOutcomeAlias([])).toBeNull();
  });
});
