import { printQueryResult } from "../application/index-engine";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";

export async function runQueryCmd(opts: {
  root: string;
  configFile: string | undefined;
  sql: string;
}): Promise<void> {
  const user = await loadUserConfig(opts.root, opts.configFile);
  initCodemap(resolveCodemapConfig(opts.root, user));
  configureResolver(getProjectRoot(), getTsconfigPath());
  printQueryResult(opts.sql);
}
