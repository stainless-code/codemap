import { z } from "zod";

const matchExactSchema = z.object({ kind: z.literal("exact") });

const matchMinRowsSchema = z.object({
  kind: z.literal("minRows"),
  min: z.number().int().nonnegative(),
});

const matchEveryRowContainsSchema = z.object({
  kind: z.literal("everyRowContains"),
  field: z.string(),
  includes: z.string(),
});

export const matchSchema = z.union([
  matchExactSchema,
  matchMinRowsSchema,
  matchEveryRowContainsSchema,
]);

export type GoldenMatch = z.infer<typeof matchSchema>;

export const scenarioSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().optional(),
    sql: z.string().optional(),
    recipe: z.string().optional(),
    match: matchSchema.optional(),
    budgetMs: z.number().positive().optional(),
  })
  .refine(
    (s) => {
      const hasSql = typeof s.sql === "string" && s.sql.length > 0;
      const hasRecipe = typeof s.recipe === "string" && s.recipe.length > 0;
      return hasSql !== hasRecipe;
    },
    { message: "Scenario must have exactly one of sql or recipe" },
  );

export type GoldenScenario = z.infer<typeof scenarioSchema>;

export const scenariosFileSchema = z.array(scenarioSchema);

export function parseScenariosJson(raw: string): GoldenScenario[] {
  const data: unknown = JSON.parse(raw);
  return scenariosFileSchema.parse(data);
}
