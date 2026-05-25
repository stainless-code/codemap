import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** MCP server key in Cursor / Claude `mcpServers` maps. */
export const CODEMAP_MCP_SERVER_KEY = "codemap";

/** Claude Code permission pattern for all codemap MCP tools. */
export const CODEMAP_MCP_PERMISSION_ALLOW = "mcp__codemap__*";

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpServersFile {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

export interface ClaudeSettingsFile {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

export function buildCodemapMcpServerEntry(opts?: {
  includeWorkspaceRoot?: boolean | undefined;
}): McpServerEntry {
  const args = ["mcp", "--watch"];
  if (opts?.includeWorkspaceRoot === true) {
    args.push("--root", "${workspaceFolder}");
  }
  return { command: "codemap", args };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate top-level file + optional `mcpServers` map before merge. */
export function normalizeExistingMcpServersFile(
  parsed: unknown,
  opts: { label: string; force: boolean },
): {
  existing: McpServersFile;
  replacedInvalid: boolean;
  invalidReason?: "shape" | undefined;
} {
  if (!isPlainObject(parsed)) {
    if (!opts.force) {
      throw new Error(
        `Codemap: ${opts.label} is not a JSON object — use --force to replace.`,
      );
    }
    return { existing: {}, replacedInvalid: true };
  }
  const file = parsed as McpServersFile & Record<string, unknown>;
  const ms = file.mcpServers;
  if (
    ms !== undefined &&
    (ms === null || typeof ms !== "object" || Array.isArray(ms))
  ) {
    if (!opts.force) {
      throw new Error(
        `Codemap: ${opts.label} mcpServers must be a JSON object — use --force to replace.`,
      );
    }
    const { mcpServers: _drop, ...rest } = file;
    return {
      existing: rest as McpServersFile,
      replacedInvalid: true,
      invalidReason: "shape",
    };
  }
  return { existing: file, replacedInvalid: false };
}

export function mergeCodemapMcpServer(
  existing: McpServersFile,
  entry: McpServerEntry,
): McpServersFile {
  const prior = existing.mcpServers ?? {};
  return {
    ...existing,
    mcpServers: {
      ...prior,
      [CODEMAP_MCP_SERVER_KEY]: entry,
    },
  };
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

function writeJsonIfChanged(path: string, value: unknown, label: string): void {
  const next = stableJson(value);
  if (existsSync(path) && readFileSync(path, "utf-8") === next) {
    console.log(`  ${label} already up to date`);
    return;
  }
  writeFileSync(path, next, "utf-8");
  console.log(`  Wrote ${label}`);
}

function formatMcpReplaceWarning(
  label: string,
  reason: "unparseable" | "invalid-shape",
): string {
  const detail =
    reason === "invalid-shape"
      ? "invalid mcpServers shape"
      : "unparseable JSON";
  return `  Warning: replacing ${detail} in ${label} (--force); foreign MCP entries in that file are dropped.`;
}

/**
 * Merge the codemap MCP server into a JSON file with top-level `mcpServers`.
 * Preserves unrelated servers; replaces only the `codemap` entry.
 */
export function upsertMcpServersFile(opts: {
  path: string;
  label: string;
  entry: McpServerEntry;
  force: boolean;
}): void {
  mkdirSync(dirname(opts.path), { recursive: true });
  let existing: McpServersFile = {};
  if (existsSync(opts.path)) {
    let replaceReason: "unparseable" | "invalid-shape" | undefined;
    try {
      const parsed = readJsonFile(opts.path);
      const normalized = normalizeExistingMcpServersFile(parsed, {
        label: opts.label,
        force: opts.force,
      });
      existing = normalized.existing;
      if (normalized.replacedInvalid) {
        replaceReason =
          normalized.invalidReason === "shape"
            ? "invalid-shape"
            : "unparseable";
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Codemap:")) {
        throw err;
      }
      if (!opts.force) {
        throw new Error(
          `Codemap: could not parse ${opts.label} — fix JSON or use --force to replace (${String(err)})`,
          { cause: err },
        );
      }
      replaceReason = "unparseable";
    }
    if (replaceReason !== undefined) {
      console.error(formatMcpReplaceWarning(opts.label, replaceReason));
    }
  }
  writeJsonIfChanged(
    opts.path,
    mergeCodemapMcpServer(existing, opts.entry),
    opts.label,
  );
}

export function mergeClaudeCodemapPermissions(
  existing: ClaudeSettingsFile,
): ClaudeSettingsFile {
  const allow = [...(existing.permissions?.allow ?? [])];
  if (!allow.includes(CODEMAP_MCP_PERMISSION_ALLOW)) {
    allow.push(CODEMAP_MCP_PERMISSION_ALLOW);
  }
  return {
    ...existing,
    permissions: {
      ...existing.permissions,
      allow,
    },
  };
}

export function upsertClaudeSettingsPermissions(opts: {
  projectRoot: string;
  force: boolean;
}): void {
  const path = join(opts.projectRoot, ".claude", "settings.json");
  mkdirSync(dirname(path), { recursive: true });
  let existing: ClaudeSettingsFile = {};
  if (existsSync(path)) {
    let replacedUnparseable = false;
    try {
      const parsed = readJsonFile(path);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        existing = parsed as ClaudeSettingsFile;
      } else if (!opts.force) {
        throw new Error(
          "Codemap: .claude/settings.json is not a JSON object — use --force to replace.",
        );
      } else {
        replacedUnparseable = true;
      }
    } catch (err) {
      if (!opts.force) {
        throw new Error(
          `Codemap: could not parse .claude/settings.json — fix JSON or use --force (${String(err)})`,
          { cause: err },
        );
      }
      replacedUnparseable = true;
    }
    if (replacedUnparseable) {
      console.error(
        "  Warning: replacing unparseable JSON in .claude/settings.json (--force); prior keys in that file are dropped.",
      );
    }
  }
  writeJsonIfChanged(
    path,
    mergeClaudeCodemapPermissions(existing),
    ".claude/settings.json (Codemap MCP permissions)",
  );
}

export type AgentsInitMcpTarget = "cursor" | "claude-code";

export interface ApplyAgentsInitMcpOptions {
  projectRoot: string;
  force?: boolean | undefined;
  targets?: AgentsInitMcpTarget[] | undefined;
}

/**
 * Write project MCP config for Cursor and/or Claude Code.
 * Cursor uses `${workspaceFolder}` root injection; Claude relies on project cwd.
 */
export function applyAgentsInitMcp(opts: ApplyAgentsInitMcpOptions): void {
  const targets = opts.targets ?? (["cursor", "claude-code"] as const);
  const force = opts.force === true;

  if (targets.includes("cursor")) {
    upsertMcpServersFile({
      path: join(opts.projectRoot, ".cursor", "mcp.json"),
      label: ".cursor/mcp.json",
      entry: buildCodemapMcpServerEntry({ includeWorkspaceRoot: true }),
      force,
    });
  }

  if (targets.includes("claude-code")) {
    upsertMcpServersFile({
      path: join(opts.projectRoot, ".mcp.json"),
      label: ".mcp.json (Claude Code)",
      entry: buildCodemapMcpServerEntry(),
      force,
    });
    upsertClaudeSettingsPermissions({ projectRoot: opts.projectRoot, force });
  }
}
