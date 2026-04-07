import {
  globFilesFiltered,
  readAll,
  traditionalFanoutImportLines,
} from "./benchmark-common";
import { getQueryRecipeSql } from "./cli/query-recipes";
import type { CodemapDatabase } from "./db";
import { getProjectRoot } from "./runtime";

export interface Scenario {
  name: string;
  indexed: () => unknown[];
  traditional: () => {
    results: unknown[];
    filesRead: number;
    bytesRead: number;
  };
}

export function getDefaultScenarios(db: CodemapDatabase): Scenario[] {
  return [
    {
      name: "Find where 'usePermissions' is defined",
      indexed: () =>
        db
          .query(
            `SELECT file_path, line_start, line_end, signature
           FROM symbols WHERE name = 'usePermissions' AND kind IN ('function', 'variable')`,
          )
          .all(),
      traditional: () => {
        const files = globFilesFiltered(["**/*.{ts,tsx}"], getProjectRoot());
        const { totalBytes, contents } = readAll(files, getProjectRoot());
        const re = /export\s+(?:function|const)\s+usePermissions/;
        const results = [];
        for (const [path, content] of contents) {
          if (re.test(content)) results.push({ file_path: path });
        }
        return { results, filesRead: files.length, bytesRead: totalBytes };
      },
    },

    {
      name: "List React components (TSX/JSX)",
      indexed: () =>
        db.query(`SELECT name, file_path FROM components ORDER BY name`).all(),
      traditional: () => {
        const files = globFilesFiltered(["**/*.{tsx,jsx}"], getProjectRoot());
        const { totalBytes, contents } = readAll(files, getProjectRoot());
        const re = /export\s+(?:default\s+)?(?:function|const)\s+([A-Z]\w*)/g;
        const results = [];
        for (const [path, content] of contents) {
          let m;
          while ((m = re.exec(content)) !== null) {
            results.push({ file_path: path, name: m[1] });
          }
        }
        return { results, filesRead: files.length, bytesRead: totalBytes };
      },
    },

    {
      name: "Files that import from ~/api/client",
      indexed: () =>
        db
          .query(
            `SELECT file_path FROM imports
           WHERE source LIKE '~/api/client%'
           GROUP BY file_path`,
          )
          .all(),
      traditional: () => {
        const files = globFilesFiltered(["**/*.{ts,tsx}"], getProjectRoot());
        const { totalBytes, contents } = readAll(files, getProjectRoot());
        const re = /from\s+['"]~\/api\/client/;
        const results = [];
        for (const [path, content] of contents) {
          if (re.test(content)) results.push({ file_path: path });
        }
        return { results, filesRead: files.length, bytesRead: totalBytes };
      },
    },

    {
      name: "Find all TODO/FIXME markers",
      indexed: () =>
        db
          .query(`SELECT file_path, line_number, content, kind FROM markers`)
          .all(),
      traditional: () => {
        const files = globFilesFiltered(
          ["**/*.{ts,tsx,css,md}"],
          getProjectRoot(),
        );
        const { totalBytes, contents } = readAll(files, getProjectRoot());
        const re = /\b(TODO|FIXME|HACK|NOTE)[\s:]+(.+)/g;
        const results = [];
        for (const [path, content] of contents) {
          let m;
          while ((m = re.exec(content)) !== null) {
            results.push({ file_path: path, kind: m[1], text: m[2]?.trim() });
          }
        }
        return { results, filesRead: files.length, bytesRead: totalBytes };
      },
    },

    {
      name: "CSS design tokens (custom properties)",
      indexed: () =>
        db
          .query(
            `SELECT name, value, scope, file_path FROM css_variables ORDER BY name LIMIT 50`,
          )
          .all(),
      traditional: () => {
        const files = globFilesFiltered(["**/*.css"], getProjectRoot());
        const { totalBytes, contents } = readAll(files, getProjectRoot());
        const re = /(--[\w-]+)\s*:\s*([^;]+)/g;
        const results = [];
        for (const [path, content] of contents) {
          let m;
          while ((m = re.exec(content)) !== null) {
            results.push({ file_path: path, name: m[1], value: m[2]?.trim() });
          }
        }
        return { results, filesRead: files.length, bytesRead: totalBytes };
      },
    },

    {
      name: "Components in `shop/` subtree",
      indexed: () =>
        db
          .query(
            `SELECT name, file_path FROM components
           WHERE file_path LIKE '%/components/%shop%'
           ORDER BY name`,
          )
          .all(),
      traditional: () => {
        const files = globFilesFiltered(
          ["**/components/shop/**/*.tsx"],
          getProjectRoot(),
        );
        const { totalBytes, contents } = readAll(files, getProjectRoot());
        const re = /export\s+(?:default\s+)?(?:function|const)\s+(\w+)/g;
        const results = [];
        for (const [path, content] of contents) {
          let m;
          while ((m = re.exec(content)) !== null) {
            results.push({ file_path: path, name: m[1] });
          }
        }
        return { results, filesRead: files.length, bytesRead: totalBytes };
      },
    },

    {
      name: "Reverse deps: who imports utils/date?",
      indexed: () =>
        db
          .query(
            `SELECT from_path FROM dependencies
           WHERE to_path LIKE '%utils/date%'`,
          )
          .all(),
      traditional: () => {
        const files = globFilesFiltered(["**/*.{ts,tsx}"], getProjectRoot());
        const { totalBytes, contents } = readAll(files, getProjectRoot());
        const re = /from\s+['"].*utils\/date['"]/;
        const results = [];
        for (const [path, content] of contents) {
          if (re.test(content)) results.push({ file_path: path });
        }
        return { results, filesRead: files.length, bytesRead: totalBytes };
      },
    },

    {
      name: "Top 10 by dependency fan-out",
      indexed: () => {
        const sql = getQueryRecipeSql("fan-out");
        if (!sql) throw new Error("missing fan-out recipe");
        return db.query(sql).all();
      },
      traditional: traditionalFanoutImportLines,
    },
  ];
}
