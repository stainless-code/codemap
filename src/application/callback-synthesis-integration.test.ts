import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { createCodemap } from "../api";
import { installCodemapTestTeardown } from "../test-helpers/runtime-reset";

installCodemapTestTeardown();

const MINIMAL_ROOT = join(import.meta.dir, "../../fixtures/minimal");
const JSX_PATHS = [
  "src/bench/jsx-synthesis/PageShell.tsx",
  "src/bench/jsx-synthesis/ChildCard.tsx",
];

describe("callback synthesis integration (fixtures/minimal)", () => {
  it("indexes JSX parent→child heuristic edge when synthesis is on", async () => {
    const cm = await createCodemap({
      root: MINIMAL_ROOT,
      config: { synthesis: { heuristicCalls: true } },
    });
    await cm.index({ mode: "files", files: [...JSX_PATHS], quiet: true });
    const rows = (await cm.query(
      `SELECT file_path, caller_name, callee_name, provenance
       FROM calls WHERE provenance = 'heuristic'
         AND file_path = 'src/bench/jsx-synthesis/PageShell.tsx'
       ORDER BY callee_name`,
    )) as {
      file_path: string;
      caller_name: string;
      callee_name: string;
      provenance: string;
    }[];
    expect(rows.length).toBe(1);
    expect(rows[0]?.caller_name).toBe("PageShell");
    expect(rows[0]?.callee_name).toBe("ChildCard");
  });

  it("excludes heuristic rows from Moat-A call filter", async () => {
    const cm = await createCodemap({
      root: MINIMAL_ROOT,
      config: { synthesis: { heuristicCalls: true } },
    });
    await cm.index({ mode: "files", files: [...JSX_PATHS], quiet: true });
    const rows = (await cm.query(
      `SELECT COUNT(*) AS n FROM calls
       WHERE file_path = 'src/bench/jsx-synthesis/PageShell.tsx'
         AND caller_name = 'PageShell' AND callee_name = 'ChildCard'
         AND (provenance IS NULL OR provenance = 'ast')`,
    )) as { n: number }[];
    expect(rows[0]?.n).toBe(0);
  });
});
