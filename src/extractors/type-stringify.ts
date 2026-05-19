/**
 * Type stringification — oxc AST type nodes → source-text-ish strings
 * for `symbols.signature`. Returns `null` on unsupported shapes so
 * callers can omit the annotation. Tier 4 will reuse `stringifyTypeNode`
 * for `function_params.type_text` / `generic_params.constraint_text`.
 */

/**
 * Resolve a TSQualifiedName chain to its full dot-joined identifier.
 * `tn.left` is itself a TSQualifiedName for ≥3-segment chains (`A.B.C`).
 */
function qualifiedNameOf(tn: any): string | null {
  if (!tn) return null;
  if (tn.type === "Identifier") return tn.name;
  if (typeof tn.name === "string") return tn.name;
  if (tn.type === "TSQualifiedName") {
    const left = qualifiedNameOf(tn.left);
    const right = tn.right?.name;
    if (!left || !right) return null;
    return `${left}.${right}`;
  }
  return null;
}

export function stringifyTypeNode(node: any): string | null {
  if (!node) return null;
  switch (node.type) {
    case "TSTypeReference": {
      const name = qualifiedNameOf(node.typeName);
      if (!name) return null;
      const ta = node.typeArguments ?? node.typeParameters;
      if (ta?.params?.length) {
        const args = ta.params.map(stringifyTypeNode).filter(Boolean);
        if (args.length) return `${name}<${args.join(", ")}>`;
      }
      return name;
    }
    case "TSStringKeyword": {
      return "string";
    }
    case "TSNumberKeyword": {
      return "number";
    }
    case "TSBooleanKeyword": {
      return "boolean";
    }
    case "TSVoidKeyword": {
      return "void";
    }
    case "TSNullKeyword": {
      return "null";
    }
    case "TSUndefinedKeyword": {
      return "undefined";
    }
    case "TSAnyKeyword": {
      return "any";
    }
    case "TSNeverKeyword": {
      return "never";
    }
    case "TSUnknownKeyword": {
      return "unknown";
    }
    case "TSObjectKeyword": {
      return "object";
    }
    case "TSBigIntKeyword": {
      return "bigint";
    }
    case "TSSymbolKeyword": {
      return "symbol";
    }
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
    case "TSThisType": {
      return "this";
    }
    default: {
      return null;
    }
  }
}

export function stringifyTypeParams(typeParameters: any): string {
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

export function buildFunctionSignature(name: string, node: any): string {
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

/** Structured function-shape columns for Tier 4 (`symbols.return_type`, etc.). */
export function functionShapeColumns(node: any): {
  return_type: string | null;
  is_async: number;
  is_generator: number;
} {
  const returnType = node?.returnType?.typeAnnotation;
  const rt = returnType ? stringifyTypeNode(returnType) : null;
  return {
    return_type: rt,
    is_async: node?.async ? 1 : 0,
    is_generator: node?.generator ? 1 : 0,
  };
}

/**
 * Literal initialiser → string for `symbols.value`. Unwraps
 * `TSAsExpression` / `TSSatisfiesExpression`; handles unary `-N` and
 * interpolation-free template literals; returns `null` otherwise.
 */
export function extractLiteralValue(init: any): string | null {
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
