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

const matchEveryRowFieldEqualsSchema = z.object({
  kind: z.literal("everyRowFieldEquals"),
  field: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const matchSchema = z.union([
  matchExactSchema,
  matchMinRowsSchema,
  matchEveryRowContainsSchema,
  matchEveryRowFieldEqualsSchema,
]);

export type GoldenMatch = z.infer<typeof matchSchema>;

/**
 * One-time or per-scenario setup step. Extend the union as more one-shot
 * ingest / reset verbs land.
 */
export const setupStepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ingest-coverage"),
    /** Path relative to the fixture root (e.g. `coverage/coverage-final.json`). */
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal("clear-coverage"),
  }),
]);

export type GoldenSetupStep = z.infer<typeof setupStepSchema>;

export const scenarioSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().optional(),
    sql: z.string().optional(),
    recipe: z.string().optional(),
    params: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    match: matchSchema.optional(),
    /** Runs after global `setup` and before this scenario's query (e.g. clear coverage). */
    preSetup: z.array(setupStepSchema).optional(),
    budgetMs: z.number().positive().optional(),
  })
  .refine(
    (s) => {
      const hasSql = typeof s.sql === "string" && s.sql.length > 0;
      const hasRecipe = typeof s.recipe === "string" && s.recipe.length > 0;
      return hasSql !== hasRecipe;
    },
    { message: "Scenario must have exactly one of sql or recipe" },
  )
  .refine(
    (s) => {
      // Raw-SQL scenarios cannot declare params; recipe-param validation
      // (`resolveRecipeParams`) only runs on the recipe path. The runtime
      // check in `query-golden.ts` enforces the same invariant; this
      // schema-level refine fails at parse time with a clearer message.
      const hasParams = s.params !== undefined;
      const hasSql = typeof s.sql === "string" && s.sql.length > 0;
      return !hasParams || !hasSql;
    },
    {
      message:
        "Scenario params are only allowed alongside `recipe`, not raw `sql`",
    },
  );

export type GoldenScenario = z.infer<typeof scenarioSchema>;

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
