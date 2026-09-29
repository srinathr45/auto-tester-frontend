import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { PanelBottom } from 'lucide-react';
import FloatingPanel, { defaultWorkbenchRects, type PanelRect } from './FloatingPanel';
import PopOutDialog, { ConfirmDialog } from './PopOutDialog';
import InputWaitPauseDialog from './InputWaitPauseDialog';
import FlowCanvas, { type GraphChangeOptions, type GraphRecipe } from './FlowCanvas';
import PreviewPanel, { PreviewHeaderActions } from './PreviewPanel';
import InspectorColumn from './InspectorColumn';
import RecordingPanel from './RecordingPanel';
import { removeAndReconnect } from '../shared/linearGraph';
import { HANDLE, isRepeatEdge } from '../shared/loopGraph';
import type { Flow, FlowEdge, FlowNode, Project, Result, StepData, StepKind } from '../shared/types';

export type RFNode = FlowNode;
export type RFEdge = FlowEdge;

type MaximizeMode = 'none' | 'canvas' | 'inspector' | 'preview';

const VIS_KEY = {
  canvas: 'editor-float-canvas-visible',
  preview: 'editor-float-preview-visible',
  inspector: 'editor-float-inspector-visible',
} as const;

function loadVisible(key: string, fallback = true): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1' || raw === 'true';
  } catch {
    return fallback;
  }
}

function saveVisible(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore
  }
}

export type WorkbenchPanelId = 'canvas' | 'preview' | 'inspector';

export type WorkbenchPanelVisibility = Record<WorkbenchPanelId, boolean>;

export interface FlowEditorHandle {
  /**
   * Prepare Preview for a Run.
   * - Preview closed → auto pop-out, then proceed
   * - Preview docked → ask to pop out (Yes/No/Cancel)
   * - Already popped out → proceed
   * @returns false if the user cancelled
   */
  prepareForRun: () => Promise<boolean>;
  setPanelVisible: (panel: WorkbenchPanelId, visible: boolean) => void;
}

interface FlowEditorProps {
  nodes: RFNode[];
  edges: RFEdge[];
  selectedFlow: Flow | null;
  selectedProject: Project | null;
  selectedNodeId: string | null;
  highlightedNodeId?: string | null;
  setSelectedNodeId: (id: string | null) => void;
  onGraphChange: (recipe: GraphRecipe, options?: GraphChangeOptions) => void;
  onAddStep: (kind: StepKind) => void;
  activeResultId: number | null;
  onCloseRunPanel: () => void;
  onRunProgress: (result: Result) => void;
  onPanelVisibilityChange?: (visibility: WorkbenchPanelVisibility) => void;
}

/**
 * Floating workbench: Canvas, Preview, and Inspector as move/resize windows.
 * Preview and Capture can pop out into dialogs (docked panel hidden while open).
 */
const FlowEditor = forwardRef<FlowEditorHandle, FlowEditorProps>(function FlowEditor(
  {
    nodes,
    edges,
    selectedFlow,
    selectedProject,
    selectedNodeId,
    highlightedNodeId,
    setSelectedNodeId,
    onGraphChange,
    onAddStep,
    activeResultId,
    onCloseRunPanel,
    onRunProgress,
    onPanelVisibilityChange,
  },
  ref,
) {
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;
  const workbenchRef = useRef<HTMLDivElement>(null);
  const zCounter = useRef(40);

  const [defaults, setDefaults] = useState<{
    canvas: PanelRect;
    preview: PanelRect;
    inspector: PanelRect;
  } | null>(null);

  useEffect(() => {
    const el = workbenchRef.current;
    if (!el) return;
    const apply = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (w > 100 && h > 100) {
        setDefaults(defaultWorkbenchRects({ w, h }));
      }
    };
    apply();
    const ro = new ResizeObserver(() => {
      // Only seed defaults once; panels persist their own rects after that.
      setDefaults((prev) => prev ?? defaultWorkbenchRects({
        w: el.clientWidth,
        h: el.clientHeight,
      }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [canvasVisible, setCanvasVisible] = useState(() => loadVisible(VIS_KEY.canvas, true));
  const [previewVisible, setPreviewVisible] = useState(() => loadVisible(VIS_KEY.preview, true));
  const [inspectorVisible, setInspectorVisible] = useState(() => loadVisible(VIS_KEY.inspector, true));
  const [previewPoppedOut, setPreviewPoppedOut] = useState(false);
  const [capturePoppedOut, setCapturePoppedOut] = useState(false);
  const [captureDocked, setCaptureDocked] = useState(false);
  const [captureAskOpen, setCaptureAskOpen] = useState(false);
  const [previewLive, setPreviewLive] = useState(false);
  const [maximizeMode, setMaximizeMode] = useState<MaximizeMode>('none');
  const [zMap, setZMap] = useState({ canvas: 31, preview: 32, inspector: 33 });

  const [runAskOpen, setRunAskOpen] = useState(false);
  const runAskResolver = useRef<((value: boolean) => void) | null>(null);

  const showDockedPreview = previewVisible && !previewPoppedOut && !capturePoppedOut;

  const focusPanel = useCallback((id: 'canvas' | 'preview' | 'inspector') => {
    // Keep floats below the toolbar (z=200) so View menu never ends up behind panels.
    zCounter.current = Math.min(zCounter.current + 1, 80);
    const next = zCounter.current;
    setZMap((prev) => ({ ...prev, [id]: next }));
  }, []);

  const setVisible = useCallback(
    (panel: WorkbenchPanelId, value: boolean) => {
      saveVisible(VIS_KEY[panel], value);
      if (panel === 'canvas') setCanvasVisible(value);
      if (panel === 'preview') {
        setPreviewVisible(value);
        if (!value) setPreviewPoppedOut(false);
      }
      if (panel === 'inspector') setInspectorVisible(value);
      if (!value && maximizeMode === panel) setMaximizeMode('none');
    },
    [maximizeMode],
  );

  // Preview counts as shown when docked or popped out.
  useEffect(() => {
    onPanelVisibilityChange?.({
      canvas: canvasVisible,
      preview: previewVisible || previewPoppedOut,
      inspector: inspectorVisible,
    });
  }, [
    canvasVisible,
    previewVisible,
    previewPoppedOut,
    inspectorVisible,
    onPanelVisibilityChange,
  ]);

  const restoreWorkbench = useCallback(() => {
    setMaximizeMode('none');
  }, []);

  const toggleMaximize = useCallback(
    (mode: Exclude<MaximizeMode, 'none'>) => {
      setMaximizeMode((prev) => (prev === mode ? 'none' : mode));
      focusPanel(mode === 'canvas' ? 'canvas' : mode === 'preview' ? 'preview' : 'inspector');
    },
    [focusPanel],
  );

  const openPreviewPopOut = useCallback(() => {
    setPreviewPoppedOut(true);
    setPreviewVisible(true);
    saveVisible(VIS_KEY.preview, true);
    if (maximizeMode === 'preview') setMaximizeMode('none');
  }, [maximizeMode]);

  const dockPreview = useCallback(() => {
    setPreviewPoppedOut(false);
    setPreviewVisible(true);
    saveVisible(VIS_KEY.preview, true);
  }, []);

  const closePreviewPopOut = useCallback(() => {
    setPreviewPoppedOut(false);
    setPreviewVisible(true);
    saveVisible(VIS_KEY.preview, true);
  }, []);

  const requestCapture = useCallback(() => {
    if (!selectedNode) return;
    if (capturePoppedOut || captureDocked) return;
    setCaptureAskOpen(true);
  }, [selectedNode, capturePoppedOut, captureDocked]);

  const ensurePreview = useCallback(() => {
    setVisible('preview', true);
    focusPanel('preview');
  }, [setVisible, focusPanel]);

  const openCapturePopup = useCallback(() => {
    setCaptureAskOpen(false);
    // Defer mount so the confirm portal finishes unmounting (avoids click-through closing).
    window.setTimeout(() => {
      setCaptureDocked(false);
      setCapturePoppedOut(true);
      setVisible('preview', true);
      setVisible('inspector', true);
      if (previewPoppedOut) setPreviewPoppedOut(false);
      focusPanel('preview');
    }, 0);
  }, [setVisible, previewPoppedOut, focusPanel]);

  const openCaptureDocked = useCallback(() => {
    setCaptureAskOpen(false);
    window.setTimeout(() => {
      setCapturePoppedOut(false);
      setCaptureDocked(true);
      setVisible('inspector', true);
      setVisible('preview', true);
      focusPanel('inspector');
      if (maximizeMode === 'inspector') setMaximizeMode('none');
    }, 0);
  }, [setVisible, focusPanel, maximizeMode]);

  const popOutCapture = useCallback(() => {
    setCaptureDocked(false);
    setCapturePoppedOut(true);
    setVisible('preview', true);
    if (previewPoppedOut) setPreviewPoppedOut(false);
    focusPanel('preview');
  }, [setVisible, previewPoppedOut, focusPanel]);

  const closeCapture = useCallback(() => {
    setCapturePoppedOut(false);
    setCaptureDocked(false);
    setCaptureAskOpen(false);
  }, []);

  const dockCapture = useCallback(() => {
    setCapturePoppedOut(false);
    setCaptureDocked(true);
    setVisible('inspector', true);
    focusPanel('inspector');
  }, [setVisible, focusPanel]);

  const handleUpdateNode = useCallback(
    (nodeId: string, updatedData: Partial<StepData>) => {
      onGraphChange(({ nodes: prev, edges: prevEdges }) => ({
        nodes: prev.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...updatedData } } : n,
        ),
        edges: prevEdges,
      }));
    },
    [onGraphChange],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      onGraphChange(({ nodes: prev, edges: prevEdges }) => {
        const { nodes: nextNodes, edges: nextEdges } = removeAndReconnect(
          prev,
          prevEdges,
          nodeId,
        );
        return { nodes: nextNodes as RFNode[], edges: nextEdges };
      });
      setSelectedNodeId(null);
      setCapturePoppedOut(false);
      setCaptureDocked(false);
      setCaptureAskOpen(false);
    },
    [onGraphChange, setSelectedNodeId],
  );

  /** Set or clear the Loop Repeat-from edge (same as wiring the amber handle). */
  const handleSetRepeatFrom = useCallback(
    (loopNodeId: string, targetNodeId: string | null) => {
      onGraphChange(({ nodes: prev, edges: prevEdges }) => {
        const withoutOld = prevEdges.filter(
          (edge) => !(edge.source === loopNodeId && isRepeatEdge(edge)),
        );
        if (!targetNodeId || targetNodeId === loopNodeId) {
          return { nodes: prev, edges: withoutOld };
        }
        return {
          nodes: prev,
          edges: [
            ...withoutOld,
            {
              id: `e-repeat-${loopNodeId}-${targetNodeId}`,
              source: loopNodeId,
              target: targetNodeId,
              sourceHandle: HANDLE.REPEAT,
              targetHandle: HANDLE.IN,
            },
          ],
        };
      });
    },
    [onGraphChange],
  );

  const handleEditScript = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      setVisible('inspector', true);
      setMaximizeMode('inspector');
      focusPanel('inspector');
    },
    [setSelectedNodeId, setVisible, focusPanel],
  );

  const insertCaptureScript = useCallback(
    (lines: string) => {
      if (!selectedNode) return;
      const existing = selectedNode.data.scriptText || '';
      const next = existing.trim() ? `${existing.trim()}\n${lines}` : lines;
      handleUpdateNode(selectedNode.id, { scriptText: next });
    },
    [selectedNode, handleUpdateNode],
  );

  const prepareForRun = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      if (previewPoppedOut) {
        resolve(true);
        return;
      }
      if (!previewVisible) {
        openPreviewPopOut();
        resolve(true);
        return;
      }
      // Docked & visible → ask
      runAskResolver.current = resolve;
      setRunAskOpen(true);
    });
  }, [previewPoppedOut, previewVisible, openPreviewPopOut]);

  useImperativeHandle(
    ref,
    () => ({
      prepareForRun,
      setPanelVisible: setVisible,
    }),
    [prepareForRun, setVisible],
  );

  useEffect(() => {
    if (maximizeMode === 'none') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (previewPoppedOut || capturePoppedOut || captureAskOpen || runAskOpen) return;
      event.preventDefault();
      restoreWorkbench();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maximizeMode, restoreWorkbench, previewPoppedOut, capturePoppedOut, captureAskOpen, runAskOpen]);

  const canvasDefault: PanelRect | null = defaults?.canvas ?? null;
  const previewDefault: PanelRect | null = defaults?.preview ?? null;
  const inspectorDefault: PanelRect | null = defaults?.inspector ?? null;

  return (
    <div className="editor-body editor-workbench" ref={workbenchRef}>
      {canvasDefault && (
      <FloatingPanel
        id="float-canvas"
        title="Canvas"
        storageKey="editor-float-canvas"
        defaultRect={canvasDefault}
        minWidth={280}
        minHeight={220}
        zIndex={zMap.canvas}
        onFocus={() => focusPanel('canvas')}
        visible={canvasVisible}
        onClose={() => setVisible('canvas', false)}
        maximized={maximizeMode === 'canvas'}
        onToggleMaximize={() => toggleMaximize('canvas')}
      >
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeId}
          highlightedNodeId={highlightedNodeId}
          canvasActive={maximizeMode === 'none' || maximizeMode === 'canvas'}
          onSelectNode={setSelectedNodeId}
          onGraphChange={onGraphChange}
          onAddStep={onAddStep}
          onDeleteNode={handleDeleteNode}
          onEditScript={handleEditScript}
        />
      </FloatingPanel>
      )}

      {previewDefault && (
      <FloatingPanel
        id="float-preview"
        title="Preview"
        storageKey="editor-float-preview"
        defaultRect={previewDefault}
        minWidth={280}
        minHeight={200}
        zIndex={zMap.preview}
        onFocus={() => focusPanel('preview')}
        visible={showDockedPreview}
        onClose={() => setVisible('preview', false)}
        maximized={maximizeMode === 'preview'}
        onToggleMaximize={() => toggleMaximize('preview')}
        headerActions={
          <PreviewHeaderActions active={previewLive} onPopOut={openPreviewPopOut} />
        }
      >
        {!previewPoppedOut && (
          <PreviewPanel
            interactive
            hideHeader
            onStatusChange={setPreviewLive}
          />
        )}
      </FloatingPanel>
      )}

      {inspectorDefault && (
      <FloatingPanel
        id="float-inspector"
        title={maximizeMode === 'inspector' && selectedNode ? 'Script' : 'Inspector'}
        storageKey="editor-float-inspector"
        defaultRect={inspectorDefault}
        minWidth={280}
        minHeight={220}
        zIndex={zMap.inspector}
        onFocus={() => focusPanel('inspector')}
        visible={inspectorVisible}
        onClose={() => setVisible('inspector', false)}
        maximized={maximizeMode === 'inspector'}
        onToggleMaximize={() => toggleMaximize('inspector')}
      >
        <InspectorColumn
          selectedNode={selectedNode}
          selectedFlow={selectedFlow}
          selectedProject={selectedProject}
          nodes={nodes}
          edges={edges}
          onUpdateNode={handleUpdateNode}
          onDeleteNode={handleDeleteNode}
          onSetRepeatFrom={handleSetRepeatFrom}
          activeResultId={activeResultId}
          onCloseRunPanel={onCloseRunPanel}
          onRunProgress={onRunProgress}
          maximized={maximizeMode === 'inspector'}
          onOpenCapture={requestCapture}
          captureDocked={captureDocked}
          onCloseCapture={closeCapture}
          onPopOutCapture={popOutCapture}
          onInsertCaptureScript={insertCaptureScript}
          onEnsurePreview={ensurePreview}
          hideHeader
        />
      </FloatingPanel>
      )}

      <PopOutDialog
        open={previewPoppedOut && !capturePoppedOut}
        title="Preview"
        onClose={closePreviewPopOut}
        size="fullscreen"
        variant="float"
        className="popout-preview"
        headerActions={
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}
            onClick={dockPreview}
            title="Dock preview back into the workbench"
          >
            <PanelBottom size={12} />
            Dock
          </button>
        }
      >
        <PreviewPanel
          interactive
          hideHeader
          mode="dialog"
          onStatusChange={setPreviewLive}
        />
      </PopOutDialog>

      <PopOutDialog
        open={capturePoppedOut && Boolean(selectedNode)}
        title={
          selectedNode
            ? `Capture · ${selectedNode.data.label || selectedNode.id}`
            : 'Action Capture'
        }
        onClose={closeCapture}
        size="fullscreen"
        variant="float"
        className="popout-capture"
        headerActions={
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}
            onClick={dockCapture}
            title="Dock Capture into the Inspector"
          >
            <PanelBottom size={12} />
            Dock
          </button>
        }
      >
        {selectedNode && (
          <div className="capture-fullscreen-split">
            <PreviewPanel
              interactive
              hideHeader
              mode="dialog"
              onStatusChange={setPreviewLive}
            />
            <RecordingPanel
              project={selectedProject}
              flow={selectedFlow}
              nodes={nodes}
              edges={edges}
              selectedNode={selectedNode}
              onInsertScript={insertCaptureScript}
              onClose={closeCapture}
              embedded
            />
          </div>
        )}
      </PopOutDialog>

      <InputWaitPauseDialog resultId={activeResultId} />

      <ConfirmDialog
        open={captureAskOpen}
        title="Open Capture where?"
        message="Open Capture in full screen (with browser preview), or keep it docked in the Inspector?"
        confirmLabel="Full screen"
        denyLabel="Keep docked"
        cancelLabel="Cancel"
        onConfirm={openCapturePopup}
        onDeny={openCaptureDocked}
        onCancel={() => setCaptureAskOpen(false)}
      />

      <ConfirmDialog
        open={runAskOpen}
        title="Open Preview full screen?"
        message="Open Preview in full screen while this run plays? You can also keep it docked in the workbench."
        confirmLabel="Full screen"
        denyLabel="Keep docked"
        cancelLabel="Cancel"
        onConfirm={() => {
          setRunAskOpen(false);
          openPreviewPopOut();
          runAskResolver.current?.(true);
          runAskResolver.current = null;
        }}
        onDeny={() => {
          setRunAskOpen(false);
          runAskResolver.current?.(true);
          runAskResolver.current = null;
        }}
        onCancel={() => {
          setRunAskOpen(false);
          runAskResolver.current?.(false);
          runAskResolver.current = null;
        }}
      />
    </div>
  );
});

export default FlowEditor;
