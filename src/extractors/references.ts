/**
 * References extractor per [R.11] + [R.13]. Parent-aware handlers pre-mark
 * write targets in `writePositions` (dual-emit) / `suppressedReads`
 * (read-skip); the Identifier handler emits accordingly. Worked examples
 * in `templates/recipes/find-references.md`.
 */

import { offsetToLine } from "./offsets";
import type { TierExtractor } from "./types";

export const referencesExtractor: TierExtractor = {
  tierId: "references",
  register(visitor, ctx) {
    const { references, relPath, lineMap, scopes } = ctx;
    const writePositions = new Set<number>();
    const suppressedReads = new Set<number>();
    // Dedup: shorthand `import {foo}` / `export {foo}` / `{foo}` property
    // share the same Identifier between imported/local, exported/local,
    // or key/value edges — oxc visits both, hitting the node twice.
    const emittedRead = new Set<number>();
    const emittedWrite = new Set<number>();

    function pushRef(
      name: string,
      start: number,
      end: number,
      kind: "value" | "type" | "jsx" | "member",
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
      // oxc walks parents before children — pre-marks land before the
      // Identifier handler fires on the same node.
      AssignmentExpression(node: any) {
        if (node.left?.type === "Identifier") {
          writePositions.add(node.left.start);
          // Simple `=` is write-only; compound (`+=`, etc.) dual-emits.
          if (node.operator === "=") suppressedReads.add(node.left.start);
        }
      },
      UpdateExpression(node: any) {
        if (node.argument?.type === "Identifier") {
          writePositions.add(node.argument.start);
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
          // Declaration position lives in `symbols`; emit write only.
          writePositions.add(node.id.start);
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
      // Declaration `.id` lives in `symbols.name_column_start/end` — fully
      // suppress so it isn't duplicated in `references`.
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
          // `as const` / `<const T>` — TS keyword in type position, not
          // a real type name.
          if (tn.name === "const") return;
          pushRef(tn.name, tn.start, tn.end, "type", 0);
        }
      },
      // Non-computed property access (`obj.foo`) — the property identifier
      // is a member name, not a binding. Suppress the default value-row
      // and emit as kind='member' so consumers can opt in.
      MemberExpression(node: any) {
        if (node.computed || node.property?.type !== "Identifier") return;
        const p = node.property;
        suppressedReads.add(p.start);
        pushRef(p.name, p.start, p.end, "member", 0);
      },
      // Object-literal property keys (`{ foo: 1 }`). Skip shorthand
      // (`{ foo }`) — there the key IS the binding ref. Also skip
      // computed (`{ [expr]: 1 }`) — `expr` is a real value ref.
      Property(node: any) {
        if (node.shorthand || node.computed) return;
        if (node.key?.type !== "Identifier") return;
        suppressedReads.add(node.key.start);
      },
      // Class method / property name (`class { foo() {} }` / `foo = 1;`).
      MethodDefinition(node: any) {
        if (node.computed || node.key?.type !== "Identifier") return;
        suppressedReads.add(node.key.start);
      },
      PropertyDefinition(node: any) {
        if (node.computed || node.key?.type !== "Identifier") return;
        suppressedReads.add(node.key.start);
      },
      // TS interface / type-literal member signatures (`{ foo: T }`).
      TSPropertySignature(node: any) {
        if (node.computed || node.key?.type !== "Identifier") return;
        suppressedReads.add(node.key.start);
      },
      TSMethodSignature(node: any) {
        if (node.computed || node.key?.type !== "Identifier") return;
        suppressedReads.add(node.key.start);
      },
    });
  },
};
