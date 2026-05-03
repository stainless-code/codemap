import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { codemapUserConfigSchema } from "../config";
import type { CodemapUserConfig } from "../config";
import { STATE_CONFIG_BASENAMES } from "./state-dir";

export interface EnsureStateConfigResult {
  /** Found basename (e.g. `config.json`) or undefined when no config file exists. */
  found: (typeof STATE_CONFIG_BASENAMES)[number] | undefined;
  /** True only for JSON drift; TS/JS configs are validate-only and never rewritten. */
  written: boolean;
  /** Validation errors collected during reconciliation (each logged via `console.warn`). */
  warnings: string[];
}

/**
 * Self-healing reconciler for `<state-dir>/config.{ts,js,json}` (D8 + D11).
 * No-op when no config file exists (codemap's defaults cover everything).
 *
 * **JSON path** — parse, validate against {@link codemapUserConfigSchema}
 * (passthrough so we can detect+prune unknown keys), key-sort the
 * validated subset alphabetically, write back only on drift. Bumping
 * the schema in v2 IS the migration: every consumer's `config.json` is
 * normalised on next codemap run.
 *
 * **TS/JS path** — validate-only at load time (handled by `loadUserConfig`);
 * never rewritten. User code is sacred.
 */
export function ensureStateConfig(stateDir: string): EnsureStateConfigResult {
  for (const basename of STATE_CONFIG_BASENAMES) {
    const path = join(stateDir, basename);
    if (!existsSync(path)) continue;

    // TS/JS validation happens at load time (loadUserConfig); never rewrite.
    if (basename !== "config.json") {
      return { found: basename, written: false, warnings: [] };
    }

    const raw = readFileSync(path, "utf-8");
    const warnings: string[] = [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      warnings.push(
        `${path}: invalid JSON, leaving file alone (${err instanceof Error ? err.message : String(err)})`,
      );
      for (const w of warnings) console.warn(w);
      return { found: basename, written: false, warnings };
    }

    // Passthrough so we can prune unknown keys; strict rejection lives
    // in `parseCodemapUserConfig` (config.ts), authoritative for runtime.
    const result = codemapUserConfigSchema.passthrough().safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        warnings.push(
          `${path}: ${issue.path.join(".") || "(root)"} — ${issue.message}`,
        );
      }
      for (const w of warnings) console.warn(w);
      return { found: basename, written: false, warnings };
    }

    const known: CodemapUserConfig = pickKnown(result.data);
    const droppedKeys = Object.keys(result.data).filter((k) => !(k in known));
    for (const k of droppedKeys) {
      warnings.push(`${path}: unknown key "${k}" pruned`);
    }
    const sorted = sortKeys(known);
    const next = `${JSON.stringify(sorted, null, 2)}\n`;
    if (next === raw) {
      return { found: basename, written: false, warnings };
    }
    for (const w of warnings) console.warn(w);
    writeFileSync(path, next, "utf-8");
    return { found: basename, written: true, warnings };
  }
  return { found: undefined, written: false, warnings: [] };
}

function pickKnown(obj: Record<string, unknown>): CodemapUserConfig {
  const known = new Set(Object.keys(codemapUserConfigSchema.shape));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (known.has(k)) out[k] = v;
  }
  return out as CodemapUserConfig;
}

function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
  ) as T;
}
