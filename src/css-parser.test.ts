import { describe, expect, it } from "bun:test";

import { extractCssData } from "./css-parser";

describe("extractCssData importSources", () => {
  it("collects quoted and unquoted url() imports", () => {
    const data = extractCssData(
      "/proj/styles.css",
      '@import "./a.css";\n@import url(./theme.css);\n',
      "styles.css",
    );
    expect(data.importSources).toContain("./a.css");
    expect(data.importSources).toContain("./theme.css");
  });
});
