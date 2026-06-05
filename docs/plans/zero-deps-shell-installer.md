# Zero-deps shell installer — plan

> **Status:** open · **Priority:** P3 · **Effort:** L (~3–4 weeks)
>
> **Motivator:** npm install requires a JS toolchain and pulls native addons (`better-sqlite3`, `oxc-parser`, `lightningcss`, `oxc-resolver`). Consumers without Node/Bun — or agents in minimal sandboxes — need **`curl | sh`** (and PowerShell) install paths that fetch a **prebuilt per-platform binary** (or a self-contained archive) and place `codemap` on `PATH`. Distribution complement to npm, not a replacement.
>
> **Roadmap:** [§ Distribution & evaluation depth](../roadmap.md#distribution--evaluation-depth) · see also [packaging.md](../packaging.md)

---

## Agent start here

Spike **one platform** (linux-x64) end-to-end before multi-arch matrix: build artifact → upload to GitHub Release → `install.sh` curl-fetch + checksum verify → `codemap --version`. Native NAPI deps are the hard part — read [packaging.md § Node vs Bun](../packaging.md#node-vs-bun) and [§ Build & publish](../packaging.md#build--publish-surface).

### Key touchpoints

| File                                                                                                        | What to read                                    |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [`package.json`](../../package.json)                                                                        | `bin`, `engines`, native deps                   |
| [`docs/packaging.md`](../packaging.md)                                                                      | tsdown build; no `bun compile` today            |
| [`tsdown.config.ts`](../../tsdown.config.ts)                                                                | Bundle entry / chunks                           |
| [`.github/workflows/release.yml`](../../.github/workflows/release.yml)                                      | Changesets publish — attach binaries here       |
| [`src/db.ts`](../../src/db.ts)                                                                              | Runtime split: `bun:sqlite` vs `better-sqlite3` |
| [`scripts/detect-pm.mjs`](../../scripts/detect-pm.mjs)                                                      | PM detection precedent for install scripts      |
| [`action.yml`](../../action.yml)                                                                            | Today's npm/dlx install path on CI runners      |
| [`src/sqlite-db.ts`](../../src/sqlite-db.ts) / [`src/parse-worker-node.ts`](../../src/parse-worker-node.ts) | Node runtime paths the archive must satisfy     |

### Architecture

```text
release CI (tag vX.Y.Z)
  → build per-target archive (binary + bundled native .node assets OR standalone compile)
  → GitHub Release assets + SHA256SUMS
install.sh / install.ps1
  → detect OS/ARCH → curl asset → verify checksum → install to ~/.local/bin or /usr/local/bin
consumer
  → codemap on PATH (no npm required)
```

### Tracer bullet (slice 1)

Linux x64 tarball + `install.sh` + manual release asset on one tag; document checksum verify. macOS arm64 + Windows in slice 2. PowerShell installer in slice 3.

### Out of scope (v1)

Bundled full Node/Bun runtime in every archive (optional follow-up); `apt`/`brew` formulas; auto-update daemon; shipping `templates/` outside npm path (installer must still expose recipes — bundle `templates/` beside binary or document npm fallback).

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                                                                | Source                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Z.1 | **Complement npm** — installer is an alternate distribution channel; `@stainless-code/codemap` remains canonical for JS projects.                                                                                                                       | [packaging.md](../packaging.md)                                      |
| Z.2 | **No telemetry** — install script does not phone home; checksum verify only.                                                                                                                                                                            | [Floor "No telemetry upload"](../roadmap.md#floors-v1-product-shape) |
| Z.3 | **GitHub Releases host assets** — same repo as source; version aligned with npm semver from Changesets (or explicit `CODEMAP_VERSION` pin in script).                                                                                                   | Existing release workflow                                            |
| Z.4 | **Checksum gate** — `install.sh` refuses install without matching SHA256 from `SHA256SUMS` (or embedded per-asset hash).                                                                                                                                | Supply-chain hygiene                                                 |
| Z.5 | **Node runtime inside binary path** — v1 targets a **Node-based** standalone layout (compiled launcher or `node dist/index.mjs` shim + vendored native modules), not a second Bun-only distro unless Bun compile proves simpler for one platform spike. | [packaging.md § Node vs Bun](../packaging.md#node-vs-bun)            |
| Z.6 | **Templates ship with binary** — `templates/` (recipes + agent-content paths the CLI expects) included in release archive; parity with npm `files` surface.                                                                                             | `package.json` `files`                                               |

---

## Target matrix (v1)

| OS      | Arch  | Artifact name (sketch)                    |
| ------- | ----- | ----------------------------------------- |
| linux   | x64   | `codemap-linux-x64.tar.gz`                |
| linux   | arm64 | slice 2                                   |
| darwin  | arm64 | slice 2                                   |
| darwin  | x64   | defer unless demand                       |
| windows | x64   | `codemap-windows-x64.zip` + `install.ps1` |

---

## Implementation steps

1. **Build spike** — one linux-x64 archive containing `codemap` launcher, `dist/`, `templates/`, native `.node` bindings for Node LTS.
2. **`scripts/install.sh`** — `OS`/`ARCH` detect, `curl -fsSL`, checksum, `install -m 755`, `PATH` hint.
3. **`scripts/install.ps1`** — Windows equivalent.
4. **Release workflow extension** — matrix build job on tag; upload assets + `SHA256SUMS`.
5. **Root `README.md`** — curl one-liner (consumer surface; no implementation paths).
6. **Smoke test** — fresh container runs `curl | sh` then `codemap --version` + `codemap query --recipe files-hashes --json` on a tiny fixture.
7. **Docs** — `packaging.md` § Shell installer; `architecture.md` one line under Distribution if warranted.

---

### Verification

```bash
# Local archive smoke (before CI matrix)
tar -xzf codemap-linux-x64.tar.gz -C /tmp/codemap-test
/tmp/codemap-test/codemap --version
/tmp/codemap-test/codemap query --recipe files-hashes --json --root <tiny-fixture>

# Install script
curl -fsSL ./scripts/install.sh | CODEMAP_INSTALL_DIR=~/.local sh
codemap --version

# Release workflow dry-run on fork (tag push triggers asset build)
```

Use a clean Linux x64 container (or `docker run`) for end-to-end `curl | sh` — host dev machine may mask missing native `.node` deps.

---

## Acceptance

- [ ] `curl -fsSL …/install.sh | sh` on linux-x64 installs working `codemap`
- [ ] Checksum mismatch aborts with clear error
- [ ] Installed binary runs index + query without prior `npm i`
- [ ] `templates/recipes/` available to installed binary
- [ ] Version string matches release tag / npm version for same commit

---

## Open decisions (impl PR)

| #   | Question                                                                                    |
| --- | ------------------------------------------------------------------------------------------- |
| Q1  | `bun build --compile` single binary vs tarball + `node` shim + vendored natives?            |
| Q2  | Install prefix default: `~/.local/bin` vs `/usr/local/bin` (sudo) vs `CODEMAP_INSTALL_DIR`? |
| Q3  | Pin Node major in archive (20 vs 22) — match `package.json` `engines` exactly?              |
| Q4  | Optional `--runtime=bundled` that ships embedded Node runtime — v1 or v2?                   |

---

## Dependencies

- Shipped: tsdown build, Changesets release workflow, native addon prebuilds via npm
- Independent of [github-marketplace-action](./github-marketplace-action.md) (Action uses npm install on runner today)
- Synergy: Marketplace Action could later offer `install-method: curl|npm` input (defer)
