/** Connection handle ids used on the canvas (React Flow). */
export const HANDLE = {
  IN: 'in',
  OUT: 'out',
  /** Loop-only: back-edge to the first step of the body. */
  REPEAT: 'repeat',
} as const;

export type GraphEdgeLike = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/** True for the Loop → body-start back-edge. */
export function isRepeatEdge(edge: GraphEdgeLike): boolean {
  return edge.sourceHandle === HANDLE.REPEAT;
}

/** Forward (run-order) edges only — excludes loop back-edges. */
export function forwardEdges<T extends GraphEdgeLike>(edges: T[]): T[] {
  return edges.filter((edge) => !isRepeatEdge(edge));
}

/**
 * Walk forward from the Loop's "repeat to" target until the Loop node.
 * Returns body node ids in run order (does not include the Loop itself).
 */
export function resolveLoopBody(
  loopId: string,
  edges: GraphEdgeLike[],
): { bodyIds: string[]; error?: string } {
  const repeat = edges.find((edge) => edge.source === loopId && isRepeatEdge(edge));
  if (!repeat) {
    return { bodyIds: [], error: 'Connect Repeat to the first step you want to loop' };
  }
  if (repeat.target === loopId) {
    return { bodyIds: [], error: 'Repeat to cannot point at the Loop itself' };
  }

  const nextBySource = new Map<string, string>();
  for (const edge of forwardEdges(edges)) {
    if (!nextBySource.has(edge.source)) {
      nextBySource.set(edge.source, edge.target);
    }
  }

  const bodyIds: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = repeat.target;

  while (cur && cur !== loopId) {
    if (seen.has(cur)) {
      return { bodyIds: [], error: 'Loop body cycles without returning to the Loop step' };
    }
    seen.add(cur);
    bodyIds.push(cur);
    cur = nextBySource.get(cur);
  }

  if (cur !== loopId) {
    return {
      bodyIds: [],
      error: 'Repeat-to target does not lead forward into this Loop step',
    };
  }

  return { bodyIds };
}
