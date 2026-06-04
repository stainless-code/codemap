import type { RecipeParamValues } from "./recipe-params";
import type { RecipeAction } from "./recipes-loader";

/**
 * Renders `{{param}}` placeholders in recipe action `command` templates using
 * bound param values (same names as recipe frontmatter `params:`).
 */
export function renderRecipeActionCommands(
  actions: RecipeAction[] | undefined,
  paramValues: RecipeParamValues,
): RecipeAction[] | undefined {
  if (actions === undefined || actions.length === 0) return actions;
  const valueByName = new Map<string, string>();
  for (const [name, value] of Object.entries(paramValues)) {
    if (value === null) continue;
    valueByName.set(name, String(value));
  }
  return actions.map((action) => {
    if (action.command === undefined) return action;
    return {
      ...action,
      command: renderCommandTemplate(action.command, valueByName),
    };
  });
}

function renderCommandTemplate(
  template: string,
  valueByName: Map<string, string>,
): string {
  return template.replace(
    /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g,
    (_m, name: string) => {
      const value = valueByName.get(name);
      return value ?? "";
    },
  );
}
