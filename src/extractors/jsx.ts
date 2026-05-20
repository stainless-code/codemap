/**
 * JSX elements + attributes substrate (Tier 3).
 */

import { offsetToLine } from "./offsets";
import type { TierExtractor } from "./types";

export interface ParsedJsxElement {
  file_path: string;
  component_name: string;
  line_start: number;
  line_end: number;
  column_start: number;
  column_end: number;
  is_self_closing: number;
  is_fragment: number;
  namespace_prefix: string | null;
  children_count: number;
  is_lowercase: number;
  _local_id: number;
  _parent_local_id: number | null;
}

export interface ParsedJsxAttribute {
  element_local_id: number;
  name: string;
  line: number;
  column_start: number;
  column_end: number;
  value_kind: "string" | "expression" | "boolean" | "spread" | "element";
  value_text: string | null;
}

function jsxElementName(node: any): {
  component_name: string;
  namespace_prefix: string | null;
  is_lowercase: number;
} {
  if (!node) {
    return { component_name: "", namespace_prefix: null, is_lowercase: 0 };
  }
  if (node.type === "JSXIdentifier") {
    const name = node.name ?? "";
    return {
      component_name: name,
      namespace_prefix: null,
      is_lowercase: /^[a-z]/.test(name) ? 1 : 0,
    };
  }
  if (node.type === "JSXMemberExpression") {
    const object = jsxElementName(node.object);
    const prop = node.property?.name ?? "";
    return {
      component_name: prop,
      namespace_prefix: object.component_name || object.namespace_prefix,
      is_lowercase: /^[a-z]/.test(prop) ? 1 : 0,
    };
  }
  if (node.type === "JSXNamespacedName") {
    return {
      component_name: node.name?.name ?? "",
      namespace_prefix: node.namespace?.name ?? null,
      is_lowercase: 0,
    };
  }
  return { component_name: "", namespace_prefix: null, is_lowercase: 0 };
}

function countJsxChildren(children: any[] | undefined): number {
  if (!children?.length) return 0;
  let n = 0;
  for (const child of children) {
    if (child?.type === "JSXElement" || child?.type === "JSXFragment") n++;
  }
  return n;
}

function attributeValue(
  source: string,
  value: any,
): { value_kind: ParsedJsxAttribute["value_kind"]; value_text: string | null } {
  if (value == null) {
    return { value_kind: "boolean", value_text: null };
  }
  if (value.type === "Literal" && typeof value.value === "string") {
    return { value_kind: "string", value_text: value.value };
  }
  if (value.type === "JSXExpressionContainer") {
    const inner = value.expression;
    if (inner) {
      return {
        value_kind: "expression",
        value_text: source.slice(inner.start, inner.end),
      };
    }
    return { value_kind: "expression", value_text: null };
  }
  if (value.type === "JSXElement" || value.type === "JSXFragment") {
    return {
      value_kind: "element",
      value_text: source.slice(value.start, value.end),
    };
  }
  return {
    value_kind: "expression",
    value_text: source.slice(value.start, value.end),
  };
}

export const jsxExtractor: TierExtractor = {
  tierId: "jsx",
  register(visitor, ctx) {
    if (!ctx.isTsx) return;

    const { relPath, lineMap, source } = ctx;
    const elements = ctx.jsxElements;
    const attributes = ctx.jsxAttributes;
    const stack: number[] = [];
    let nextLocalId = 0;

    function recordAttributes(opening: any, elementLocalId: number) {
      for (const attr of opening.attributes ?? []) {
        if (attr.type === "JSXSpreadAttribute") {
          const line = offsetToLine(lineMap, attr.start);
          const lineStartOffset = lineMap[line - 1] ?? 0;
          attributes.push({
            element_local_id: elementLocalId,
            name: "…spread",
            line,
            column_start: attr.start - lineStartOffset,
            column_end: attr.end - lineStartOffset,
            value_kind: "spread",
            value_text: source.slice(attr.argument.start, attr.argument.end),
          });
          continue;
        }
        if (attr.type !== "JSXAttribute") continue;
        const name = attr.name?.name ?? "";
        const tokenStart = attr.name?.start ?? attr.start;
        const tokenEnd = attr.name?.end ?? attr.end;
        const line = offsetToLine(lineMap, tokenStart);
        const lineStartOffset = lineMap[line - 1] ?? 0;
        const { value_kind, value_text } = attributeValue(source, attr.value);
        attributes.push({
          element_local_id: elementLocalId,
          name,
          line,
          column_start: tokenStart - lineStartOffset,
          column_end: tokenEnd - lineStartOffset,
          value_kind,
          value_text,
        });
      }
    }

    function pushElement(
      node: any,
      nameNode: any,
      opening: any,
      isFragment: number,
    ) {
      const localId = nextLocalId++;
      const parentLocalId = stack.length ? stack[stack.length - 1]! : null;
      const { component_name, namespace_prefix, is_lowercase } = isFragment
        ? { component_name: "", namespace_prefix: null, is_lowercase: 0 }
        : jsxElementName(nameNode);
      const tokenStart = isFragment
        ? (node.openingFragment?.start ?? node.start)
        : (opening.name?.start ?? opening.start);
      const tokenEnd = isFragment
        ? (node.closingFragment?.end ?? node.end)
        : (opening.name?.end ?? opening.end);
      const lineStart = offsetToLine(lineMap, node.start);
      const lineEnd = offsetToLine(lineMap, node.end);
      const lineStartOffset = lineMap[lineStart - 1] ?? 0;
      elements.push({
        file_path: relPath,
        component_name,
        line_start: lineStart,
        line_end: lineEnd,
        column_start: tokenStart - lineStartOffset,
        column_end: tokenEnd - lineStartOffset,
        is_self_closing: opening?.selfClosing ? 1 : 0,
        is_fragment: isFragment,
        namespace_prefix,
        children_count: countJsxChildren(node.children),
        is_lowercase,
        _local_id: localId,
        _parent_local_id: parentLocalId,
      });
      if (!isFragment && opening) {
        recordAttributes(opening, localId);
      }
      stack.push(localId);
    }

    Object.assign(visitor, {
      JSXElement(node: any) {
        pushElement(node, node.openingElement?.name, node.openingElement, 0);
      },
      "JSXElement:exit"() {
        stack.pop();
      },
      JSXFragment(node: any) {
        pushElement(node, null, node.openingFragment, 1);
      },
      "JSXFragment:exit"() {
        stack.pop();
      },
    });
  },
};
