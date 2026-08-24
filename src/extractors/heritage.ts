/**
 * Type heritage extractor — one `type_heritage` row per extends/implements
 * edge from class / interface AST nodes. Resolution runs in heritage-resolver.
 */

import type { TypeHeritageRow } from "../db";
import { offsetToLine } from "./offsets";
import { stringifyTypeNode } from "./type-stringify";
import type { ExtractContext } from "./types";

export type HeritageRelation = "extends" | "implements";

function qualifiedNameOf(node: any): string | null {
  if (!node) return null;
  if (node.type === "Identifier") return node.name ?? null;
  if (typeof node.name === "string") return node.name;
  if (node.type === "MemberExpression" && !node.computed) {
    const obj = qualifiedNameOf(node.object);
    const prop = node.property?.name;
    if (obj && prop) return `${obj}.${prop}`;
    return null;
  }
  if (node.type === "TSQualifiedName") {
    const left = qualifiedNameOf(node.left);
    const right = node.right?.name;
    if (!left || !right) return null;
    return `${left}.${right}`;
  }
  return null;
}

function unwrapExpression(node: any): any {
  let cur = node;
  while (cur?.type === "ParenthesizedExpression") cur = cur.expression;
  return cur;
}

/** oxc 0.146+ recovers invalid interface `extends` as a zero-span `ThisExpression`. */
function isRecoveredDummyExpression(expr: any, heritageNode: any): boolean {
  if (!expr) return true;
  const start = expr.start;
  const end = expr.end;
  if (typeof start !== "number" || typeof end !== "number" || start === end) {
    return true;
  }
  const hs = heritageNode?.start;
  const he = heritageNode?.end;
  if (typeof hs === "number" && typeof he === "number") {
    return start < hs || end > he;
  }
  return false;
}

function bestEffortSimpleName(node: any): string | null {
  const unwrapped = unwrapExpression(node);
  if (!unwrapped) return null;
  if (unwrapped.type === "Identifier") return unwrapped.name ?? null;
  if (unwrapped.type === "BinaryExpression" && unwrapped.operator === "|") {
    return bestEffortSimpleName(unwrapped.left);
  }
  if (unwrapped.type === "MemberExpression" && !unwrapped.computed) {
    return unwrapped.property?.name ?? bestEffortSimpleName(unwrapped.object);
  }
  return null;
}

function heritageBaseFromTypeRef(
  node: any,
  heritageNode?: any,
): {
  simpleName: string;
  qualifiedName: string | null;
  typeArgs: string | null;
} | null {
  if (!node) return null;
  let typeNameNode: any = null;
  if (node.type === "TSTypeReference") {
    typeNameNode = node.typeName;
  } else if (node.type === "Identifier" || node.type === "TSQualifiedName") {
    typeNameNode = node;
  } else if (node.type === "MemberExpression") {
    const q = qualifiedNameOf(node);
    if (!q) return null;
    const simpleName = q.includes(".") ? (q.split(".").pop() ?? q) : q;
    return {
      simpleName,
      qualifiedName: q.includes(".") ? q : null,
      typeArgs: null,
    };
  } else {
    return null;
  }
  const qualifiedName = qualifiedNameOf(typeNameNode);
  if (!qualifiedName) return null;
  const simpleName = qualifiedName.includes(".")
    ? (qualifiedName.split(".").pop() ?? qualifiedName)
    : qualifiedName;
  const typeArgsNode =
    heritageNode?.typeArguments ??
    heritageNode?.typeParameters ??
    node.typeArguments ??
    node.typeParameters;
  let typeArgs: string | null = null;
  if (typeArgsNode?.params?.length) {
    const args = typeArgsNode.params.map(stringifyTypeNode).filter(Boolean);
    if (args.length) typeArgs = args.join(", ");
  }
  return {
    simpleName,
    qualifiedName: qualifiedName.includes(".") ? qualifiedName : null,
    typeArgs,
  };
}

function initialResolutionKind(
  qualifiedName: string | null,
): TypeHeritageRow["resolution_kind"] {
  return qualifiedName ? "qualified-unresolved" : "unresolved";
}

function pushHeritageRow(
  ctx: ExtractContext,
  row: Omit<
    TypeHeritageRow,
    "base_file_path" | "base_symbol_id" | "resolution_kind"
  > & { resolution_kind?: TypeHeritageRow["resolution_kind"] },
) {
  ctx.typeHeritage.push({
    ...row,
    base_file_path: null,
    base_symbol_id: null,
    resolution_kind:
      row.resolution_kind ?? initialResolutionKind(row.base_qualified_name),
  });
}

function recordHeritageBase(
  ctx: ExtractContext,
  child: {
    file_path: string;
    name: string;
    kind: string;
    line_start: number;
  },
  heritageNode: any,
  relation: HeritageRelation,
) {
  const expr = unwrapExpression(
    heritageNode?.expression ?? heritageNode?.typeName ?? heritageNode,
  );
  if (isRecoveredDummyExpression(expr, heritageNode)) return;
  const base = heritageBaseFromTypeRef(expr, heritageNode);
  if (!base) {
    const simple = bestEffortSimpleName(expr) ?? "(expression)";
    pushHeritageRow(ctx, {
      child_file_path: child.file_path,
      child_name: child.name,
      child_kind: child.kind,
      child_line_start: child.line_start,
      relation,
      base_simple_name: simple,
      base_qualified_name: "(expression)",
      type_args: null,
      resolution_kind: "unresolved",
    });
    return;
  }
  pushHeritageRow(ctx, {
    child_file_path: child.file_path,
    child_name: child.name,
    child_kind: child.kind,
    child_line_start: child.line_start,
    relation,
    base_simple_name: base.simpleName,
    base_qualified_name: base.qualifiedName,
    type_args: base.typeArgs,
  });
}

export function recordInterfaceHeritage(
  ctx: ExtractContext,
  relPath: string,
  name: string,
  kind: string,
  lineStart: number,
  node: any,
) {
  const child = {
    file_path: relPath,
    name,
    kind,
    line_start: lineStart,
  };
  for (const ext of node.extends ?? []) {
    recordHeritageBase(ctx, child, ext, "extends");
  }
}

export function recordClassHeritage(
  ctx: ExtractContext,
  relPath: string,
  name: string,
  kind: string,
  lineStart: number,
  node: any,
) {
  const child = {
    file_path: relPath,
    name,
    kind,
    line_start: lineStart,
  };
  if (node.superClass) {
    recordHeritageBase(
      ctx,
      child,
      {
        expression: node.superClass,
        typeArguments: node.superTypeArguments ?? node.superTypeParameters,
      },
      "extends",
    );
  }
  for (const impl of node.implements ?? []) {
    recordHeritageBase(ctx, child, impl, "implements");
  }
}

/** Parse heritage from a standalone snippet (unit tests). */
export function extractHeritageFromSource(
  relPath: string,
  program: any,
  lineMap: number[],
): TypeHeritageRow[] {
  const rows: TypeHeritageRow[] = [];
  const ctx = {
    typeHeritage: rows,
  } as Pick<ExtractContext, "typeHeritage">;
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "TSInterfaceDeclaration" && node.id?.name) {
      recordInterfaceHeritage(
        ctx as ExtractContext,
        relPath,
        node.id.name,
        "interface",
        offsetToLine(lineMap, node.start),
        node,
      );
    }
    if (node.type === "ClassDeclaration" && node.id?.name) {
      recordClassHeritage(
        ctx as ExtractContext,
        relPath,
        node.id.name,
        "class",
        offsetToLine(lineMap, node.start),
        node,
      );
    }
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (Array.isArray(val)) {
        for (const item of val) visit(item);
      } else if (val && typeof val === "object" && val.type) {
        visit(val);
      }
    }
  };
  visit(program);
  return rows;
}
