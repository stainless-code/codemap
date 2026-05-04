import { ensureStateConfig } from "../application/state-config";
import {
  ensureStateGitignore,
  resolveStateDir,
} from "../application/state-dir";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import { configureResolver } from "../resolver";
import {
  getProjectRoot,
  getStateDir,
  getTsconfigPath,
  initCodemap,
} from "../runtime";

/**
 * Per-command bootstrap: resolve the state-dir, run the self-healing
 * reconcilers (D11), load user config, init runtime singletons, configure
 * the resolver. Adding a new self-healing file is a one-line addition
 * after `ensureStateConfig` below.
 */
export interface BootstrapCodemapOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  /** CLI `--with-fts`; `undefined` defers to `codemap.config.ts` `fts5`. */
  fts5Cli?: boolean | undefined;
}

export async function bootstrapCodemap(
  opts: BootstrapCodemapOpts,
): Promise<void> {
  // Reconcile state-dir BEFORE config load so a freshly-created
  // <state-dir>/config.json from `ensureStateConfig` doesn't miss a
  // first-run consumer's read. State-dir is resolved upfront via the
  // same precedence config will use.
  const stateDir = resolveStateDir({ root: opts.root, cliFlag: opts.stateDir });
  ensureStateGitignore(stateDir);
  ensureStateConfig(stateDir);

  const user = await loadUserConfig(opts.root, opts.configFile, { stateDir });
  initCodemap(
    resolveCodemapConfig(opts.root, user, { stateDir, fts5Cli: opts.fts5Cli }),
  );
  configureResolver(getProjectRoot(), getTsconfigPath());
  // Sanity: getStateDir() must mirror what we passed into resolveCodemapConfig.
  if (getStateDir() !== stateDir) {
    throw new Error(
      `bootstrap: state-dir mismatch (resolved ${stateDir}, runtime got ${getStateDir()})`,
    );
  }
}
