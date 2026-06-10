import type { Comment, VisitorObject } from "oxc-parser";

import type {
  CallRow,
  ComponentRow,
  DynamicImportRow,
  ExportRow,
  FunctionParamRow,
  ImportRow,
  MarkerRow,
  ReferenceRow,
  RuntimeMarkerRow,
  SymbolRow,
  TestSuiteRow,
  TypeMemberRow,
  TypeHeritageRow,
} from "../db";
import type {
  ParsedAsyncCall,
  ParsedDecorator,
  ParsedJsdocTag,
  ParsedTryCatch,
} from "./behavioral";
import type { ParsedJsxAttribute, ParsedJsxElement } from "./jsx";

/**
 * Tier opt-out config key per [R.15](../../docs/plans/substrate-extraction.md).
 * Typed as `string` (not a union) so tier PRs extend the set without
 * coupling to a single literal type; the Zod schema in `config.ts` is the
 * runtime validator.
 */
export type ExtractionTierId = string;

/**
 * `symbolsExtractor`'s enter handlers call `enter(name)` for PascalCase
 * candidates; `componentsExtractor` owns JSX + hook recording and emits
 * the `ComponentRow` at exit.
 */
export interface ComponentDetector {
  enter(name: string): void;
  current(): string | null;
  exit(): void;
  markJsx(): void;
  recordHook(hookName: string): void;
  hasJsxOrHooks(name: string): boolean;
  /** Insertion-ordered hook names recorded for `name`. */
  hooksFor(name: string): readonly string[];
}

/**
 * Cyclomatic complexity (McCabe: CC = 1 + #decision points).
 *
 * `pushFor(symbolIndex)` on function-shape enter; `increment()` per
 * branch; `popTop()` on exit writes back to `symbols[symbolIndex]`.
 * `symbolIndex = -1` = anonymous (callbacks, IIFEs) — counted but
 * never persisted so branches don't bleed into the outer scope.
 *
 * `markArrowSymbol(node, idx)` / `getArrowSymbol(node)` O(1) symbol index
 * by function-shaped AST node (WeakMap). Arrows: row at `VariableDeclaration`,
 * counter at `ArrowFunctionExpression`. `FunctionDeclaration`: row at enter,
 * hash at exit — same map after `pushParams` would make `length - 1` wrong.
 */
export interface ComplexityTracker {
  pushFor(symbolIndex: number): void;
  popTop(): void;
  increment(): void;
  /** Enter a nesting-bearing block (if/for/while/ternary/try). Updates current+max depth. */
  enterNest(): void;
  /** Exit a nesting-bearing block. */
  exitNest(): void;
  markArrowSymbol(node: object, symbolIndex: number): void;
  getArrowSymbol(node: object): number | undefined;
  /** Sonar structural break (+1 + current cognitive nesting). */
  cognitiveStructural(opts?: { elseIf?: boolean }): void;
  /** Flat +1 (switch case, boolean operator) — no nesting penalty. */
  cognitiveFlat(): void;
  /** Enter cognitive nesting scope (paired with exitCognitiveNest). */
  enterCognitiveNest(): void;
  /** Exit cognitive nesting scope. */
  exitCognitiveNest(): void;
}

/**
 * Lexical scope stack (parent_name in `symbols`, caller_scope in `calls`,
 * scope_local_id in `references`). `scopesExtractor` owns MethodDefinition;
 * other extractors call `push`/`pop` inline. Records each push as a `ScopeRow`.
 */
export interface ScopeTracker {
  push(
    name: string,
    kind?:
      | "function"
      | "arrow"
      | "class"
      | "method"
      | "interface"
      | "type-alias"
      | "for"
      | "catch",
    lineStart?: number,
    lineEnd?: number,
  ): void;
  pop(): void;
  /** Innermost named scope, or `null` at module top level. */
  currentParent(): string | null;
  /** Dot-joined path outermost→innermost, e.g. `"OuterClass.method.foo"`. */
  currentScope(): string;
  top(): string | undefined;
  /** Per-file scope id of the innermost scope. `0` = module scope. */
  currentLocalId(): number;
  /** Set the module-scope owner once the file's last line is known. */
  finaliseModule(lineEnd: number): void;
  /** All recorded scope rows for the file, in insertion order. */
  getRecorded(): readonly import("../db").ScopeRow[];
}

/**
 * Per-file context passed to every extractor's `register()`. Inputs are
 * immutable; output sinks are appended by visitor handlers. Per-extractor
 * state lives in each extractor's own closure — only state genuinely
 * shared across extractors lives here.
 */
export interface ExtractContext {
  readonly filePath: string;
  readonly relPath: string;
  readonly source: string;
  readonly lang: "ts" | "tsx" | "js" | "jsx";
  readonly isTsx: boolean;
  readonly lineMap: number[];
  readonly comments: readonly Comment[];
  readonly exportedNames: ReadonlySet<string>;
  readonly defaultExportedNames: ReadonlySet<string>;

  readonly symbols: SymbolRow[];
  readonly imports: ImportRow[];
  readonly exports: ExportRow[];
  readonly components: ComponentRow[];
  readonly markers: MarkerRow[];
  readonly typeMembers: TypeMemberRow[];
  readonly typeHeritage: TypeHeritageRow[];
  readonly calls: CallRow[];
  readonly references: ReferenceRow[];
  readonly functionParams: FunctionParamRow[];
  readonly runtimeMarkers: RuntimeMarkerRow[];
  readonly testSuites: TestSuiteRow[];
  readonly dynamicImports: DynamicImportRow[];

  readonly jsxElements: ParsedJsxElement[];
  readonly jsxAttributes: ParsedJsxAttribute[];
  readonly asyncCalls: ParsedAsyncCall[];
  readonly tryCatchRows: ParsedTryCatch[];
  readonly decorators: ParsedDecorator[];
  readonly jsdocTags: ParsedJsdocTag[];

  /** When true, module-level CallExpression / AssignmentExpression seen. */
  moduleHasSideEffects: boolean;

  readonly scopes: ScopeTracker;
  readonly complexity: ComplexityTracker;
  // Named `componentDetector` (not `components`) to avoid clashing with
  // the `components: ComponentRow[]` output array.
  readonly componentDetector: ComponentDetector;
  /**
   * AST nodes whose scope has been pushed by their owning extractor.
   * Function-shape extractors (Function/Class/Method/named arrow) mark
   * their node here; arrowScopesExtractor uses it to detect orphan
   * callback arrows that still need a scope.
   */
  readonly claimedScopeNodes: WeakSet<object>;
  /** Variable-declarator arrow/function inits: scope pushes on enter, not at declaration. */
  readonly declaratorArrowScopes: WeakMap<
    object,
    { name: string; lineStart: number; lineEnd: number }
  >;
}

/**
 * One file per tier under `src/extractors/`. `register()` attaches
 * node-type handlers + sets up per-file state in its closure. Multiple
 * extractors on the same node type chain in registration order. Optional
 * `finalize()` runs after the visit — used by `markersExtractor` for the
 * regex pass over raw source.
 */
export interface TierExtractor {
  readonly tierId: ExtractionTierId;
  register(visitor: VisitorObject, ctx: ExtractContext): void;
  finalize?(ctx: ExtractContext): void;
}
