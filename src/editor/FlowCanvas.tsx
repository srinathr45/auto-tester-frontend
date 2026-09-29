import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  Code2,
  Plus,
  Trash2,
} from 'lucide-react';
import { nodeTypes } from '../steps/nodeTypes';
import { alignFlowNodes, type FlowLayoutOrientation } from '../shared/linearGraph';
import { HANDLE, isRepeatEdge } from '../shared/loopGraph';
import { orderFlowNodes } from '../shared/orderNodes';
import { resolveStepKind, stepKindOption, STEP_KIND_OPTIONS } from '../shared/stepKinds';
import { useTheme } from '../theme/ThemeProvider';
import type { FlowEdge, FlowNode, StepKind } from '../shared/types';

export interface GraphChangeOptions {
  history?: boolean;
}

export type GraphRecipe = (prev: {
  nodes: FlowNode[];
  edges: FlowEdge[];
}) => {
  nodes: FlowNode[];
  edges: FlowEdge[];
};

type MenuPoint = { x: number; y: number };

interface FlowCanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  highlightedNodeId?: string | null;
  /** False when another floating panel covers the canvas (e.g. maximized inspector). */
  canvasActive?: boolean;
  onSelectNode: (id: string | null) => void;
  onGraphChange: (recipe: GraphRecipe, options?: GraphChangeOptions) => void;
  onAddStep: (kind: StepKind) => void;
  onDeleteNode: (nodeId: string) => void;
  onEditScript: (nodeId: string) => void;
}

const MIN_CANVAS_PX = 80;

/**
 * React Flow canvas with a steps list on the left.
 * Right-click empty canvas opens the step-type wheel; left-click clears selection.
 */
function FlowCanvasInner({
  nodes,
  edges,
  selectedNodeId,
  highlightedNodeId,
  canvasActive = true,
  onSelectNode,
  onGraphChange,
  onAddStep,
  onDeleteNode,
  onEditScript,
}: FlowCanvasProps) {
  const { theme } = useTheme();
  const { fitView, setCenter, getNode } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const lastSizeRef = useRef({ w: 0, h: 0 });
  const didInitialFit = useRef(false);
  const wasActiveRef = useRef(canvasActive);
  const draggingRef = useRef(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [flowDir, setFlowDir] = useState<FlowLayoutOrientation>('vertical');
  const [wheel, setWheel] = useState<MenuPoint | null>(null);
  const [nodeMenu, setNodeMenu] = useState<(MenuPoint & { nodeId: string }) | null>(null);

  const ordered = useMemo(() => orderFlowNodes(nodes, edges), [nodes, edges]);

  const canvasNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        // Steps are deleted only via our Delete action — not Backspace on the canvas.
        deletable: false,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          __highlighted: node.id === highlightedNodeId,
          __flowDir: flowDir,
        },
      })),
    [nodes, selectedNodeId, highlightedNodeId, flowDir],
  );

  const canvasEdges = useMemo(
    () =>
      edges.map((edge) => {
        const repeat = isRepeatEdge(edge);
        return {
          ...edge,
          type: 'smoothstep' as const,
          // Only the Repeat back-edge is user-removable (select + Delete).
          deletable: repeat,
          animated:
            repeat ||
            edge.source === highlightedNodeId ||
            edge.target === highlightedNodeId,
          label: repeat ? 'repeat' : undefined,
          className: repeat ? 'flow-edge-repeat' : undefined,
          style: repeat
            ? { stroke: 'var(--accent-amber, #d97706)', strokeWidth: 1.5 }
            : undefined,
        };
      }),
    [edges, highlightedNodeId],
  );

  const isCanvasSized = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return false;
    const { width, height } = el.getBoundingClientRect();
    return width >= MIN_CANVAS_PX && height >= MIN_CANVAS_PX;
  }, []);

  /** Never fitView on a 0×0 / tiny pane — that blanks the graph viewport. */
  const safeFitView = useCallback(
    (options?: Parameters<typeof fitView>[0]) => {
      if (draggingRef.current) return false;
      if (!isCanvasSized() || nodes.length === 0) return false;
      void fitView({ padding: 0.24, duration: 180, ...options });
      return true;
    },
    [fitView, isCanvasSized, nodes.length],
  );

  const closeOverlays = useCallback(() => {
    setAddMenuOpen(false);
    setWheel(null);
    setNodeMenu(null);
  }, []);

  useEffect(() => {
    if (!addMenuOpen && !wheel && !nodeMenu) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (addMenuRef.current?.contains(target)) return;
      const overlay = (event.target as HTMLElement)?.closest?.('.flow-overlay-menu');
      if (overlay) return;
      closeOverlays();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Let the workbench handle Esc for maximize restore when no overlay is open.
      closeOverlays();
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [addMenuOpen, wheel, nodeMenu, closeOverlays]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let timer: number | undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const prev = lastSizeRef.current;
      const usable = width >= MIN_CANVAS_PX && height >= MIN_CANVAS_PX;
      const grewALot =
        usable && (width > prev.w + 80 || height > prev.h + 80) && width > 120 && height > 120;
      // Detect recovery from a collapsed / zero-size pane (common after overlay maximize).
      const recoveredFromTiny =
        usable && (prev.w < MIN_CANVAS_PX || prev.h < MIN_CANVAS_PX);
      lastSizeRef.current = { w: width, h: height };
      if ((!grewALot && !recoveredFromTiny) || nodes.length === 0) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        safeFitView({ duration: 180 });
      }, 120);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [safeFitView, nodes.length]);

  useEffect(() => {
    if (nodes.length === 0) {
      didInitialFit.current = false;
      return;
    }
    if (didInitialFit.current) return;
    const timer = window.setTimeout(() => {
      if (safeFitView({ duration: 180 })) {
        didInitialFit.current = true;
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [nodes.length, safeFitView]);

  // After Edit script / other panel maximize covers the canvas, refit when uncovered.
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = canvasActive;
    if (!canvasActive || wasActive) return;
    const timer = window.setTimeout(() => {
      safeFitView({ duration: 200 });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [canvasActive, safeFitView]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Ignore RF removals — steps are deleted only via our Delete action.
      const safeChanges = changes.filter((change) => change.type !== 'remove');
      if (safeChanges.length === 0) return;

      const dragEnded = safeChanges.some(
        (change) => change.type === 'position' && change.dragging === false,
      );
      const dragging = safeChanges.some(
        (change) => change.type === 'position' && change.dragging === true,
      );
      if (dragging) draggingRef.current = true;
      if (dragEnded) draggingRef.current = false;

      onGraphChange(
        ({ nodes: prev, edges: prevEdges }) => ({
          nodes: applyNodeChanges(safeChanges, prev) as FlowNode[],
          edges: prevEdges,
        }),
        // Don't spam undo history while dragging; commit once on drop.
        { history: Boolean(dragEnded && !dragging) },
      );
    },
    [onGraphChange],
  );

  const pointInCanvas = (clientX: number, clientY: number): MenuPoint | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const focusNode = useCallback(
    (nodeId: string) => {
      onSelectNode(nodeId);
      closeOverlays();
      requestAnimationFrame(() => {
        if (!isCanvasSized()) return;
        // Prefer fitting the node — recovers from a broken viewport better than setCenter alone.
        const fitted = safeFitView({
          nodes: [{ id: nodeId }],
          padding: 0.45,
          duration: 220,
          maxZoom: 1.15,
        });
        if (fitted) return;
        const node = getNode(nodeId);
        if (!node) return;
        const w = node.measured?.width ?? 240;
        const h = node.measured?.height ?? 80;
        void setCenter(node.position.x + w / 2, node.position.y + h / 2, {
          zoom: 1,
          duration: 220,
        });
      });
    },
    [onSelectNode, closeOverlays, getNode, setCenter, isCanvasSized, safeFitView],
  );

  const handleAlign = (orientation: FlowLayoutOrientation) => {
    closeOverlays();
    onGraphChange(({ nodes: prevNodes, edges: prevEdges }) => {
      const nextOrdered = orderFlowNodes(prevNodes, prevEdges);
      return { nodes: alignFlowNodes(nextOrdered, orientation), edges: prevEdges };
    });
    setFlowDir(orientation);
    requestAnimationFrame(() => {
      safeFitView({ duration: 220 });
    });
  };

  const pickKind = (kind: StepKind) => {
    onAddStep(kind);
    closeOverlays();
  };

  /** Only the Loop "repeat" handle may start a user-drawn connection. */
  const isValidConnection = useCallback((connection: Connection | FlowEdge) => {
    if (connection.sourceHandle !== HANDLE.REPEAT) return false;
    if (!connection.source || !connection.target) return false;
    if (connection.source === connection.target) return false;
    return true;
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) return;
      const source = connection.source!;
      const target = connection.target!;
      onGraphChange(({ nodes: prevNodes, edges: prevEdges }) => {
        const withoutOld = prevEdges.filter(
          (edge) => !(edge.source === source && isRepeatEdge(edge)),
        );
        return {
          nodes: prevNodes,
          edges: [
            ...withoutOld,
            {
              id: `e-repeat-${source}-${target}`,
              source,
              target,
              sourceHandle: HANDLE.REPEAT,
              targetHandle: HANDLE.IN,
            },
          ],
        };
      });
    },
    [isValidConnection, onGraphChange],
  );

  const onEdgesDelete = useCallback(
    (deleted: FlowEdge[]) => {
      const ids = new Set(deleted.map((edge) => edge.id));
      onGraphChange(({ nodes: prevNodes, edges: prevEdges }) => ({
        nodes: prevNodes,
        edges: prevEdges.filter((edge) => !ids.has(edge.id)),
      }));
    },
    [onGraphChange],
  );

  return (
    <div className="editor-col">
      <div className="editor-col-header">
        <span>Flow</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className="btn-icon"
            style={{ width: 26, height: 26 }}
            onClick={() => handleAlign('vertical')}
            title="Align vertical"
            disabled={nodes.length < 2}
          >
            <AlignVerticalSpaceAround size={12} />
          </button>
          <button
            className="btn-icon"
            style={{ width: 26, height: 26 }}
            onClick={() => handleAlign('horizontal')}
            title="Align horizontal"
            disabled={nodes.length < 2}
          >
            <AlignHorizontalSpaceAround size={12} />
          </button>
          <div ref={addMenuRef} style={{ position: 'relative' }}>
            <button
              className="btn-secondary"
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}
              onClick={() => {
                setWheel(null);
                setNodeMenu(null);
                setAddMenuOpen((open) => !open);
              }}
            >
              <Plus size={12} />
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="flow-workarea">
        <aside className="flow-steps-rail" aria-label="Steps list">
          <div className="flow-steps-rail-title">Steps</div>
          <div className="flow-steps-rail-list">
            {ordered.length === 0 && (
              <div className="flow-steps-rail-empty">No steps yet</div>
            )}
            {ordered.map((node, index) => {
              const kind = resolveStepKind(node.data);
              const kindLabel = stepKindOption(kind).menuLabel;
              const selected = node.id === selectedNodeId;
              const running = node.id === highlightedNodeId;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`flow-steps-rail-item${selected ? ' is-selected' : ''}${
                    running ? ' is-running' : ''
                  }`}
                  onClick={() => focusNode(node.id)}
                  title={node.data.label || 'Step'}
                >
                  <span className="flow-steps-rail-index">{index + 1}</span>
                  <span className="flow-steps-rail-text">
                    <span className="flow-steps-rail-name">{node.data.label || 'Step'}</span>
                    <span className="flow-steps-rail-kind">{kindLabel}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div ref={canvasRef} className="flow-canvas">
          <ReactFlow
            nodes={canvasNodes}
            edges={canvasEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onEdgesDelete={onEdgesDelete}
            onNodeClick={(event, node) => {
              event.stopPropagation();
              const point = pointInCanvas(event.clientX, event.clientY);
              onSelectNode(node.id);
              setAddMenuOpen(false);
              setWheel(null);
              if (point) setNodeMenu({ ...point, nodeId: node.id });
            }}
            onPaneClick={() => {
              onSelectNode(null);
              closeOverlays();
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              onSelectNode(null);
              setAddMenuOpen(false);
              setNodeMenu(null);
              const point = pointInCanvas(event.clientX, event.clientY);
              if (point) setWheel(point);
            }}
            onNodeContextMenu={(event) => {
              // Keep browser menu off nodes; use left-click node menu instead.
              event.preventDefault();
            }}
            nodesConnectable
            edgesFocusable
            elementsSelectable
            deleteKeyCode={['Backspace', 'Delete']}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: false }}
            colorMode={theme}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>

          {nodes.length === 0 && !wheel && !addMenuOpen && (
            <div className="flow-canvas-empty">
              Right-click empty canvas or use Add to create a step.
            </div>
          )}

          {addMenuOpen && (
            <div className="flow-overlay-menu flow-add-menu" role="menu">
              <div className="flow-add-menu-title">Add step</div>
              {STEP_KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  className="flow-menu-item"
                  onClick={() => pickKind(opt.kind)}
                >
                  <span className="flow-menu-item-label">{opt.menuLabel}</span>
                  <span className="flow-menu-item-desc">{opt.description}</span>
                </button>
              ))}
            </div>
          )}

          {wheel && (
            <div
              className="flow-overlay-menu flow-step-wheel"
              style={{ left: wheel.x, top: wheel.y }}
              role="menu"
            >
              <div className="flow-step-wheel-center" aria-hidden>
                <Plus size={14} />
              </div>
              {STEP_KIND_OPTIONS.map((opt, index) => {
                const angle = (index / STEP_KIND_OPTIONS.length) * Math.PI * 2 - Math.PI / 2;
                const radius = 78;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                return (
                  <button
                    key={opt.kind}
                    type="button"
                    className="flow-step-wheel-item"
                    style={{ transform: `translate(${x}px, ${y}px)` }}
                    title={opt.description}
                    onClick={() => pickKind(opt.kind)}
                  >
                    {opt.menuLabel}
                  </button>
                );
              })}
            </div>
          )}

          {nodeMenu && (
            <div
              className="flow-overlay-menu flow-node-menu"
              style={{ left: nodeMenu.x, top: nodeMenu.y }}
              role="menu"
            >
              <button
                type="button"
                className="flow-menu-item"
                onClick={() => {
                  onEditScript(nodeMenu.nodeId);
                  closeOverlays();
                }}
              >
                <Code2 size={13} />
                <span>
                  {resolveStepKind(nodes.find((n) => n.id === nodeMenu.nodeId)?.data) === 'loop'
                    ? 'Edit navigate back'
                    : 'Edit script'}
                </span>
              </button>
              <button
                type="button"
                className="flow-menu-item is-danger"
                onClick={() => {
                  onDeleteNode(nodeMenu.nodeId);
                  closeOverlays();
                }}
              >
                <Trash2 size={13} />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
