# Reference — evidence artifact schema

The `upgrade-packages` skill runs `bun run upgrade-packages:evidence` (writes `scripts/upgrade-packages/artifact.json`) and reads the JSON artifact below. The agent never touches the registry, GitHub, or GHSA directly — every citation comes from artifact fields. The script requires network access (`gh api` + `bun pm view`); release/advisory data is cached to `scripts/upgrade-packages/.cache/` (1h TTL).

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
    "coupledWith": []  // naive; agent confirms peer/dep coupling from deltas
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
      "version", "date",
      "breaking": [...], "deprecations": [...], "features": [...],
      "security": [...], "peerEngine": [...],  // best-effort regex hints — read releaseNotes for the authoritative text
      "releaseNotes": "truncated body",
      "diffUrl": "github.com/<o>/<r>/compare/<prevTag>...<tag>",
      "changelogUrl": "github.com/<o>/<r>/releases/tag/<tag>",
      "source": "github-release|none",
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

- **Verdict a package**: read `outdated[].bumpClass` + `audit.ghsa[].verdict` + `deltas[<pkg>][].breaking`/`security` + `usage[<pkg>].importedSymbols`. Cite `diffUrl` or `changelogUrl` for every claim.
- **`features`/`breaking` arrays are hints** — when a hint is empty but the delta is minor/major, read `releaseNotes` before concluding "no changes".
- **`error` on a delta** means the script couldn't fetch that version's release notes — usually a gh secondary rate-limit during a large multi-repo run, or a monorepo squashed release. `changelogUrl` is still provided (the repo's releases page) — **deep-dive it per-package** when `releaseNotes` is null. Only mark the bump **blocked** if the deep-dive still can't cover the range.
- **`cleared-at-current`** = the GHSA advisory's fix already ships at the installed version — no bump needed, record the URL as evidence.
- **Citations are artifact fields** — `diffUrl`, `changelogUrl`, `url`. Do not invent URLs.
