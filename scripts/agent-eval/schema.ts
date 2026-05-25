import { z } from "zod";

const traditionalRegexSchema = z.object({
  globs: z.array(z.string().min(1)),
  regex: z.string().min(1),
  mode: z.enum(["files", "matches"]),
});

const traditionalBuiltinSchema = z.object({
  builtin: z.literal("fanoutImportLines"),
});

export const traditionalSpecSchema = z.union([
  traditionalRegexSchema,
  traditionalBuiltinSchema,
]);

export type TraditionalSpec = z.infer<typeof traditionalSpecSchema>;

export const probeSchema = z.object({
  id: z.string().min(1),
  /** Golden scenario id in fixtures/golden/scenarios.json (SQL + prompt). */
  goldenId: z.string().min(1),
  traditional: traditionalSpecSchema,
});

export type AgentEvalProbe = z.infer<typeof probeSchema>;

export const probesFileSchema = z.object({
  version: z.literal(1),
  probes: z.array(probeSchema).min(1),
});

export type ProbesFile = z.infer<typeof probesFileSchema>;

export function parseProbesJson(raw: string): ProbesFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`agent-eval: invalid probes JSON: ${msg}`);
  }
  const parsed = probesFileSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`agent-eval: invalid probes file: ${parsed.error.message}`);
  }
  return parsed.data;
}
