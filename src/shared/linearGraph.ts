import { HANDLE, isRepeatEdge } from './loopGraph';

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

function forwardEdge(source: string, target: string): GraphEdge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle: HANDLE.OUT,
    targetHandle: HANDLE.IN,
  };
}

/**
 * Rebuild edges as a simple linear chain (top → bottom order).
 * Positions are stacked vertically. Used for brand-new flows only.
 */
export function linearizeGraph<
  TNode extends { id: string; position?: { x: number; y: number } },
>(nodes: TNode[]): { nodes: TNode[]; edges: GraphEdge[] } {
  const nextNodes = nodes.map((node, index) => ({
    ...node,
    position: { x: 80, y: 40 + index * 140 },
  }));
  const edges = nextNodes.slice(0, -1).map((node, index) =>
    forwardEdge(node.id, nextNodes[index + 1].id),
  );
  return { nodes: nextNodes, edges };
}

/**
 * Append a step to the end of the run chain without moving existing nodes.
 * lastId is the current tail (from orderFlowNodes); omit when the graph is empty.
 */
export function appendLinearNode<TNode extends { id: string }>(
  nodes: TNode[],
  edges: GraphEdge[],
  newNode: TNode,
  lastId?: string,
): { nodes: TNode[]; edges: GraphEdge[] } {
  const nextEdges =
    lastId != null ? [...edges, forwardEdge(lastId, newNode.id)] : edges;
  return { nodes: [...nodes, newNode], edges: nextEdges };
}

/**
 * Drop a node and stitch its forward neighbors so A → B → C becomes A → C.
 * Repeat back-edges involving the deleted node are dropped (not re-stitched).
 * Other node positions stay as the user placed them on the canvas.
 */
export function removeAndReconnect<TNode extends { id: string }>(
  nodes: TNode[],
  edges: GraphEdge[],
  nodeId: string,
): { nodes: TNode[]; edges: GraphEdge[] } {
  const incoming = edges.filter((edge) => edge.target === nodeId && !isRepeatEdge(edge));
  const outgoing = edges.filter((edge) => edge.source === nodeId && !isRepeatEdge(edge));
  const remainingNodes = nodes.filter((node) => node.id !== nodeId);
  const remainingEdges = edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
  const extras: GraphEdge[] = [];
  for (const pred of incoming) {
    for (const succ of outgoing) {
      if (pred.source === succ.target) continue;
      const exists = remainingEdges.some(
        (edge) =>
          edge.source === pred.source &&
          edge.target === succ.target &&
          !isRepeatEdge(edge),
      );
      if (exists) continue;
      extras.push(forwardEdge(pred.source, succ.target));
    }
  }
  return { nodes: remainingNodes, edges: [...remainingEdges, ...extras] };
}

export type FlowLayoutOrientation = 'vertical' | 'horizontal';

const VERTICAL_GAP = 140;
const HORIZONTAL_GAP = 300;

/**
 * Stack ordered nodes top→bottom (shared x) or left→right (shared y).
 * Edges are left unchanged; only positions move.
 */
export function alignFlowNodes<
  TNode extends { id: string; position: { x: number; y: number } },
>(ordered: TNode[], orientation: FlowLayoutOrientation): TNode[] {
  if (ordered.length === 0) return ordered;
  const originX = ordered[0].position?.x ?? 80;
  const originY = ordered[0].position?.y ?? 40;
  return ordered.map((node, index) => ({
    ...node,
    position:
      orientation === 'vertical'
        ? { x: originX, y: originY + index * VERTICAL_GAP }
        : { x: originX + index * HORIZONTAL_GAP, y: originY },
  }));
}
