/**
 * Function/method parameter symbol emission. Helpers called from the
 * function-shape handlers in `symbolsExtractor` / `scopesExtractor` so
 * the caller's already-pushed scope is the param's scope_local_id.
 * Destructuring patterns (Array/Object) defer to a follow-up — v1 only
 * Identifier / AssignmentPattern / RestElement / TSParameterProperty.
 */

import type { JsDocEntry } from "./jsdoc";
import { findJsDoc } from "./jsdoc";
import { offsetToLine } from "./offsets";
import { stringifyTypeNode } from "./type-stringify";
import type { ExtractContext } from "./types";

interface ParamIdentifier {
  id: { name: string; start: number; end: number };
  typeAnnotation: any;
  isRest: boolean;
  isOptional: boolean;
}

function paramIdentifier(p: any): ParamIdentifier | null {
  if (!p) return null;
  if (p.type === "Identifier") {
    return {
      id: p,
      typeAnnotation: p.typeAnnotation?.typeAnnotation,
      isRest: false,
      isOptional: p.optional === true,
    };
  }
  if (p.type === "AssignmentPattern" && p.left?.type === "Identifier") {
    return {
      id: p.left,
      typeAnnotation: p.left.typeAnnotation?.typeAnnotation,
      isRest: false,
      isOptional: true,
    };
  }
  if (p.type === "RestElement" && p.argument?.type === "Identifier") {
    return {
      id: p.argument,
      typeAnnotation: p.typeAnnotation?.typeAnnotation,
      isRest: true,
      isOptional: false,
    };
  }
  // `constructor(public foo: T)` — TS parameter property
  if (p.type === "TSParameterProperty" && p.parameter) {
    return paramIdentifier(p.parameter);
  }
  return null;
}

/**
 * Push type-parameter symbols (kind='type-param') for a generic
 * function/class. Caller's already-pushed scope is the type-param's
 * scope_local_id. Interfaces/type aliases skipped in v1 — they don't
 * push their own scope, so collisions across same-letter type params
 * (`interface A<T>`, `interface B<T>`) can't be disambiguated yet.
 */
export function pushTypeParams(
  typeParameters: any,
  scopeLocalId: number,
  parentName: string | null,
  ctx: ExtractContext,
) {
  const params = typeParameters?.params;
  if (!params?.length) return;
  const { symbols, relPath, lineMap } = ctx;
  for (const tp of params) {
    const id = tp.name;
    if (!id || typeof id.name !== "string") continue;
    const lineStart = offsetToLine(lineMap, id.start ?? tp.start);
    const lineStartOffset = lineMap[lineStart - 1] ?? 0;
    let sig = id.name;
    const constraint = tp.constraint;
    const def = tp.default;
    if (constraint) {
      const cstr = stringifyTypeNode(constraint);
      if (cstr) sig += ` extends ${cstr}`;
    }
    if (def) {
      const dstr = stringifyTypeNode(def);
      if (dstr) sig += ` = ${dstr}`;
    }
    symbols.push({
      file_path: relPath,
      name: id.name,
      kind: "type-param",
      line_start: lineStart,
      line_end: lineStart,
      signature: sig,
      is_exported: 0,
      is_default_export: 0,
      members: null,
      doc_comment: null,
      value: null,
      parent_name: parentName,
      visibility: null,
      name_column_start: (id.start ?? tp.start) - lineStartOffset,
      name_column_end: (id.end ?? tp.end) - lineStartOffset,
      scope_local_id: scopeLocalId,
    });
  }
}

export function pushParams(
  params: any[] | undefined,
  scopeLocalId: number,
  parentName: string | null,
  ctx: ExtractContext,
  jsDocComments: JsDocEntry[],
  source: string,
) {
  if (!params?.length) return;
  const { symbols, relPath, lineMap } = ctx;
  for (const p of params) {
    const parsed = paramIdentifier(p);
    if (!parsed) continue;
    const { id, typeAnnotation, isRest, isOptional } = parsed;
    const lineStart = offsetToLine(lineMap, id.start);
    const lineStartOffset = lineMap[lineStart - 1] ?? 0;
    const typeStr = typeAnnotation ? stringifyTypeNode(typeAnnotation) : null;
    const prefix = isRest ? "..." : "";
    const suffix = isOptional ? "?" : "";
    const sig = typeStr
      ? `${prefix}${id.name}${suffix}: ${typeStr}`
      : `${prefix}${id.name}${suffix}`;
    symbols.push({
      file_path: relPath,
      name: id.name,
      kind: "param",
      line_start: lineStart,
      line_end: lineStart,
      signature: sig,
      is_exported: 0,
      is_default_export: 0,
      members: null,
      doc_comment: findJsDoc(jsDocComments, id.start, source),
      value: null,
      parent_name: parentName,
      visibility: null,
      name_column_start: id.start - lineStartOffset,
      name_column_end: id.end - lineStartOffset,
      scope_local_id: scopeLocalId,
    });
  }
}
