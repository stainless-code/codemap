import { runAgentsInit } from "../agents-init";

export function runAgentsInitCmd(opts: {
  projectRoot: string;
  force: boolean;
}): boolean {
  return runAgentsInit(opts);
}
