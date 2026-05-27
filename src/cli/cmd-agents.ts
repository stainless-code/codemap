import { runAgentsInit } from "../agents-init";

function reportAgentsInitError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  console.error(
    message.startsWith("Codemap:") ? message : `Codemap: ${message}`,
  );
  return false;
}

export async function runAgentsInitCmd(opts: {
  projectRoot: string;
  force: boolean;
  interactive: boolean;
  gitHooks?: "install" | "uninstall";
  mcp?: boolean;
}): Promise<boolean> {
  try {
    if (opts.interactive) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error(
          "codemap: --interactive requires an interactive terminal (TTY).",
        );
        process.exit(1);
      }
      const { runAgentsInitInteractive } =
        await import("../agents-init-interactive.js");
      return await runAgentsInitInteractive(opts);
    }
    return await runAgentsInit({
      projectRoot: opts.projectRoot,
      force: opts.force,
      gitHooks: opts.gitHooks,
      mcp: opts.mcp,
    });
  } catch (err) {
    return reportAgentsInitError(err);
  }
}
