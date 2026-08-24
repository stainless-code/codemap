# Reference — evidence artifact schema

The skill runs `bun run upgrade-packages:evidence` (default `--out scripts/upgrade-packages/artifact.json`). Phase 1 of [`SKILL.md`](./SKILL.md) owns network, cache TTLs, and the never-touch-registry rule.

Each outdated package gets **one** delta: the published tarball span `current → latest`. There is no per-tag GitHub release walk.

Cutter caps (`tarball-delta.ts`): `PATCH_PATH_CAP` 40 paths on the second `bun pm diff`, `FILE_LIST_CAP` 80 files in the artifact, `HINT_CAP` 8 hints per bucket, `PATCH_MAX_CHARS` 8000, `RELEASE_NOTES_MAX_CHARS` 1200. A missing `*.d.ts` patch means it lost the cap, not that the API is unchanged. `source: "none"` sets `tarball: null`.

## Artifact shape

```jsonc
{
  "generatedAt": "ISO timestamp",
  "inventory": {
    "direct": [{ "name", "version", "range": "exact|caret|tilde", "dev" }],
    "transitiveDuplicates": [{ "pkg", "versions": [...] }]  // direct-dep conflicts + semver-major splits only
  },
  "outdated": [{
    "pkg", "current", "latest",
    "bumpClass": "patch|minor|major|prerelease|no-op",
    "coupledWith": [],  // naive; agent confirms peer/dep coupling from deltas
    "dev"
  }],
  "audit": {
    "bunAudit": <raw bun audit --json payload>,
    "ghsa": [{ "pkg", "advisories": [{
      "id", "cveId", "severity",
      "vulnerableRange", "fixedIn",
      "installedInRange": bool,       // script-computed vs installed version
      "verdict": "priority-bump|needs-higher-target|cleared-at-current|unpatched|check-failed",
      "url",                         // github.com/advisories/<id>; empty + id:"error" on check-failed
      "error"                        // optional — message on check-failed (gh/parse/cache failure)
    }] }]
  },
  "deltas": {
    "<pkg>": [{
      "version", "date",             // target; date from changelog hunk if present
      "breaking": [...], "deprecations": [...], "features": [...],
      "security": [...], "peerEngine": [...],  // notes + changelog/package.json hints
      "releaseNotes": "changelog added-lines, truncated",
      "changelogUrl": "npmjs.com/package/<pkg>/v/<target>",
      "tarball": {
        "from", "to",
        "notes": [...],              // bun summary: engines, deps, install scripts, dangerous imports
        "totals": { "files", "added", "deleted", "linesAdded", "linesRemoved", "formattingOnly" },
        "files": [{ "path", "status", "linesAdded", "linesRemoved", "formattingOnly", "patch" }]
        // patch only for paths that won PATCH_PATH_CAP (named keep + symbol-boosted .d.ts + extras)
      },
      "source": "bun-pm-diff|none",
      "error": null | "reason"
    }]
  },
  "usage": {
    "<pkg>": {
      "importedSymbols": [...], "typeOnlySymbols": [...],  // parsed imports (codemap) — type-only included
      "sites": ["file:line", ...],                         // import locations
      "callSites": ["file:line", ...],                     // reference locations (codemap only — blast radius)
      "source": "codemap|grep"                             // grep = fallback when codemap unavailable
    }
  }
}
```

## How to read it

- **Verdict a package**: read `outdated[].bumpClass` + `audit.ghsa[].verdict` + `tarball.notes` + `deltas[<pkg>][].breaking`/`security` + `usage[<pkg>].importedSymbols`. Cite `tarball.notes`, a kept `patch`, `changelogUrl`, or advisory `url`.
- **`features`/`breaking` arrays are hints** — when a hint is empty but the delta is minor/major, read `releaseNotes` and kept patches before concluding "no changes".
- **`error` on a delta** means `bun pm diff` failed for that span. `changelogUrl` is still the npm version page. Re-run evidence before marking **blocked**.
- **`cleared-at-current`** = the GHSA advisory's fix already ships at the installed version — no bump needed, record the URL as evidence.
- **Citations are artifact fields** — `tarball.notes`, kept `tarball.files[].patch`, `changelogUrl`, `url`. Do not invent GitHub compare URLs.
