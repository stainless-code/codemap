/**
 * Symbols extractor — emits rows into `symbols` (and `type_members` for
 * interface / type-alias members). Coordinates with the shared trackers
 * on `ExtractContext`: `scopes` for `parent_name`, `complexity` for
 * cyclomatic counts, `componentDetector` for component-row enter signals.
 *
 * Registered first in `EXTRACTORS` so its handlers push symbol rows + set
 * up scope / complexity / component state BEFORE downstream extractors
 * that depend on them (`callsExtractor`, `componentsExtractor`).
 */

import type { VisitorObject } from "oxc-parser";

import type { SymbolRow, TypeMemberRow } from "../db";
import { isComponentCandidate } from "./components";
import { buildJsDocIndex, findJsDoc } from "./jsdoc";
import type { JsDocEntry } from "./jsdoc";
import { offsetToLine } from "./offsets";
import { pushDestructuredVars, pushParams, pushTypeParams } from "./params";
import {
  buildFunctionSignature,
  functionShapeColumns,
  extractLiteralValue,
  stringifyTypeNode,
  stringifyTypeParams,
} from "./type-stringify";
import type { ExtractContext, TierExtractor } from "./types";

export const symbolsExtractor: TierExtractor = {
  tierId: "symbols",
  register(visitor, ctx) {
    const jsDocComments = buildJsDocIndex(ctx.comments);
    registerSymbolHandlers(visitor, ctx, jsDocComments);
  },
};

/**
 * Compute `name_column_start` / `name_column_end` (per [R.6]) for the
 * identifier token `idNode`. Returns zeros when the node lacks position
 * data so the column-precise contract degrades gracefully.
 */
function nameTokenColumns(
  idNode: any,
  lineStart: number,
  lineMap: number[],
): { name_column_start: number; name_column_end: number } {
  if (!idNode || idNode.start === undefined || idNode.end === undefined) {
    return { name_column_start: 0, name_column_end: 0 };
  }
  const lineStartOffset = lineMap[lineStart - 1] ?? 0;
  return {
    name_column_start: idNode.start - lineStartOffset,
    name_column_end: idNode.end - lineStartOffset,
  };
}

function registerSymbolHandlers(
  visitor: VisitorObject,
  ctx: ExtractContext,
  jsDocComments: JsDocEntry[],
): void {
  const {
    relPath,
    source,
    isTsx,
    lineMap,
    exportedNames,
    defaultExportedNames,
    symbols,
    typeMembers,
    scopes,
    complexity,
    componentDetector,
  } = ctx;

  Object.assign(visitor, {
    FunctionDeclaration(node: any) {
      const name = node.id?.name;
      if (!name) return;
      const lineStart = offsetToLine(lineMap, node.start);
      const lineEnd = offsetToLine(lineMap, node.end);
      const isExported =
        exportedNames.has(name) || defaultExportedNames.has(name);
      const isDefault = defaultExportedNames.has(name);

      const symbolIndex = symbols.length;
      symbols.push({
        file_path: relPath,
        name,
        kind: "function",
        line_start: lineStart,
        line_end: lineEnd,
        signature: buildFunctionSignature(name, node),
        is_exported: isExported ? 1 : 0,
        is_default_export: isDefault ? 1 : 0,
        members: null,
        doc_comment: findJsDoc(jsDocComments, node.start, source),
        value: null,
        parent_name: scopes.currentParent(),
        visibility: null,
        ...nameTokenColumns(node.id, lineStart, lineMap),
        scope_local_id: scopes.currentLocalId(),
        body_line_count: lineEnd - lineStart + 1,
        param_count: node.params?.length ?? 0,
        ...functionShapeColumns(node),
      });
      complexity.pushFor(symbolIndex);

      scopes.push(name, "function", lineStart, lineEnd);
      ctx.claimedScopeNodes.add(node);
      pushTypeParams(node.typeParameters, scopes.currentLocalId(), name, ctx);
      pushParams(
        node.params,
        scopes.currentLocalId(),
        name,
        ctx,
        jsDocComments,
        source,
      );
      if (isComponentCandidate(name, isTsx)) {
        componentDetector.enter(name);
      }
    },
    "FunctionDeclaration:exit"(node: any) {
      const name = node.id?.name;
      if (name && scopes.top() === name) {
        scopes.pop();
      }
      complexity.popTop();
      // ComponentRow push happens in `componentsExtractor` exit (chained).
    },

    VariableDeclaration(node: any) {
      const varKind = node.kind as "const" | "let" | "var";
      for (const decl of node.declarations) {
        const name = decl.id?.name;
        if (!name) {
          // Destructuring pattern: `const { a, b } = ...` or `let [x] = ...`.
          // Emit each leaf as a kind=varKind symbol at the current scope.
          if (
            decl.id?.type === "ObjectPattern" ||
            decl.id?.type === "ArrayPattern"
          ) {
            pushDestructuredVars(
              decl.id,
              scopes.currentLocalId(),
              scopes.currentParent(),
              varKind,
              ctx,
            );
          }
          continue;
        }
        const init = decl.init;
        // Per-declarator span — `const a = (…) => long, b = (…) => longer`
        // must NOT use the whole-statement range or every row inflates.
        const lineStart = offsetToLine(lineMap, decl.start);
        const lineEnd = offsetToLine(lineMap, decl.end);
        const isExported =
          exportedNames.has(name) || defaultExportedNames.has(name);
        const isDefault = defaultExportedNames.has(name);

        const isArrowOrFn =
          init?.type === "ArrowFunctionExpression" ||
          init?.type === "FunctionExpression";

        const symbolIndex = symbols.length;
        symbols.push({
          file_path: relPath,
          name,
          kind: isArrowOrFn ? "function" : varKind,
          line_start: lineStart,
          line_end: lineEnd,
          signature: isArrowOrFn
            ? buildFunctionSignature(name, init)
            : `${varKind} ${name}`,
          is_exported: isExported ? 1 : 0,
          is_default_export: isDefault ? 1 : 0,
          members: null,
          doc_comment: findJsDoc(jsDocComments, node.start, source),
          value: isArrowOrFn ? null : extractLiteralValue(init),
          parent_name: scopes.currentParent(),
          visibility: null,
          ...nameTokenColumns(decl.id, lineStart, lineMap),
          scope_local_id: scopes.currentLocalId(),
          body_line_count: isArrowOrFn ? lineEnd - lineStart + 1 : null,
          param_count: isArrowOrFn ? (init.params?.length ?? 0) : null,
          ...(isArrowOrFn ? functionShapeColumns(init) : {}),
        });

        if (init?.type === "ArrowFunctionExpression") {
          ctx.declaratorArrowScopes.set(init, {
            name,
            lineStart,
            lineEnd,
          });
          ctx.claimedScopeNodes.add(init);
          complexity.markArrowSymbol(init, symbolIndex);
        } else if (init?.type === "FunctionExpression") {
          ctx.declaratorArrowScopes.set(init, {
            name,
            lineStart,
            lineEnd,
          });
          ctx.claimedScopeNodes.add(init);
          complexity.markArrowSymbol(init, symbolIndex);
        }
        if (isArrowOrFn && isComponentCandidate(name, isTsx)) {
          componentDetector.enter(name);
        }
      }
    },
    "VariableDeclaration:exit"() {
      // ComponentRow push happens in `componentsExtractor` exit (chained).
    },

    TSTypeAliasDeclaration(node: any) {
      const name = node.id?.name;
      if (!name) return;
      const isExported = exportedNames.has(name);
      const tp = stringifyTypeParams(node.typeParameters);
      const lineStart = offsetToLine(lineMap, node.start);
      symbols.push({
        file_path: relPath,
        name,
        kind: "type",
        line_start: lineStart,
        line_end: offsetToLine(lineMap, node.end),
        signature: `type ${name}${tp}`,
        is_exported: isExported ? 1 : 0,
        is_default_export: 0,
        members: null,
        doc_comment: findJsDoc(jsDocComments, node.start, source),
        value: null,
        parent_name: scopes.currentParent(),
        visibility: null,
        ...nameTokenColumns(node.id, lineStart, lineMap),
        scope_local_id: scopes.currentLocalId(),
      });
      if (node.typeAnnotation?.type === "TSTypeLiteral") {
        extractObjectMembers(
          node.typeAnnotation.members,
          relPath,
          name,
          typeMembers,
        );
      }
    },

    TSInterfaceDeclaration(node: any) {
      const name = node.id?.name;
      if (!name) return;
      const isExported = exportedNames.has(name);
      const tp = stringifyTypeParams(node.typeParameters);
      let sig = `interface ${name}${tp}`;
      if (node.extends?.length) {
        const bases = node.extends
          .map((e: any) => {
            const base = e.expression?.name ?? e.typeName?.name ?? "";
            if (!base) return null;
            const ta = e.typeArguments ?? e.typeParameters;
            if (ta?.params?.length) {
              const args = ta.params.map(stringifyTypeNode).filter(Boolean);
              if (args.length) return `${base}<${args.join(", ")}>`;
            }
            return base;
          })
          .filter(Boolean);
        if (bases.length) sig += ` extends ${bases.join(", ")}`;
      }
      const interfaceLineStart = offsetToLine(lineMap, node.start);
      symbols.push({
        file_path: relPath,
        name,
        kind: "interface",
        line_start: interfaceLineStart,
        line_end: offsetToLine(lineMap, node.end),
        signature: sig,
        is_exported: isExported ? 1 : 0,
        is_default_export: 0,
        members: null,
        doc_comment: findJsDoc(jsDocComments, node.start, source),
        value: null,
        parent_name: scopes.currentParent(),
        visibility: null,
        ...nameTokenColumns(node.id, interfaceLineStart, lineMap),
        scope_local_id: scopes.currentLocalId(),
      });
      extractObjectMembers(node.body?.body, relPath, name, typeMembers);
    },

    TSEnumDeclaration(node: any) {
      const name = node.id?.name;
      if (!name) return;
      const isExported = exportedNames.has(name);
      const enumMembers = node.body?.members;
      let members: string | null = null;
      if (enumMembers?.length) {
        const extracted = enumMembers.map((m: any) => {
          const mName = m.id?.name ?? m.id?.value;
          if (!mName) return null;
          const init = m.initializer;
          let mValue: string | number | null = null;
          if (init?.type === "Literal" || init?.type === "StringLiteral")
            mValue = init.value;
          else if (init?.type === "NumericLiteral") mValue = init.value;
          return mValue !== null && mValue !== undefined
            ? { name: mName, value: mValue }
            : { name: mName };
        });
        members = JSON.stringify(extracted.filter(Boolean));
      }
      const enumLineStart = offsetToLine(lineMap, node.start);
      symbols.push({
        file_path: relPath,
        name,
        kind: "enum",
        line_start: enumLineStart,
        line_end: offsetToLine(lineMap, node.end),
        signature: `enum ${name}`,
        is_exported: isExported ? 1 : 0,
        is_default_export: 0,
        members,
        doc_comment: findJsDoc(jsDocComments, node.start, source),
        value: null,
        parent_name: scopes.currentParent(),
        visibility: null,
        ...nameTokenColumns(node.id, enumLineStart, lineMap),
        scope_local_id: scopes.currentLocalId(),
      });
    },

    ClassDeclaration(node: any) {
      const name = node.id?.name;
      if (!name) return;
      const isExported =
        exportedNames.has(name) || defaultExportedNames.has(name);
      const tp = stringifyTypeParams(node.typeParameters);
      let sig = `class ${name}${tp}`;
      if (node.superClass?.name) {
        sig += ` extends ${node.superClass.name}`;
        const sta = node.superTypeArguments ?? node.superTypeParameters;
        if (sta?.params?.length) {
          const args = sta.params.map(stringifyTypeNode).filter(Boolean);
          if (args.length) sig += `<${args.join(", ")}>`;
        }
      }
      if (node.implements?.length) {
        const impls = node.implements
          .map((i: any) => {
            const n = i.expression?.name ?? "";
            if (!n) return null;
            const ta = i.typeArguments ?? i.typeParameters;
            if (ta?.params?.length) {
              const args = ta.params.map(stringifyTypeNode).filter(Boolean);
              if (args.length) return `${n}<${args.join(", ")}>`;
            }
            return n;
          })
          .filter(Boolean);
        if (impls.length) sig += ` implements ${impls.join(", ")}`;
      }
      const classLineStart = offsetToLine(lineMap, node.start);
      symbols.push({
        file_path: relPath,
        name,
        kind: "class",
        line_start: classLineStart,
        line_end: offsetToLine(lineMap, node.end),
        signature: sig,
        is_exported: isExported ? 1 : 0,
        is_default_export: defaultExportedNames.has(name) ? 1 : 0,
        members: null,
        doc_comment: findJsDoc(jsDocComments, node.start, source),
        value: null,
        parent_name: scopes.currentParent(),
        visibility: null,
        ...nameTokenColumns(node.id, classLineStart, lineMap),
        scope_local_id: scopes.currentLocalId(),
      });
      scopes.push(
        name,
        "class",
        classLineStart,
        offsetToLine(lineMap, node.end),
      );
      ctx.claimedScopeNodes.add(node);
      const classScopeLocalId = scopes.currentLocalId();
      pushTypeParams(node.typeParameters, classScopeLocalId, name, ctx);
      // Constructor params live in the class scope (constructor is a
      // method but its params with `public`/`private` modifiers also
      // become class properties — TSParameterProperty handled in
      // `pushParams`).
      const ctor = node.body?.body?.find(
        (m: any) => m.type === "MethodDefinition" && m.kind === "constructor",
      );
      if (ctor?.value?.params?.length) {
        pushParams(
          ctor.value.params,
          classScopeLocalId,
          name,
          ctx,
          jsDocComments,
          source,
        );
      }
      extractClassMembers(
        node.body?.body,
        relPath,
        name,
        classScopeLocalId,
        lineMap,
        symbols,
        jsDocComments,
        source,
      );
    },
    "ClassDeclaration:exit"(node: any) {
      const name = node.id?.name;
      if (name && scopes.top() === name) {
        scopes.pop();
      }
    },
  });
}

// `parent_name` is set to `className` directly rather than via
// `scopes.currentParent()` — members emit synchronously inside
// ClassDeclaration before children visit, so the scope stack hasn't
// pushed yet.
function extractClassMembers(
  members: any[] | undefined,
  filePath: string,
  className: string,
  classScopeLocalId: number,
  lineMap: number[],
  out: SymbolRow[],
  jsDocComments: JsDocEntry[],
  source: string,
) {
  if (!members?.length) return;
  for (const m of members) {
    const name = m.key?.name;
    if (!name) continue;

    if (m.type === "MethodDefinition") {
      const fn = m.value;
      const kind =
        m.kind === "get" ? "getter" : m.kind === "set" ? "setter" : "method";
      let prefix = "";
      if (m.accessibility && m.accessibility !== "public") {
        prefix += `${m.accessibility} `;
      }
      if (m.static) prefix += "static ";
      if (fn?.async) prefix += "async ";
      const sig = `${prefix}${buildFunctionSignature(name, fn)}`;
      const methodLineStart = offsetToLine(lineMap, m.start);
      const methodLineEnd = offsetToLine(lineMap, m.end);
      out.push({
        file_path: filePath,
        name,
        kind,
        line_start: methodLineStart,
        line_end: methodLineEnd,
        signature: sig,
        is_exported: 0,
        is_default_export: 0,
        members: null,
        doc_comment: findJsDoc(jsDocComments, m.start, source),
        value: null,
        parent_name: className,
        visibility: null,
        ...nameTokenColumns(m.key, methodLineStart, lineMap),
        scope_local_id: classScopeLocalId,
        body_line_count: methodLineEnd - methodLineStart + 1,
        param_count: fn?.params?.length ?? 0,
        ...functionShapeColumns(fn),
      });
    } else if (m.type === "PropertyDefinition") {
      let prefix = "";
      if (m.accessibility && m.accessibility !== "public") {
        prefix += `${m.accessibility} `;
      }
      if (m.static) prefix += "static ";
      if (m.readonly) prefix += "readonly ";
      const ta = m.typeAnnotation?.typeAnnotation;
      const typeStr = ta ? stringifyTypeNode(ta) : null;
      const sig = typeStr ? `${prefix}${name}: ${typeStr}` : `${prefix}${name}`;
      const propLineStart = offsetToLine(lineMap, m.start);
      out.push({
        file_path: filePath,
        name,
        kind: "property",
        line_start: propLineStart,
        line_end: offsetToLine(lineMap, m.end),
        signature: sig,
        is_exported: 0,
        is_default_export: 0,
        members: null,
        doc_comment: findJsDoc(jsDocComments, m.start, source),
        value: extractLiteralValue(m.value),
        parent_name: className,
        visibility: null,
        ...nameTokenColumns(m.key, propLineStart, lineMap),
        scope_local_id: classScopeLocalId,
      });
    }
  }
}

// Reusable substrate for Tier 4 (`function_params` will lift the
// method-signature path here). Method signatures stringify their
// full callable shape into `type`.
function extractObjectMembers(
  members: any[] | undefined,
  filePath: string,
  symbolName: string,
  out: TypeMemberRow[],
) {
  if (!members?.length) return;
  for (const m of members) {
    const name = m.key?.name ?? m.key?.value;
    if (!name) continue;
    let type: string | null = null;
    if (m.type === "TSMethodSignature") {
      const rt = m.returnType?.typeAnnotation;
      const rtStr = rt ? stringifyTypeNode(rt) : null;
      const params = m.params;
      let paramStr = "";
      if (params?.length) {
        paramStr = params
          .map((p: any) => p.name ?? p.left?.name ?? "...")
          .join(", ");
      }
      type = `(${paramStr})${rtStr ? ` => ${rtStr}` : ""}`;
    } else {
      const ta = m.typeAnnotation?.typeAnnotation;
      if (ta) type = stringifyTypeNode(ta);
    }
    out.push({
      file_path: filePath,
      symbol_name: symbolName,
      name,
      type,
      is_optional: m.optional ? 1 : 0,
      is_readonly: m.readonly ? 1 : 0,
    });
  }
}
