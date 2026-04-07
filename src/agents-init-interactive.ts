import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  select,
} from "@clack/prompts";

import type { AgentsInitLinkMode, AgentsInitTarget } from "./agents-init";
import { runAgentsInit, targetsNeedLinkMode } from "./agents-init";

export interface RunAgentsInitInteractiveOptions {
  projectRoot: string;
  force: boolean;
}

const INTEGRATION_OPTIONS: {
  value: AgentsInitTarget;
  label: string;
  hint: string;
}[] = [
  {
    value: "cursor",
    label: "Cursor",
    hint: ".cursor/rules + skills → .agents/",
  },
  {
    value: "claude-md",
    label: "Claude Code",
    hint: "CLAUDE.md",
  },
  {
    value: "copilot",
    label: "GitHub Copilot",
    hint: ".github/copilot-instructions.md",
  },
  {
    value: "windsurf",
    label: "Windsurf (Cascade)",
    hint: ".windsurf/rules → .agents/rules",
  },
  {
    value: "continue",
    label: "Continue",
    hint: ".continue/rules → .agents/rules",
  },
  {
    value: "cline",
    label: "Cline",
    hint: ".clinerules → .agents/rules",
  },
  {
    value: "amazon-q",
    label: "Amazon Q Developer",
    hint: ".amazonq/rules → .agents/rules",
  },
  {
    value: "agents-md",
    label: "AGENTS.md (Zed, JetBrains, Aider, …)",
    hint: "Root AGENTS.md",
  },
  {
    value: "gemini-md",
    label: "Gemini",
    hint: "GEMINI.md",
  },
];

function summarizeTargets(targets: AgentsInitTarget[]): string[] {
  const lines: string[] = [];
  for (const t of targets) {
    const opt = INTEGRATION_OPTIONS.find((o) => o.value === t);
    lines.push(opt ? `${opt.label}: ${opt.hint}` : t);
  }
  return lines;
}

/**
 * Interactive `codemap agents init`: choose integrations and symlink vs copy for rule mirrors.
 */
export async function runAgentsInitInteractive(
  opts: RunAgentsInitInteractiveOptions,
): Promise<boolean> {
  intro("codemap agents init");
  note(
    "Canonical templates always install to .agents/ (rules + skills).\nOptional steps wire other tools to the same content.",
    "Codemap",
  );

  const targetsRaw = await multiselect<AgentsInitTarget>({
    message: "Integrations (space to toggle, enter to confirm)",
    options: INTEGRATION_OPTIONS,
    required: false,
    initialValues: [],
  });

  if (isCancel(targetsRaw)) {
    cancel("Cancelled.");
    return false;
  }

  const targets = targetsRaw as AgentsInitTarget[];

  let linkMode: AgentsInitLinkMode = "symlink";
  if (targetsNeedLinkMode(targets)) {
    const mode = await select<AgentsInitLinkMode>({
      message:
        "How should tools that mirror .agents/rules (and Cursor skills) link?",
      options: [
        {
          value: "symlink",
          label: "Symlink",
          hint: "One source of truth; best on macOS / Linux",
        },
        {
          value: "copy",
          label: "Copy",
          hint: "Duplicate files; safest on Windows / sandboxes",
        },
      ],
      initialValue: "symlink",
    });
    if (isCancel(mode)) {
      cancel("Cancelled.");
      return false;
    }
    linkMode = mode;
  }

  const lines = [
    `Project: ${opts.projectRoot}`,
    "Will write: .agents/rules, .agents/skills",
    ...summarizeTargets(targets).map((l) => `• ${l}`),
  ];

  note(lines.join("\n"), "Summary");

  const ok = await confirm({
    message: "Proceed?",
    initialValue: true,
  });

  if (isCancel(ok) || !ok) {
    cancel("Cancelled.");
    return false;
  }

  const success = runAgentsInit({
    projectRoot: opts.projectRoot,
    force: opts.force,
    targets,
    linkMode,
  });

  if (success) {
    outro(
      "Done. Edit .agents/ for your team; restart IDEs if rules did not reload.",
    );
  }
  return success;
}
