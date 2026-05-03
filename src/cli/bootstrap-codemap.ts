import { loadUserConfig, resolveCodemapConfig } from "../config";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";

/**
 * Per-command bootstrap: load user config, init runtime singletons,
 * configure the resolver. Single attachment point for the self-healing
 * reconcilers added in Tracer 4 (`ensureStateDir` will fan out from here).
 */
export interface BootstrapCodemapOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
}

export async function bootstrapCodemap(
  opts: BootstrapCodemapOpts,
): Promise<void> {
  const user = await loadUserConfig(opts.root, opts.configFile, {
    stateDir: opts.stateDir,
  });
  initCodemap(
    resolveCodemapConfig(opts.root, user, { stateDir: opts.stateDir }),
  );
  configureResolver(getProjectRoot(), getTsconfigPath());
}
