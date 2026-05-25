import { IndexLockHeldError, removeIndexLock } from "../application/index-lock";
import { resolveStateDir } from "../application/state-dir";

export function printUnlockCmdHelp(): void {
  console.log(`Usage: codemap unlock [--force]

Remove a stale cross-process index lock (<state-dir>/index.lock).

Flags:
  --force    Remove the lock even when the holder PID is still alive
  --help, -h Show this help

When indexing fails with "Index already running", another codemap process
(MCP, watch, git hook, or CLI) may hold the lock. If that process died,
run \`codemap unlock\`. See <state-dir>/errors.log for per-file parse failures.
`);
}

export function parseUnlockRest(
  rest: string[],
):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; force: boolean } {
  if (rest[0] !== "unlock") {
    throw new Error("parseUnlockRest: expected unlock");
  }
  let force = false;
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--force") {
      force = true;
      continue;
    }
    return {
      kind: "error",
      message: `codemap: unknown option "${a}". Run codemap unlock --help for usage.`,
    };
  }
  return { kind: "run", force };
}

export async function runUnlockCmd(opts: {
  root: string;
  stateDir?: string | undefined;
  force: boolean;
}): Promise<void> {
  const stateDir = resolveStateDir({
    root: opts.root,
    cliFlag: opts.stateDir,
    env: process.env.CODEMAP_STATE_DIR,
  });
  try {
    const removed = removeIndexLock(stateDir, { force: opts.force });
    if (removed) {
      console.error("Index lock removed.");
    } else {
      console.error("No index lock present.");
    }
  } catch (err) {
    if (err instanceof IndexLockHeldError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
