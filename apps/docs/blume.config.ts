import { defineConfig } from "blume";

import { CURATED_POPULAR } from "./components/curated-popular";

const title = "Codemap";
/** Custom `.astro` pages have no frontmatter — name OG cards (else humanized segment). */
const homeTitle = `${title} — Query your codebase.`;
const notFoundTitle = "Page not found";
/** Capacity pitch — do not lead with the brand one-liner (docs-voice). */
const description =
  "Local codebase intelligence for AI agents — a SQLite index of symbols, imports, and calls. SQL and recipes instead of scanning the tree.";

export default defineConfig({
  title,
  description,

  logo: { image: "/logo.svg", text: "Codemap" },

  github: {
    owner: "stainless-code",
    repo: "codemap",
    branch: "main",
    dir: "apps/docs",
  },

  lastModified: true,

  content: {
    sources: [
      { type: "filesystem", root: "content" },
      {
        type: "github-releases",
        prefix: "changelog",
        owner: "stainless-code",
        repo: "codemap",
        limit: 100,
      },
    ],
  },

  navigation: {
    tabs: [
      { label: "Guides", path: "/guides", icon: "book-open" },
      { label: "Recipes", path: "/recipes", icon: "flask-conical" },
      { label: "Concepts", path: "/concepts", icon: "lightbulb" },
      { label: "Reference", path: "/reference", icon: "code" },
    ],
    featured: [
      { label: "Changelog", href: "/changelog", icon: "sparkles" },
      {
        label: "GitHub",
        href: "https://github.com/stainless-code/codemap",
        icon: "github",
      },
    ],
    sidebar: { display: "flat" },
  },

  // Accent + zinc backgrounds; full token map in theme.css.
  theme: {
    accent: { light: "#1d4ed8", dark: "#60a5fa" },
    background: { light: "#fafafa", dark: "#18181b" },
    radius: "sm",
    mode: "system",
    fonts: {
      display: "inter-tight",
      body: "inter",
      mono: "geist-mono",
    },
  },
  search: {
    provider: "orama",
    // Cmd+K empty-state + shared with 404 via CURATED_POPULAR.
    popular: CURATED_POPULAR.map(({ route, label }) => ({
      href: route,
      label,
    })),
  },

  markdown: {
    code: { icons: true },
    codeBlocks: { theme: { light: "github-light", dark: "github-dark" } },
  },

  toc: { minHeadingLevel: 2, maxHeadingLevel: 3 },

  export: { epub: true, pdf: true },

  ai: {
    llmsTxt: true,
  },

  seo: {
    og: {
      enabled: true,
      titles: { "/": homeTitle, "/404": notFoundTitle },
    },
    rss: { enabled: true, types: ["changelog"] },
    sitemap: true,
    robots: true,
    structuredData: true,
    agentReadability: true,
  },

  deployment: {
    output: "static",
    site: "https://stainless-code.com",
    base: "/codemap",
  },
});
