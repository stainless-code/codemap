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

  it("drops empty optional {{param}} pairs from --params", () => {
    const out = renderRecipeActionCommands(
      [
        {
          type: "apply-migrate-jsx-prop",
          command:
            "codemap apply migrate-jsx-prop --params old_name={{old_name}},new_name={{new_name}},component_name={{component_name}},in_file={{in_file}} --dry-run --force",
        },
      ],
      { old_name: "data-id", new_name: "data-testid" },
    );
    expect(out?.[0]?.command).toBe(
      "codemap apply migrate-jsx-prop --params old_name=data-id,new_name=data-testid --dry-run --force",
    );
  });

  it("removes --params when every placeholder is empty", () => {
    const out = renderRecipeActionCommands(
      [
        {
          type: "apply-migrate-jsx-prop",
          command:
            "codemap apply migrate-jsx-prop --params component_name={{component_name}},in_file={{in_file}} --dry-run --force",
        },
      ],
      {},
    );
    expect(out?.[0]?.command).toBe(
      "codemap apply migrate-jsx-prop --dry-run --force",
    );
  });

  it("keeps optional params when bound", () => {
    const out = renderRecipeActionCommands(
      [
        {
          type: "remove-stale-import",
          command:
            "codemap apply stale-imports --params in_file={{in_file}},include_type_only={{include_type_only}} --dry-run --force",
        },
      ],
      // Resolved boolean params are 0/1 (see resolveRecipeParams).
      { in_file: "src/widget", include_type_only: 1 },
    );
    expect(out?.[0]?.command).toBe(
      "codemap apply stale-imports --params in_file=src/widget,include_type_only=1 --dry-run --force",
    );
  });
});
