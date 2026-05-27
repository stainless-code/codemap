import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  DEFAULT_AGENTS_INIT_MCP_TARGETS,
  getAgentsInitMcpTargetDef,
  resolveMcpConfigPath,
} from "./agents-init-mcp-registry";
import type {
  AgentsInitMcpTarget,
  AgentsInitMcpTargetDef,
} from "./agents-init-mcp-registry";
import {
  buildCodemapMcpSpawn,
  formatCodemapExec,
  resolveCodemapCliInvocation,
} from "./codemap-invocation";
import type { ResolvedCodemapInvocation } from "./codemap-invocation";

/** MCP server key in Cursor / Claude / Windsurf `mcpServers` maps and VS Code `servers`. */
export const CODEMAP_MCP_SERVER_KEY = "codemap";

/** Claude Code permission pattern for all codemap MCP tools. */
export const CODEMAP_MCP_PERMISSION_ALLOW = "mcp__codemap__*";

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Amazon Q IDE `default.json` stdio transport. */
  transportType?: string;
  disabled?: boolean;
  timeout?: number;
}

export interface McpServersFile {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

export interface VsCodeMcpFile {
  servers?: Record<string, McpServerEntry & { type?: string }>;
  inputs?: unknown[];
  [key: string]: unknown;
}

export interface ClaudeSettingsFile {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

/** Host-specific codemap MCP entry (Cursor root arg, Amazon Q IDE transport fields, …). */
export function buildMcpServerEntryForDef(
  def: Pick<AgentsInitMcpTargetDef, "format" | "workspaceRootArg">,
  invocation: ResolvedCodemapInvocation,
): McpServerEntry {
  const base = buildCodemapMcpSpawn(invocation, def.workspaceRootArg === true);
  if (def.format === "amazon-q-ide") {
    return {
      ...base,
      transportType: "stdio",
      disabled: false,
      timeout: 60,
    };
  }
  return base;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function entriesEqual(a: McpServerEntry, b: McpServerEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Validate top-level file + optional `mcpServers` map before merge. */
export function normalizeExistingMcpServersFile(
  parsed: unknown,
  opts: { label: string },
): { existing: McpServersFile } {
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Codemap: ${opts.label} is not a JSON object — fix JSON manually, then re-run init --mcp.`,
    );
  }
  const file = parsed as McpServersFile & Record<string, unknown>;
  const ms = file.mcpServers;
  if (
    ms !== undefined &&
    (ms === null || typeof ms !== "object" || Array.isArray(ms))
  ) {
    throw new Error(
      `Codemap: ${opts.label} mcpServers must be a JSON object — fix manually, then re-run init --mcp.`,
    );
  }
  return { existing: file };
}

/** Validate top-level file + optional VS Code `servers` map before merge. */
export function normalizeExistingVsCodeMcpFile(
  parsed: unknown,
  opts: { label: string },
): { existing: VsCodeMcpFile } {
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Codemap: ${opts.label} is not a JSON object — fix JSON manually, then re-run init --mcp.`,
    );
  }
  const file = parsed as VsCodeMcpFile & Record<string, unknown>;
  const servers = file.servers;
  if (
    servers !== undefined &&
    (servers === null || typeof servers !== "object" || Array.isArray(servers))
  ) {
    throw new Error(
      `Codemap: ${opts.label} servers must be a JSON object — fix manually, then re-run init --mcp.`,
    );
  }
  return { existing: file };
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

export function mergeCodemapVsCodeServer(
  existing: VsCodeMcpFile,
  entry: McpServerEntry,
): VsCodeMcpFile {
  const prior = existing.servers ?? {};
  return {
    ...existing,
    servers: {
      ...prior,
      [CODEMAP_MCP_SERVER_KEY]: { type: "stdio", ...entry },
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

/** Post-write check — mirrors TanStack Intent's verify-before-success pattern. */
export function verifyCodemapMcpServersFile(opts: {
  path: string;
  label: string;
  expectedEntry: McpServerEntry;
}): void {
  if (!existsSync(opts.path)) {
    throw new Error(`Codemap: ${opts.label} was not written (${opts.path})`);
  }
  let parsed: unknown;
  try {
    parsed = readJsonFile(opts.path);
  } catch (err) {
    throw new Error(
      `Codemap: ${opts.label} is not valid JSON after write (${String(err)})`,
      { cause: err },
    );
  }
  const normalized = normalizeExistingMcpServersFile(parsed, {
    label: opts.label,
  });
  const written = normalized.existing.mcpServers?.[CODEMAP_MCP_SERVER_KEY];
  if (written === undefined) {
    throw new Error(
      `Codemap: ${opts.label} missing ${CODEMAP_MCP_SERVER_KEY} entry after write`,
    );
  }
  if (!entriesEqual(written, opts.expectedEntry)) {
    throw new Error(
      `Codemap: ${opts.label} codemap entry mismatch after write`,
    );
  }
}

export function verifyCodemapVsCodeMcpFile(opts: {
  path: string;
  label: string;
  expectedEntry: McpServerEntry;
}): void {
  if (!existsSync(opts.path)) {
    throw new Error(`Codemap: ${opts.label} was not written (${opts.path})`);
  }
  let parsed: unknown;
  try {
    parsed = readJsonFile(opts.path);
  } catch (err) {
    throw new Error(
      `Codemap: ${opts.label} is not valid JSON after write (${String(err)})`,
      { cause: err },
    );
  }
  const normalized = normalizeExistingVsCodeMcpFile(parsed, {
    label: opts.label,
  });
  const written = normalized.existing.servers?.[CODEMAP_MCP_SERVER_KEY];
  const expected = { type: "stdio" as const, ...opts.expectedEntry };
  if (written === undefined) {
    throw new Error(
      `Codemap: ${opts.label} missing ${CODEMAP_MCP_SERVER_KEY} entry after write`,
    );
  }
  if (
    written.type !== expected.type ||
    !entriesEqual(
      { command: written.command, args: written.args, env: written.env },
      {
        command: expected.command,
        args: expected.args,
        env: expected.env,
      },
    )
  ) {
    throw new Error(
      `Codemap: ${opts.label} codemap entry mismatch after write`,
    );
  }
}

export function verifyClaudeCodemapPermissions(opts: {
  path: string;
  label: string;
}): void {
  if (!existsSync(opts.path)) {
    throw new Error(`Codemap: ${opts.label} was not written (${opts.path})`);
  }
  let parsed: unknown;
  try {
    parsed = readJsonFile(opts.path);
  } catch (err) {
    throw new Error(
      `Codemap: ${opts.label} is not valid JSON after write (${String(err)})`,
      { cause: err },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Codemap: ${opts.label} is not a JSON object after write`);
  }
  const allow = (parsed as ClaudeSettingsFile).permissions?.allow;
  if (!Array.isArray(allow) || !allow.includes(CODEMAP_MCP_PERMISSION_ALLOW)) {
    throw new Error(
      `Codemap: ${opts.label} missing ${CODEMAP_MCP_PERMISSION_ALLOW} after write`,
    );
  }
}

/**
 * Merge the codemap MCP server into a JSON file with top-level `mcpServers`.
 * Preserves unrelated servers; replaces only the `codemap` entry.
 */
export function upsertMcpServersFile(opts: {
  path: string;
  label: string;
  entry: McpServerEntry;
}): void {
  mkdirSync(dirname(opts.path), { recursive: true });
  let existing: McpServersFile = {};
  if (existsSync(opts.path)) {
    try {
      const parsed = readJsonFile(opts.path);
      const normalized = normalizeExistingMcpServersFile(parsed, {
        label: opts.label,
      });
      existing = normalized.existing;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Codemap:")) {
        throw err;
      }
      throw new Error(
        `Codemap: could not parse ${opts.label} — fix JSON manually, then re-run init --mcp (${String(err)})`,
        { cause: err },
      );
    }
  }
  const merged = mergeCodemapMcpServer(existing, opts.entry);
  writeJsonIfChanged(opts.path, merged, opts.label);
  verifyCodemapMcpServersFile({
    path: opts.path,
    label: opts.label,
    expectedEntry: opts.entry,
  });
}

/** Merge codemap into VS Code / Copilot `.vscode/mcp.json` (`servers` key). */
export function upsertVsCodeMcpFile(opts: {
  path: string;
  label: string;
  entry: McpServerEntry;
}): void {
  mkdirSync(dirname(opts.path), { recursive: true });
  let existing: VsCodeMcpFile = {};
  if (existsSync(opts.path)) {
    try {
      const parsed = readJsonFile(opts.path);
      const normalized = normalizeExistingVsCodeMcpFile(parsed, {
        label: opts.label,
      });
      existing = normalized.existing;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Codemap:")) {
        throw err;
      }
      throw new Error(
        `Codemap: could not parse ${opts.label} — fix JSON manually, then re-run init --mcp (${String(err)})`,
        { cause: err },
      );
    }
  }
  writeJsonIfChanged(
    opts.path,
    mergeCodemapVsCodeServer(existing, opts.entry),
    opts.label,
  );
  verifyCodemapVsCodeMcpFile({
    path: opts.path,
    label: opts.label,
    expectedEntry: opts.entry,
  });
}

export function mergeClaudeCodemapPermissions(
  existing: ClaudeSettingsFile,
): ClaudeSettingsFile {
  const existingAllow = existing.permissions?.allow;
  const allow = Array.isArray(existingAllow)
    ? existingAllow.filter((x): x is string => typeof x === "string")
    : [];
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
  const label = ".claude/settings.json (Codemap MCP permissions)";
  mkdirSync(dirname(path), { recursive: true });
  let existing: ClaudeSettingsFile = {};
  if (existsSync(path)) {
    try {
      const parsed = readJsonFile(path);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        const candidate = parsed as ClaudeSettingsFile;
        const allow = candidate.permissions?.allow;
        if (
          allow !== undefined &&
          (!Array.isArray(allow) || allow.some((x) => typeof x !== "string"))
        ) {
          if (!opts.force) {
            throw new Error(
              "Codemap: .claude/settings.json permissions.allow must be a string[] — use --force to coerce invalid entries.",
            );
          }
          existing = {
            ...candidate,
            permissions: {
              ...candidate.permissions,
              allow: Array.isArray(allow)
                ? allow.filter((x): x is string => typeof x === "string")
                : [],
            },
          };
        } else {
          existing = candidate;
        }
      } else {
        throw new Error(
          "Codemap: .claude/settings.json is not a JSON object — fix JSON manually, then re-run init --mcp.",
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Codemap:")) {
        throw err;
      }
      throw new Error(
        `Codemap: could not parse .claude/settings.json — fix JSON manually, then re-run init --mcp (${String(err)})`,
        { cause: err },
      );
    }
  }
  writeJsonIfChanged(path, mergeClaudeCodemapPermissions(existing), label);
  verifyClaudeCodemapPermissions({ path, label });
}

export interface ApplyAgentsInitMcpOptions {
  projectRoot: string;
  force?: boolean | undefined;
  targets?: AgentsInitMcpTarget[] | undefined;
  /** Test hook — defaults to `os.homedir()` for user-global MCP configs. */
  homeDir?: string | undefined;
}

/**
 * Write MCP config for selected integrations. Cursor and VS Code get
 * `${workspaceFolder}` root injection; other cwd-based clients omit `--root`.
 */
export async function applyAgentsInitMcp(
  opts: ApplyAgentsInitMcpOptions,
): Promise<void> {
  const targets = opts.targets ?? [...DEFAULT_AGENTS_INIT_MCP_TARGETS];
  if (targets.length === 0) {
    console.log(
      "  Skipped MCP config — no MCP-capable integrations in selection.",
    );
    return;
  }
  const force = opts.force === true;
  const roots = {
    projectRoot: opts.projectRoot,
    homeDir: opts.homeDir ?? homedir(),
  };
  const invocation = await resolveCodemapCliInvocation({
    projectRoot: opts.projectRoot,
  });
  console.log(
    `  MCP CLI: ${formatCodemapExec(invocation)} (${invocation.installMethod})`,
  );

  for (const id of targets) {
    const def = getAgentsInitMcpTargetDef(id);
    const entry = buildMcpServerEntryForDef(def, invocation);
    const path = resolveMcpConfigPath(def, roots);

    if (def.format === "vscode-servers") {
      upsertVsCodeMcpFile({
        path,
        label: def.label,
        entry,
      });
    } else {
      upsertMcpServersFile({
        path,
        label: def.label,
        entry,
      });
    }

    if (id === "claude-code") {
      upsertClaudeSettingsPermissions({
        projectRoot: opts.projectRoot,
        force,
      });
    }

    if (def.postWriteNote !== undefined) {
      console.log(`  Note: ${def.postWriteNote}`);
    }
  }
}
