import { defineMeta } from "blume";

export default defineMeta({
  title: "API",
  icon: "code",
  // TypeDoc single entry (`src/index.ts`) → `modules.mdx` (see typedoc.json entryFileName).
  pages: ["modules"],
});
