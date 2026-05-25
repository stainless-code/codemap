import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface WatchPolicyProbe {
  isWsl?: () => boolean;
  readProcVersion?: () => string | undefined;
}

/** Default-ON watcher unless env opts out (mirrors pre-policy CLI behavior). */
export function envWatchDefaultOn(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env["CODEMAP_NO_WATCH"] === "1") return false;
  const watch = env["CODEMAP_WATCH"];
  if (watch === "0" || watch === "false") return false;
  return true;
}

export function detectWsl(probe?: WatchPolicyProbe): boolean {
  if (probe?.isWsl !== undefined) return probe.isWsl();
  if (process.env["WSL_DISTRO_NAME"] !== undefined) return true;
  try {
    const version =
      probe?.readProcVersion?.() ??
      readFileSync("/proc/version", "utf8").toString();
    return /microsoft|WSL/i.test(version);
  } catch {
    return false;
  }
}

/** True when `root` lives on a WSL2 Windows drive mount (`/mnt/<letter>/...`). */
export function isWindowsDriveMount(root: string): boolean {
  const normalized = resolve(root).replace(/\\/g, "/");
  return /^\/mnt\/[a-zA-Z](?:\/|$)/.test(normalized);
}

/**
 * When non-null, the file watcher should not start for `root`.
 * Precedence: `CODEMAP_FORCE_WATCH=1` → allow; explicit off env → disable;
 * WSL `/mnt/*` → disable unless forced.
 */
export function watchDisabledReason(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  probe?: WatchPolicyProbe,
): string | null {
  if (env["CODEMAP_FORCE_WATCH"] === "1") return null;
  if (env["CODEMAP_WATCH"] === "1" || env["CODEMAP_WATCH"] === "true") {
    return null;
  }
  if (env["CODEMAP_NO_WATCH"] === "1") {
    return "CODEMAP_NO_WATCH=1";
  }
  if (env["CODEMAP_WATCH"] === "0" || env["CODEMAP_WATCH"] === "false") {
    return "CODEMAP_WATCH=0";
  }
  if (detectWsl(probe) && isWindowsDriveMount(root)) {
    return "WSL2 Windows drive mount (/mnt/*): file watcher unreliable on this path";
  }
  return null;
}

export function logWatchDisabled(label: string, reason: string): void {
  // eslint-disable-next-line no-console -- intentional bootstrap log on stderr
  console.error(`${label}: watcher disabled — ${reason}.`);
  // eslint-disable-next-line no-console -- intentional bootstrap log on stderr
  console.error(
    `${label}: set CODEMAP_FORCE_WATCH=1 to override, or run \`codemap agents init --git-hooks\` for background sync on git events.`,
  );
}

/** Apply policy after CLI/env resolved the requested watch flag. Logs once when disabled. */
export function applyWatchPolicy(opts: {
  root: string;
  requestedWatch: boolean;
  label: string;
  env?: NodeJS.ProcessEnv;
  probe?: WatchPolicyProbe;
}): { watch: boolean } {
  if (!opts.requestedWatch) return { watch: false };
  const reason = watchDisabledReason(
    opts.root,
    opts.env ?? process.env,
    opts.probe,
  );
  if (reason === null) return { watch: true };
  logWatchDisabled(opts.label, reason);
  return { watch: false };
}
