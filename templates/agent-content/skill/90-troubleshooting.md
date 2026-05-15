## Troubleshooting

| Problem                    | Solution                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Stale results after rebase | Run **`codemap --full`** (see **`npx @stainless-code/codemap`** / **`pnpm dlx`** / … above if needed)                   |
| Missing file in results    | Check exclude / include globs in **`.codemap/config.ts`**, **`.codemap/config.json`**, or **`codemap --help`** defaults |
| `resolved_path` is NULL    | Import is an external package (not in project)                                                                          |
| Symbol not found           | File may be excluded; verify with **`SELECT path FROM files WHERE path LIKE '%name%'`**                                 |
