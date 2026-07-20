/** Shared Cmd+K (`search.popular`) + 404 destinations — not sidebar order. */
export const CURATED_POPULAR = [
  { route: "/guides/getting-started", label: "Getting started" },
  { route: "/recipes", label: "Recipe catalog" },
  { route: "/guides/agents-mcp", label: "Agents & MCP" },
  { route: "/guides/apply", label: "Apply & rename" },
  { route: "/guides/audit-baselines", label: "Audit & baselines" },
  { route: "/concepts/why-codemap", label: "Why Codemap" },
  { route: "/reference/cli", label: "CLI reference" },
  {
    route: "/recipes/find-symbol-definitions",
    label: "find-symbol-definitions",
  },
  { route: "/guides/github-action", label: "GitHub Action" },
  { route: "/concepts/schema-overview", label: "Schema overview" },
] as const;
