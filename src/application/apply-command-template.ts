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
  const substituted = template.replace(
    /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g,
    (_m, name: string) => {
      const value = valueByName.get(name);
      return value ?? "";
    },
  );
  return scrubEmptyApplyParamPairs(substituted);
}

/** Drop `key=` pairs with empty values after optional `{{param}}` substitution. */
function scrubEmptyApplyParamPairs(command: string): string {
  const match = command.match(/(--params\s+)(.+?)(?=\s+--|$)/);
  if (match === null) return command;
  const pairs = match[2]!.split(",").filter((pair) => {
    const eq = pair.indexOf("=");
    return eq !== -1 && pair.slice(eq + 1).length > 0;
  });
  if (pairs.length === 0) {
    return command.replace(match[0], "").replace(/\s{2,}/g, " ");
  }
  return command.replace(match[0], `${match[1]}${pairs.join(",")}`);
}
