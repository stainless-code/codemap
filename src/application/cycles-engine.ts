/**
 * Detect strongly-connected components in the import dependency graph
 * via Tarjan's SCC. Files in an SCC of size >= 2 form a cycle; size-1
 * SCCs with a self-edge are also cycles. Other size-1 SCCs are filtered
 * out — the table only contains cyclic files.
 *
 * Runs once after the full index pass, reading from `dependencies` and
 * writing to `module_cycles`. O(V + E) — handles 10k+ files in <100ms.
 */

import type { CodemapDatabase, ModuleCycleRow } from "../db";
import { insertModuleCycles } from "../db";

export function computeModuleCycles(db: CodemapDatabase): ModuleCycleRow[] {
  const edges = db
    .query<{ from_path: string; to_path: string }>(
      "SELECT from_path, to_path FROM dependencies",
    )
    .all();

  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from_path);
    nodes.add(e.to_path);
    let list = adj.get(e.from_path);
    if (!list) {
      list = [];
      adj.set(e.from_path, list);
    }
    list.push(e.to_path);
  }

  // Tarjan's SCC — iterative to avoid stack overflow on deep graphs.
  let index = 0;
  const idx = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  // Iterative DFS with a worklist of (node, iter) frames.
  for (const startNode of nodes) {
    if (idx.has(startNode)) continue;
    const work: { node: string; iter: Iterator<string> }[] = [];
    idx.set(startNode, index);
    lowlink.set(startNode, index);
    index++;
    stack.push(startNode);
    onStack.add(startNode);
    work.push({
      node: startNode,
      iter: (adj.get(startNode) ?? [])[Symbol.iterator](),
    });

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const step = frame.iter.next();
      if (step.done) {
        // All successors visited — assign SCC if root.
        if (lowlink.get(frame.node) === idx.get(frame.node)) {
          const scc: string[] = [];
          let popped: string;
          do {
            popped = stack.pop()!;
            onStack.delete(popped);
            scc.push(popped);
          } while (popped !== frame.node);
          sccs.push(scc);
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) {
          // Propagate lowlink up.
          const childLow = lowlink.get(frame.node)!;
          const parentLow = lowlink.get(parent.node)!;
          if (childLow < parentLow) lowlink.set(parent.node, childLow);
        }
        continue;
      }
      const next = step.value;
      if (!idx.has(next)) {
        idx.set(next, index);
        lowlink.set(next, index);
        index++;
        stack.push(next);
        onStack.add(next);
        work.push({
          node: next,
          iter: (adj.get(next) ?? [])[Symbol.iterator](),
        });
      } else if (onStack.has(next)) {
        const cur = lowlink.get(frame.node)!;
        const target = idx.get(next)!;
        if (target < cur) lowlink.set(frame.node, target);
      }
    }
  }

  // Only emit cyclic SCCs: size >= 2, or size-1 with a self-edge.
  const out: ModuleCycleRow[] = [];
  let cycleId = 0;
  for (const scc of sccs) {
    let isCycle = scc.length >= 2;
    if (!isCycle) {
      const only = scc[0]!;
      isCycle = (adj.get(only) ?? []).includes(only);
    }
    if (!isCycle) continue;
    cycleId++;
    for (const f of scc) {
      out.push({ file_path: f, cycle_id: cycleId, cycle_size: scc.length });
    }
  }
  return out;
}

export function persistModuleCycles(db: CodemapDatabase) {
  db.run("DELETE FROM module_cycles");
  const rows = computeModuleCycles(db);
  insertModuleCycles(db, rows);
  return rows.length;
}
