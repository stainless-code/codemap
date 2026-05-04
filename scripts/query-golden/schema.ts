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

/**
 * One-time setup step run after `cm.index()` and before the first scenario.
 * Currently only `ingest-coverage` (Istanbul / LCOV); extend the union as
 * other one-shot ingest verbs land.
 */
export const setupStepSchema = z.object({
  kind: z.literal("ingest-coverage"),
  /** Path relative to the fixture root (e.g. `coverage/coverage-final.json`). */
  path: z.string().min(1),
});

export type GoldenSetupStep = z.infer<typeof setupStepSchema>;

const legacyArraySchema = z.array(scenarioSchema);
const objectShapeSchema = z.object({
  setup: z.array(setupStepSchema).optional(),
  scenarios: z.array(scenarioSchema),
});

export const scenariosFileSchema = z.union([
  legacyArraySchema,
  objectShapeSchema,
]);

export interface ParsedScenariosFile {
  setup: GoldenSetupStep[];
  scenarios: GoldenScenario[];
}

export function parseScenariosJson(raw: string): ParsedScenariosFile {
  const data: unknown = JSON.parse(raw);
  const parsed = scenariosFileSchema.parse(data);
  if (Array.isArray(parsed)) return { setup: [], scenarios: parsed };
  return { setup: parsed.setup ?? [], scenarios: parsed.scenarios };
}
