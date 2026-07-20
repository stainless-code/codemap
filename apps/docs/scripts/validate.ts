#!/usr/bin/env bun
/**
 * `blume validate` wrapper: drop BLUME_BROKEN_LINK on github-releases changelog
 * pages. Older release notes link to maintainer `docs/` paths that are not (and
 * must not be) mirrored as site pages — curated `/reference/roadmap` is the
 * public surface.
 *
 * Forwards all CLI args to `blume validate --json` (adds `--json` if missing).
 * Exit 1 when any non-filtered error remains; `--strict` still elevates warnings.
 */
import { spawnSync } from "node:child_process";

interface Diagnostic {
  code?: string;
  file?: string;
  message?: string;
  severity?: string;
}

interface ValidatePayload {
  diagnostics?: Diagnostic[];
}

const args = process.argv.slice(2);
if (!args.includes("--json")) {
  args.push("--json");
}

const result = spawnSync("blume", ["validate", ...args], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";
if (stderr) process.stderr.write(stderr);

let payload: ValidatePayload;
try {
  payload = JSON.parse(stdout) as ValidatePayload;
} catch {
  process.stdout.write(stdout);
  process.exit(result.status === 0 ? 0 : 1);
}

/** Changelog → maintainer `docs/` paths only (not broken public-site links). */
const isChangelogMaintainerLink = (d: Diagnostic): boolean =>
  d.code === "BLUME_BROKEN_LINK" &&
  typeof d.file === "string" &&
  d.file.startsWith("changelog:") &&
  typeof d.message === "string" &&
  /(?:^|[\s/`])\.\.\/docs\/|no page resolves to \/docs\//.test(d.message);

const kept = (payload.diagnostics ?? []).filter(
  (d) => !isChangelogMaintainerLink(d),
);
const filtered = (payload.diagnostics ?? []).length - kept.length;

const errors = kept.filter((d) => d.severity === "error").length;
const warnings = kept.filter((d) => d.severity === "warning").length;
const strict = args.includes("--strict");

process.stdout.write(
  `${JSON.stringify(
    {
      diagnostics: kept,
      summary: {
        error: errors,
        warning: warnings,
        info: kept.filter((d) => d.severity === "info").length,
        filtered_changelog_broken_links: filtered,
      },
    },
    null,
    2,
  )}\n`,
);

if (filtered > 0) {
  process.stderr.write(
    `[validate] filtered ${filtered} changelog→maintainer-docs broken link(s)\n`,
  );
}

process.exit(errors > 0 || (strict && warnings > 0) ? 1 : 0);
