#!/usr/bin/env bun
import { parseAgentLogFile } from "./parse-agent-log";

const path = process.argv[2];
if (path === undefined) {
  console.error(
    "Usage: bun scripts/agent-eval/print-log-metrics.ts <log-file>",
  );
  process.exit(1);
}

const parsed = parseAgentLogFile(path);
console.log(JSON.stringify(parsed, null, 2));
