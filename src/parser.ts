import { extname } from "node:path";

import { parseSync, Visitor } from "oxc-parser";
import type {
  StaticImport,
  StaticExportEntry,
  ExportExportNameKind,
  ImportNameKind,
} from "oxc-parser";

import type {
  SymbolRow,
  ImportRow,
  ExportRow,
  ComponentRow,
  MarkerRow,
  TypeMemberRow,
  CallRow,
} from "./db";
import { extractMarkers } from "./markers";

interface ExtractedData {
  symbols: SymbolRow[];
  imports: ImportRow[];
  exports: ExportRow[];
  components: ComponentRow[];
  markers: MarkerRow[];
  typeMembers: TypeMemberRow[];
  calls: CallRow[];
}

/**
 * Compute line number from byte offset.
 * Build a line-start-offsets array once, then binary search.
 */
function buildLineMap(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function offsetToLine(lineMap: number[], offset: number): number {
  let lo = 0;
  let hi = lineMap.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineMap[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

export function extractFileData(
  filePath: string,
  source: string,
  relPath: string,
): ExtractedData {
  const ext = extname(filePath).toLowerCase();
  const lang =
    ext === ".tsx"
      ? "tsx"
      : ext === ".jsx"
        ? "jsx"
        : ext === ".ts" || ext === ".mts" || ext === ".cts"
          ? "ts"
          : "js";

  const isTsx = ext === ".tsx" || ext === ".jsx";

  const result = parseSync(filePath, source, { lang, preserveParens: false });
  const lineMap = buildLineMap(source);
  const mod = result.module;

  const jsDocComments = buildJsDocIndex(result.comments);

  const symbols: SymbolRow[] = [];
  const imports: ImportRow[] = [];
  const exports: ExportRow[] = [];
  const components: ComponentRow[] = [];
  const markers: MarkerRow[] = [];
  const typeMembers: TypeMemberRow[] = [];
  const calls: CallRow[] = [];
  const seenCalls = new Set<string>();

  const exportedNames = new Set<string>();
  const defaultExportedNames = new Set<string>();

  for (const exp of mod.staticExports) {
    for (const entry of exp.entries) {
      const exportName = entry.exportName;
      if (exportName.kind === ("Default" as ExportExportNameKind)) {
        const localName = entry.localName;
        if (localName.name) defaultExportedNames.add(localName.name);
        defaultExportedNames.add("default");
      } else if (
        exportName.kind === ("Name" as ExportExportNameKind) &&
        exportName.name
      ) {
        exportedNames.add(exportName.name);
      }

      exports.push(exportEntryToRow(relPath, entry));
    }
  }

  for (const imp of mod.staticImports) {
    imports.push(staticImportToRow(relPath, imp, lineMap));
  }

  const hookCalls = new Map<string, Set<string>>(); // function scope name -> hook names
  const jsxScopes = new Set<string>(); // function scopes that contain JSX
  let currentFunctionScope: string | null = null;
  const scopeStack: string[] = [];
  const currentParent = () =>
    scopeStack.length ? scopeStack[scopeStack.length - 1] : null;
  const currentScope = () => scopeStack.join(".");

  const visitor = new Visitor({
    FunctionDeclaration(node: any) {
      const name = node.id?.name;
      if (!name) return;
      const lineStart = offsetToLine(lineMap, node.start);
      const lineEnd = offsetToLine(lineMap, node.end);
      const isExported =
        exportedNames.has(name) || defaultExportedNames.has(name);
      const isDefault = defaultExportedNames.has(name);

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
        parent_name: currentParent(),
      });

      scopeStack.push(name);
      if (isTsx && /^[A-Z]/.test(name)) {
        currentFunctionScope = name;
        hookCalls.set(name, new Set());
      }
    },
    "FunctionDeclaration:exit"(node: any) {
      const name = node.id?.name;
      if (name && scopeStack[scopeStack.length - 1] === name) {
        scopeStack.pop();
      }
      if (name && currentFunctionScope === name) {
        maybeAddComponent(name, node, false);
        currentFunctionScope = null;
      }
    },

    VariableDeclaration(node: any) {
      for (const decl of node.declarations) {
        const name = decl.id?.name;
        if (!name) continue;
        const init = decl.init;
        const lineStart = offsetToLine(lineMap, node.start);
        const lineEnd = offsetToLine(lineMap, node.end);
        const isExported =
          exportedNames.has(name) || defaultExportedNames.has(name);
        const isDefault = defaultExportedNames.has(name);

        const isArrowOrFn =
          init?.type === "ArrowFunctionExpression" ||
          init?.type === "FunctionExpression";

        symbols.push({
          file_path: relPath,
          name,
          kind: isArrowOrFn ? "function" : "const",
          line_start: lineStart,
          line_end: lineEnd,
          signature: isArrowOrFn
            ? buildFunctionSignature(name, init)
            : `const ${name}`,
          is_exported: isExported ? 1 : 0,
          is_default_export: isDefault ? 1 : 0,
          members: null,
          doc_comment: findJsDoc(jsDocComments, node.start, source),
          value: isArrowOrFn ? null : extractLiteralValue(init),
          parent_name: currentParent(),
        });

        if (isArrowOrFn) {
          scopeStack.push(name);
        }
        if (isTsx && /^[A-Z]/.test(name) && isArrowOrFn) {
          currentFunctionScope = name;
          hookCalls.set(name, new Set());
        }
      }
    },
    "VariableDeclaration:exit"(node: any) {
      const decls = node.declarations;
      for (let i = decls.length - 1; i >= 0; i--) {
        const decl = decls[i];
        const name = decl.id?.name;
        if (!name) continue;
        const init = decl.init;
        const isArrowOrFn =
          init?.type === "ArrowFunctionExpression" ||
          init?.type === "FunctionExpression";
        if (isArrowOrFn && scopeStack[scopeStack.length - 1] === name) {
          scopeStack.pop();
        }
        if (name && currentFunctionScope === name) {
          maybeAddComponent(name, init, true);
          currentFunctionScope = null;
        }
      }
    },

    TSTypeAliasDeclaration(node: any) {
      const name = node.id?.name;
      if (!name) return;
      const isExported = exportedNames.has(name);
      const tp = stringifyTypeParams(node.typeParameters);
      symbols.push({
        file_path: relPath,
        name,
        kind: "type",
        line_start: offsetToLine(lineMap, node.start),
        line_end: offsetToLine(lineMap, node.end),
        signature: `type ${name}${tp}`,
        is_exported: isExported ? 1 : 0,
        is_default_export: 0,
        members: null,
        doc_comment: findJsDoc(jsDocComments, node.start, source),
        value: null,
        parent_name: currentParent(),
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
      symbols.push({
        file_path: relPath,
        name,
        kind: "interface",
        line_start: offsetToLine(lineMap, node.start),
        line_end: offsetToLine(lineMap, node.end),
        signature: sig,
        is_exported: isExported ? 1 : 0,
        is_default_export: 0,
        members: null,
        doc_comment: findJsDoc(jsDocComments, node.start, source),
        value: null,
        parent_name: currentParent(),
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
      symbols.push({
        file_path: relPath,
        name,
        kind: "enum",
        line_start: offsetToLine(lineMap, node.start),
        line_end: offsetToLine(lineMap, node.end),
        signature: `enum ${name}`,
        is_exported: isExported ? 1 : 0,
        is_default_export: 0,
        members,
        doc_comment: findJsDoc(jsDocComments, node.start, source),
        value: null,
        parent_name: currentParent(),
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
      symbols.push({
        file_path: relPath,
        name,
        kind: "class",
        line_start: offsetToLine(lineMap, node.start),
        line_end: offsetToLine(lineMap, node.end),
        signature: sig,
        is_exported: isExported ? 1 : 0,
        is_default_export: defaultExportedNames.has(name) ? 1 : 0,
        members: null,
        doc_comment: findJsDoc(jsDocComments, node.start, source),
        value: null,
        parent_name: currentParent(),
      });
      scopeStack.push(name);
      extractClassMembers(
        node.body?.body,
        relPath,
        name,
        lineMap,
        symbols,
        jsDocComments,
        source,
      );
    },
    "ClassDeclaration:exit"(node: any) {
      const name = node.id?.name;
      if (name && scopeStack[scopeStack.length - 1] === name) {
        scopeStack.pop();
      }
    },

    MethodDefinition(node: any) {
      const name = node.key?.name;
      if (name) scopeStack.push(name);
    },
    "MethodDefinition:exit"(node: any) {
      const name = node.key?.name;
      if (name && scopeStack[scopeStack.length - 1] === name) {
        scopeStack.pop();
      }
    },

    CallExpression(node: any) {
      if (currentFunctionScope) {
        const callee = node.callee;
        if (callee?.type === "Identifier" && /^use[A-Z]/.test(callee.name)) {
          hookCalls.get(currentFunctionScope)?.add(callee.name);
        }
      }
      const caller = currentParent();
      if (!caller) return;
      const callee = node.callee;
      let calleeName: string | null = null;
      if (callee?.type === "Identifier") {
        calleeName = callee.name;
      } else if (callee?.type === "MemberExpression" && callee.property?.name) {
        if (callee.object?.type === "Identifier") {
          calleeName = `${callee.object.name}.${callee.property.name}`;
        } else if (callee.object?.type === "ThisExpression") {
          calleeName = `this.${callee.property.name}`;
        }
      }
      if (calleeName) {
        const scope = currentScope();
        const key = `${scope}>>${calleeName}`;
        if (!seenCalls.has(key)) {
          seenCalls.add(key);
          calls.push({
            file_path: relPath,
            caller_name: caller,
            caller_scope: scope,
            callee_name: calleeName,
          });
        }
      }
    },

    JSXElement() {
      if (currentFunctionScope) jsxScopes.add(currentFunctionScope);
    },
    JSXFragment() {
      if (currentFunctionScope) jsxScopes.add(currentFunctionScope);
    },
  });

  visitor.visit(result.program);

  markers.push(...extractMarkers(source, relPath));

  function maybeAddComponent(name: string, node: any, _isArrow: boolean) {
    if (!isTsx || !/^[A-Z]/.test(name)) return;
    const hooks = hookCalls.get(name);
    const hasJsx = jsxScopes.has(name);
    if (!hasJsx && !(hooks && hooks.size > 0)) return;
    const isDefault = defaultExportedNames.has(name);

    let propsType: string | null = null;
    const params = node?.params;
    if (params?.length > 0) {
      const firstParam = params[0];
      if (firstParam.typeAnnotation?.typeAnnotation) {
        const ta = firstParam.typeAnnotation.typeAnnotation;
        if (ta.type === "TSTypeReference" && ta.typeName?.name) {
          propsType = ta.typeName.name;
        }
      }
    }

    components.push({
      file_path: relPath,
      name,
      props_type: propsType,
      hooks_used: JSON.stringify(hooks ? [...hooks] : []),
      is_default_export: isDefault ? 1 : 0,
    });
  }

  return { symbols, imports, exports, components, markers, typeMembers, calls };
}

function staticImportToRow(
  filePath: string,
  imp: StaticImport,
  lineMap: number[],
): ImportRow {
  const specifiers: string[] = [];
  let isTypeOnly = true;

  for (const entry of imp.entries) {
    if (!entry.isType) isTypeOnly = false;
    const importKind = entry.importName.kind;
    if (importKind === ("Default" as ImportNameKind)) {
      specifiers.push(entry.localName.value);
    } else if (importKind === ("NamespaceObject" as ImportNameKind)) {
      specifiers.push(`* as ${entry.localName.value}`);
    } else if (importKind === ("Name" as ImportNameKind)) {
      const original = entry.importName.name!;
      const local = entry.localName.value;
      specifiers.push(
        original === local ? original : `${original} as ${local}`,
      );
    }
  }

  if (imp.entries.length === 0) {
    isTypeOnly = false; // side-effect import `import "mod"`
  }

  return {
    file_path: filePath,
    source: imp.moduleRequest.value,
    resolved_path: null, // filled later by resolver
    specifiers: JSON.stringify(specifiers),
    is_type_only: isTypeOnly ? 1 : 0,
    line_number: offsetToLine(lineMap, imp.start),
  };
}

function exportEntryToRow(
  filePath: string,
  entry: StaticExportEntry,
): ExportRow {
  const exportName = entry.exportName;
  const isDefault = exportName.kind === ("Default" as ExportExportNameKind);
  const name = isDefault
    ? "default"
    : (exportName.name ?? entry.localName.name ?? "unknown");

  let kind = "value";
  if (entry.isType) kind = "type";
  if (entry.moduleRequest) kind = "re-export";

  return {
    file_path: filePath,
    name,
    kind,
    is_default: isDefault ? 1 : 0,
    re_export_source: entry.moduleRequest?.value ?? null,
  };
}

function stringifyTypeNode(node: any): string | null {
  if (!node) return null;
  switch (node.type) {
    case "TSTypeReference": {
      let name: string | null = null;
      const tn = node.typeName;
      if (tn?.type === "Identifier") name = tn.name;
      else if (typeof tn?.name === "string") name = tn.name;
      else if (tn?.type === "TSQualifiedName")
        name = `${tn.left?.name ?? ""}.${tn.right?.name ?? ""}`;
      if (!name) return null;
      const ta = node.typeArguments ?? node.typeParameters;
      if (ta?.params?.length) {
        const args = ta.params.map(stringifyTypeNode).filter(Boolean);
        if (args.length) return `${name}<${args.join(", ")}>`;
      }
      return name;
    }
    case "TSStringKeyword":
      return "string";
    case "TSNumberKeyword":
      return "number";
    case "TSBooleanKeyword":
      return "boolean";
    case "TSVoidKeyword":
      return "void";
    case "TSNullKeyword":
      return "null";
    case "TSUndefinedKeyword":
      return "undefined";
    case "TSAnyKeyword":
      return "any";
    case "TSNeverKeyword":
      return "never";
    case "TSUnknownKeyword":
      return "unknown";
    case "TSObjectKeyword":
      return "object";
    case "TSBigIntKeyword":
      return "bigint";
    case "TSSymbolKeyword":
      return "symbol";
    case "TSArrayType": {
      const elem = stringifyTypeNode(node.elementType);
      return elem ? `${elem}[]` : null;
    }
    case "TSUnionType": {
      const types = node.types?.map(stringifyTypeNode).filter(Boolean);
      return types?.length ? types.join(" | ") : null;
    }
    case "TSIntersectionType": {
      const types = node.types?.map(stringifyTypeNode).filter(Boolean);
      return types?.length ? types.join(" & ") : null;
    }
    case "TSTupleType": {
      const elems = node.elementTypes?.map(stringifyTypeNode).filter(Boolean);
      return `[${elems?.join(", ") ?? ""}]`;
    }
    case "TSLiteralType": {
      const lit = node.literal;
      if (lit?.type === "StringLiteral") return `"${lit.value}"`;
      if (lit?.type === "NumericLiteral") return String(lit.value);
      if (lit?.type === "BooleanLiteral") return String(lit.value);
      return null;
    }
    case "TSTypeQuery": {
      const exprName = node.exprName;
      const n =
        typeof exprName?.name === "string" ? exprName.name : exprName?.name;
      return n ? `typeof ${n}` : null;
    }
    case "TSTypeOperator": {
      const inner = stringifyTypeNode(node.typeAnnotation);
      return inner ? `${node.operator} ${inner}` : null;
    }
    case "TSThisType":
      return "this";
    default:
      return null;
  }
}

function stringifyTypeParams(typeParameters: any): string {
  const params = typeParameters?.params;
  if (!params?.length) return "";
  const parts = params.map((p: any) => {
    const name = typeof p.name === "string" ? p.name : (p.name?.name ?? "?");
    let s = name;
    if (p.constraint) {
      const c = stringifyTypeNode(p.constraint);
      if (c) s += ` extends ${c}`;
    }
    if (p.default) {
      const d = stringifyTypeNode(p.default);
      if (d) s += ` = ${d}`;
    }
    return s;
  });
  return `<${parts.join(", ")}>`;
}

function buildFunctionSignature(name: string, node: any): string {
  const typeParams = stringifyTypeParams(node?.typeParameters);
  const params = node?.params;
  let paramStr = "";
  if (params?.length) {
    paramStr = params
      .map((p: any) => p.name ?? p.left?.name ?? p.argument?.name ?? "...")
      .join(", ");
  }
  let sig = `${name}${typeParams}(${paramStr})`;
  const returnType = node?.returnType?.typeAnnotation;
  if (returnType) {
    const rt = stringifyTypeNode(returnType);
    if (rt) sig += `: ${rt}`;
  }
  return sig;
}

interface JsDocEntry {
  end: number;
  text: string;
}

function buildJsDocIndex(comments: any[]): JsDocEntry[] {
  if (!comments?.length) return [];
  const docs: JsDocEntry[] = [];
  for (const c of comments) {
    if (c.type !== "Block" || !c.value.startsWith("*")) continue;
    docs.push({ end: c.end, text: cleanJsDoc(c.value) });
  }
  return docs;
}

function cleanJsDoc(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
}

function findJsDoc(
  docs: JsDocEntry[],
  nodeStart: number,
  source: string,
): string | null {
  if (!docs.length) return null;
  let lo = 0;
  let hi = docs.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (docs[mid].end <= nodeStart) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return null;
  const doc = docs[best];
  const gap = source.slice(doc.end, nodeStart);
  if (/[;{}]/.test(gap)) return null;
  return doc.text || null;
}

function extractClassMembers(
  members: any[] | undefined,
  filePath: string,
  className: string,
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
      out.push({
        file_path: filePath,
        name,
        kind,
        line_start: offsetToLine(lineMap, m.start),
        line_end: offsetToLine(lineMap, m.end),
        signature: sig,
        is_exported: 0,
        is_default_export: 0,
        members: null,
        doc_comment: findJsDoc(jsDocComments, m.start, source),
        value: null,
        parent_name: className,
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
      out.push({
        file_path: filePath,
        name,
        kind: "property",
        line_start: offsetToLine(lineMap, m.start),
        line_end: offsetToLine(lineMap, m.end),
        signature: sig,
        is_exported: 0,
        is_default_export: 0,
        members: null,
        doc_comment: findJsDoc(jsDocComments, m.start, source),
        value: extractLiteralValue(m.value),
        parent_name: className,
      });
    }
  }
}

function extractLiteralValue(init: any): string | null {
  if (!init) return null;
  let node = init;
  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") {
    node = node.expression;
  }
  if (node.type === "Literal") {
    return node.value === null ? "null" : String(node.value);
  }
  if (
    node.type === "UnaryExpression" &&
    node.prefix &&
    node.operator === "-" &&
    node.argument?.type === "Literal" &&
    typeof node.argument.value === "number"
  ) {
    return String(-node.argument.value);
  }
  if (
    node.type === "TemplateLiteral" &&
    node.expressions?.length === 0 &&
    node.quasis?.length === 1
  ) {
    return node.quasis[0].value?.cooked ?? null;
  }
  return null;
}

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
