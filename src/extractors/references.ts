/**
 * References extractor per [R.11]. Visits Identifier / JSXIdentifier /
 * TSTypeReference and emits one `ReferenceRow` per use.
 *
 * Write detection per [R.13]: parent-aware handlers (`AssignmentExpression`,
 * `UpdateExpression`, `UnaryExpression(delete)`, `VariableDeclarator` with
 * initializer, `ForOfStatement` / `ForInStatement`, `AssignmentPattern`)
 * pre-mark the LHS / target identifier's `node.start` in two sets:
 *
 * - `writePositions` — emits an additional `is_write=1` row at the same position.
 * - `suppressedReads` — skips the default `is_write=0` row.
 *
 * Simple `x = 1` → only the write row (read suppressed).
 * Compound `x += 1` / `x++` / `delete x` → both rows (per R.13).
 * Declaration `const x = 1` → only the write row (read suppressed —
 * declarations are in `symbols`, not duplicated in `references`).
 *
 * Scope id comes from `ctx.scopes.currentLocalId()` per [R.12]; the parser
 * walk is already inside the scope by the time identifier handlers fire
 * because `symbolsExtractor` registers first and pushes scope on enter.
 */

import { offsetToLine } from "./offsets";
import type { TierExtractor } from "./types";

export const referencesExtractor: TierExtractor = {
  tierId: "references",
  register(visitor, ctx) {
    const { references, relPath, lineMap, scopes } = ctx;
    const writePositions = new Set<number>();
    const suppressedReads = new Set<number>();
    // Dedup by node.start: shorthand `import {foo}` / `export {foo}` /
    // `{foo}` property share the same Identifier between imported/local,
    // exported/local, or key/value edges. The visitor traverses both,
    // hitting the same node twice. Tracking emitted starts per kind
    // avoids the duplicate without parent-shape awareness.
    const emittedRead = new Set<number>();
    const emittedWrite = new Set<number>();

    function pushRef(
      name: string,
      start: number,
      end: number,
      kind: "value" | "type" | "jsx",
      isWrite: number,
    ) {
      const seen = isWrite ? emittedWrite : emittedRead;
      if (seen.has(start)) return;
      seen.add(start);
      const lineStart = offsetToLine(lineMap, start);
      const lineStartOffset = lineMap[lineStart - 1] ?? 0;
      references.push({
        file_path: relPath,
        name,
        line_start: lineStart,
        column_start: start - lineStartOffset,
        column_end: end - lineStartOffset,
        kind,
        scope_local_id: scopes.currentLocalId(),
        is_write: isWrite,
      });
    }

    Object.assign(visitor, {
      // Pre-mark write targets BEFORE the Identifier handler fires on the
      // same node (the multiplexer chains in registration order; oxc walks
      // parents before children regardless).
      AssignmentExpression(node: any) {
        if (node.left?.type === "Identifier") {
          writePositions.add(node.left.start);
          if (node.operator === "=") {
            // Simple assignment: only the write row; suppress the read.
            suppressedReads.add(node.left.start);
          }
        }
      },
      UpdateExpression(node: any) {
        if (node.argument?.type === "Identifier") {
          writePositions.add(node.argument.start);
          // ++ / -- emits both read + write per R.13.
        }
      },
      UnaryExpression(node: any) {
        if (
          node.operator === "delete" &&
          node.argument?.type === "Identifier"
        ) {
          writePositions.add(node.argument.start);
        }
      },
      VariableDeclarator(node: any) {
        if (node.id?.type === "Identifier" && node.init) {
          writePositions.add(node.id.start);
          // Declaration: the identifier belongs in `symbols` not as a read
          // reference; suppress the read row.
          suppressedReads.add(node.id.start);
        }
      },
      ForOfStatement(node: any) {
        if (node.left?.type === "Identifier") {
          writePositions.add(node.left.start);
        }
      },
      ForInStatement(node: any) {
        if (node.left?.type === "Identifier") {
          writePositions.add(node.left.start);
        }
      },
      AssignmentPattern(node: any) {
        if (node.left?.type === "Identifier") {
          writePositions.add(node.left.start);
        }
      },
      // Declaration sites belong in `symbols` (via name_column_start/end
      // per Tier 1) — not duplicated as references. Suppress the Identifier
      // visit for the `.id` field of every declaration form.
      FunctionDeclaration(node: any) {
        if (node.id?.type === "Identifier") suppressedReads.add(node.id.start);
      },
      ClassDeclaration(node: any) {
        if (node.id?.type === "Identifier") suppressedReads.add(node.id.start);
      },
      TSInterfaceDeclaration(node: any) {
        if (node.id?.type === "Identifier") suppressedReads.add(node.id.start);
      },
      TSTypeAliasDeclaration(node: any) {
        if (node.id?.type === "Identifier") suppressedReads.add(node.id.start);
      },
      TSEnumDeclaration(node: any) {
        if (node.id?.type === "Identifier") suppressedReads.add(node.id.start);
      },
      TSModuleDeclaration(node: any) {
        if (node.id?.type === "Identifier") suppressedReads.add(node.id.start);
      },

      Identifier(node: any) {
        const name = node.name;
        if (typeof name !== "string" || name.length === 0) return;
        const start = node.start;
        const end = node.end;
        const isWriteFlag = writePositions.has(start);
        const suppressRead = suppressedReads.has(start);
        if (!suppressRead) {
          pushRef(name, start, end, "value", 0);
        }
        if (isWriteFlag) {
          pushRef(name, start, end, "value", 1);
        }
      },
      JSXIdentifier(node: any) {
        const name = node.name;
        if (typeof name !== "string" || name.length === 0) return;
        pushRef(name, node.start, node.end, "jsx", 0);
      },
      TSTypeReference(node: any) {
        const tn = node.typeName;
        if (tn?.type === "Identifier" && typeof tn.name === "string") {
          pushRef(tn.name, tn.start, tn.end, "type", 0);
        }
      },
    });
  },
};
