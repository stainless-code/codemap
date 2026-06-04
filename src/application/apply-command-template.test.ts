import { describe, expect, it } from "bun:test";

import { renderRecipeActionCommands } from "./apply-command-template";

describe("renderRecipeActionCommands", () => {
  it("substitutes {{param}} placeholders", () => {
    const out = renderRecipeActionCommands(
      [
        {
          type: "apply-rename",
          command:
            "codemap apply rename-preview --params old={{old}},new={{new}} --yes",
        },
      ],
      { old: "foo", new: "bar" },
    );
    expect(out?.[0]?.command).toBe(
      "codemap apply rename-preview --params old=foo,new=bar --yes",
    );
  });
});
