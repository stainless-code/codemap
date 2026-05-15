/**
 * Function/method parameter + variable-destructuring symbol emission.
 * Helpers called from the function-shape handlers in `symbolsExtractor`
 * / `scopesExtractor` so the caller's already-pushed scope is the
 * binding's scope_local_id. `walkPattern` handles Identifier /
 * AssignmentPattern / RestElement / TSParameterProperty / ObjectPattern
 * / ArrayPattern recursively.
 */

import type { JsDocEntry } from "./jsdoc";
import { findJsDoc } from "./jsdoc";
import { offsetToLine } from "./offsets";
import { stringifyTypeNode } from "./type-stringify";
import type { ExtractContext } from "./types";

interface PatternBinding {
  id: { name: string; start: number; end: number };
  typeAnnotation: any;
  isRest: boolean;
  isOptional: boolean;
}

/**
 * Recursively yield every leaf Identifier binding in a binding-position
 * pattern. Handles `function f(a, { b, c: x } = {}, ...rest)`-style
 * destructuring + TS parameter properties.
 */
function* walkPattern(p: any): Generator<PatternBinding> {
  if (!p) return;
  if (p.type === "Identifier") {
    yield {
      id: p,
      typeAnnotation: p.typeAnnotation?.typeAnnotation,
      isRest: false,
      isOptional: p.optional === true,
    };
    return;
  }
  if (p.type === "AssignmentPattern") {
    yield* walkPattern(p.left);
    return;
  }
  if (p.type === "RestElement") {
    for (const inner of walkPattern(p.argument)) {
      yield { ...inner, isRest: true };
    }
    return;
  }
  if (p.type === "ObjectPattern") {
    for (const prop of p.properties ?? []) {
      if (prop.type === "RestElement") {
        for (const inner of walkPattern(prop.argument)) {
          yield { ...inner, isRest: true };
        }
      } else {
        // Property — shorthand `{ a }` has value === key; renamed
        // `{ a: b }` binds the local name `b`. Either way the binding
        // is the `value` slot.
        yield* walkPattern(prop.value);
      }
    }
    return;
  }
  if (p.type === "ArrayPattern") {
    for (const el of p.elements ?? []) {
      yield* walkPattern(el);
    }
    return;
  }
  if (p.type === "TSParameterProperty" && p.parameter) {
    yield* walkPattern(p.parameter);
  }
}

/**
 * Push type-parameter symbols (kind='type-param') for a generic
 * function/class. Caller's already-pushed scope is the type-param's
 * scope_local_id. Interfaces/type aliases skipped — they don't push
 * their own scope, so same-letter type params (`interface A<T>`,
 * `interface B<T>`) can't be disambiguated. Tracked as follow-up.
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
  ownerKind: string = "function",
) {
  if (!params?.length) return;
  const { symbols, functionParams, relPath, lineMap } = ctx;
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    // Capture default-text from the AssignmentPattern wrapper before
    // walking into its left side; nested patterns inherit the same
    // default for now (rare case).
    const defaultText =
      p?.type === "AssignmentPattern" && p.right
        ? source.slice(p.right.start, p.right.end)
        : null;
    for (const parsed of walkPattern(p)) {
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
      if (parentName) {
        functionParams.push({
          file_path: relPath,
          owner_name: parentName,
          owner_kind: ownerKind,
          position: i,
          name: id.name,
          type_text: typeStr,
          default_text: defaultText,
          is_rest: isRest ? 1 : 0,
          is_optional: isOptional ? 1 : 0,
          line_start: lineStart,
          column_start: id.start - lineStartOffset,
          column_end: id.end - lineStartOffset,
        });
      }
    }
  }
}

/**
 * Emit each leaf binding of a `const`/`let`/`var` destructuring as a
 * `kind='const'` symbol in the declarator's scope. Same walker as
 * function params; the scope is the parent (declarator scope), not a
 * pushed function scope.
 */
export function pushDestructuredVars(
  pattern: any,
  scopeLocalId: number,
  parentName: string | null,
  ctx: ExtractContext,
) {
  if (!pattern) return;
  const { symbols, relPath, lineMap } = ctx;
  for (const parsed of walkPattern(pattern)) {
    const { id, typeAnnotation, isRest } = parsed;
    const lineStart = offsetToLine(lineMap, id.start);
    const lineStartOffset = lineMap[lineStart - 1] ?? 0;
    const typeStr = typeAnnotation ? stringifyTypeNode(typeAnnotation) : null;
    const prefix = isRest ? "..." : "";
    const sig = typeStr
      ? `${prefix}${id.name}: ${typeStr}`
      : `${prefix}${id.name}`;
    symbols.push({
      file_path: relPath,
      name: id.name,
      kind: "const",
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
      name_column_start: id.start - lineStartOffset,
      name_column_end: id.end - lineStartOffset,
      scope_local_id: scopeLocalId,
    });
  }
}
