import { runAgentsInit } from "../agents-init";

export async function runAgentsInitCmd(opts: {
  projectRoot: string;
  force: boolean;
  interactive: boolean;
}): Promise<boolean> {
  if (opts.interactive) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error(
        "codemap: --interactive requires an interactive terminal (TTY).",
      );
      process.exit(1);
    }
    const { runAgentsInitInteractive } =
      await import("../agents-init-interactive.js");
    return runAgentsInitInteractive(opts);
  }
  return runAgentsInit(opts);
}
