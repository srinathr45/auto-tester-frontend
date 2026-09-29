import { forwardEdges } from './loopGraph';

/**
 * Orders flow nodes start → end by walking forward edges (topological / BFS).
 * Loop "repeat to" back-edges are ignored so cycles do not break ordering.
 */
export function orderNodesByEdges<T extends { id: string }>(
  nodes: T[],
  edges: Array<{ source: string; target: string; sourceHandle?: string | null }>,
): T[] {
  if (!nodes.length) return [];
  const fwd = forwardEdges(edges);
  if (!fwd.length) return [...nodes];

  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    graph.set(n.id, []);
  }

  for (const e of fwd) {
    if (!graph.has(e.source) || !inDegree.has(e.target)) continue;
    graph.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  }

  const queue = nodes.filter((n) => (inDegree.get(n.id) || 0) === 0);
  const result: T[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const neighborId of graph.get(current.id) || []) {
      const next = (inDegree.get(neighborId) || 0) - 1;
      inDegree.set(neighborId, next);
      if (next === 0) {
        const neighbor = nodes.find((n) => n.id === neighborId);
        if (neighbor) queue.push(neighbor);
      }
    }
  }

  if (result.length < nodes.length) {
    for (const n of nodes) {
      if (!result.includes(n)) result.push(n);
    }
  }

  return result;
}
