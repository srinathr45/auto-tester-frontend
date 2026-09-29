import { useCallback, useEffect, useRef, useState } from 'react';

import LoginPage from './auth/LoginPage';
import ManageUsersModal from './auth/ManageUsersModal';
import { authService } from './auth/services/auth.service';
import { getAuthSession, setAuthSession, type AuthSession } from './auth/authSession';
import { hydrateApiBackendUrl } from './shared/apiBackendUrl';
import FlowEditor, {
  type FlowEditorHandle,
  type RFEdge,
  type RFNode,
  type WorkbenchPanelId,
  type WorkbenchPanelVisibility,
} from './editor/FlowEditor';
import EditorToolbar from './editor/EditorToolbar';
import VersionControlWindow from './versionControl/VersionControlWindow';
import { editorService } from './editor/services/editor.service';
import FlowModal from './flows/FlowModal';
import { flowService } from './flows/services/flow.service';
import ManualEditor from './manuals/ManualEditor';
import { manualService } from './manuals/services/manual.service';
import ProjectDashboard from './projects/ProjectDashboard';
import ProjectMenu from './projects/ProjectMenu';
import ProjectModal from './projects/ProjectModal';
import { projectService } from './projects/services/project.service';
import { orderFlowNodes } from './shared/orderNodes';
import { appendLinearNode, linearizeGraph } from './shared/linearGraph';
import { defaultDataForKind } from './shared/stepKinds';
import type { Flow, FlowCommit, FlowNode, Project, Result, StepKind } from './shared/types';
import { versionControlService } from './versionControl/services/version-control.service';

const HISTORY_LIMIT = 50;

function cloneGraph(nodes: RFNode[], edges: RFEdge[]) {
  return {
    nodes: JSON.parse(JSON.stringify(nodes)) as RFNode[],
    edges: JSON.parse(JSON.stringify(edges)) as RFEdge[],
  };
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => getAuthSession());
  const [view, setView] = useState<'menu' | 'dashboard' | 'editor'>('menu');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [selectedFlow, setSelectedFlow] = useState<Flow | null>(null);

  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [edges, setEdges] = useState<RFEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

  const historyRef = useRef<{ nodes: RFNode[]; edges: RFEdge[] }[]>([]);
  const futureRef = useRef<{ nodes: RFNode[]; edges: RFEdge[] }[]>([]);
  const skipHistoryRef = useRef(false);
  const flowEditorRef = useRef<FlowEditorHandle>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  // Keep refs in sync only via commit helpers below — never overwrite from render
  // (that races with drag updates and can drop nodes).
  const [historyTick, setHistoryTick] = useState(0);
  const [panelVisibility, setPanelVisibility] = useState<WorkbenchPanelVisibility>({
    canvas: true,
    preview: true,
    inspector: true,
  });

  const [activeResultId, setActiveResultId] = useState<number | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [desktopReady, setDesktopReady] = useState(Boolean(window.autoTester));
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isFlowModalOpen, setIsFlowModalOpen] = useState(false);
  const [isUsersModalOpen, setIsUsersModalOpen] = useState(false);
  const [lineDelayMs, setLineDelayMs] = useState(0);
  const [recordVideo, setRecordVideo] = useState(false);
  const [showManualEditor, setShowManualEditor] = useState(false);
  const [manualEditorId, setManualEditorId] = useState<number | null>(null);
  const [manualOpening, setManualOpening] = useState(false);

  const refreshProjects = async () => {
    const list = await projectService.getAll();
    setProjects(list);
    return list;
  };

  useEffect(() => {
    void hydrateApiBackendUrl();
  }, []);

  /** Sync JWT into Electron main whenever session is present. */
  useEffect(() => {
    if (session?.accessToken) {
      void window.autoTester?.setAuthToken?.(session.accessToken);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refreshProjects().catch((err) => console.error(err));
  }, [session]);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        if (!window.autoTester) {
          if (mounted) setDesktopReady(false);
          return;
        }
        const health = await window.autoTester.health();
        if (mounted) setDesktopReady(Boolean(health?.ok));
      } catch {
        if (mounted) setDesktopReady(false);
      }
    };
    check();
    const interval = setInterval(check, 4000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleAuthenticated = (next: AuthSession) => {
    setAuthSession(next);
    setSession(next);
  };

  const handleLogout = () => {
    authService.logout();
    setSession(null);
    setProjects([]);
    setSelectedProject(null);
    setSelectedFlow(null);
    setView('menu');
  };

  const pushHistory = useCallback((nextNodes: RFNode[], nextEdges: RFEdge[]) => {
    if (skipHistoryRef.current) return;
    historyRef.current.push(cloneGraph(nextNodes, nextEdges));
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    futureRef.current = [];
    setHistoryTick((t) => t + 1);
  }, []);

  /** Apply graph updates from the latest ref snapshot so add/drag cannot race and wipe steps. */
  const setGraphWithHistory = useCallback(
    (
      recipe: (prev: { nodes: RFNode[]; edges: RFEdge[] }) => {
        nodes: RFNode[];
        edges: RFEdge[];
      },
      options?: { history?: boolean },
    ) => {
      const prev = { nodes: nodesRef.current, edges: edgesRef.current };
      if (options?.history !== false) {
        pushHistory(prev.nodes, prev.edges);
      }
      const next = recipe(prev);
      if (next.nodes === prev.nodes && next.edges === prev.edges) return;
      nodesRef.current = next.nodes;
      edgesRef.current = next.edges;
      setNodes(next.nodes);
      setEdges(next.edges);
    },
    [pushHistory],
  );

  const handleUndo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const snapshot = historyRef.current.pop()!;
    futureRef.current.push(cloneGraph(nodesRef.current, edgesRef.current));
    skipHistoryRef.current = true;
    nodesRef.current = snapshot.nodes;
    edgesRef.current = snapshot.edges;
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    skipHistoryRef.current = false;
    setHistoryTick((t) => t + 1);
  }, []);

  const handleRedo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const snapshot = futureRef.current.pop()!;
    historyRef.current.push(cloneGraph(nodesRef.current, edgesRef.current));
    skipHistoryRef.current = true;
    nodesRef.current = snapshot.nodes;
    edgesRef.current = snapshot.edges;
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    skipHistoryRef.current = false;
    setHistoryTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== 'editor') return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, handleUndo, handleRedo]);

  const resetHistory = () => {
    historyRef.current = [];
    futureRef.current = [];
    setHistoryTick((t) => t + 1);
  };

  /** Load the stored graph as-is so canvas positions survive save/reload. */
  const loadFlowOntoCanvas = (flow: Flow) => {
    const nextNodes = editorService.nodesFromFlow(flow) as RFNode[];
    const nextEdges = editorService.edgesFromFlow(flow);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setSelectedFlow(flow);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(null);
    setHighlightedNodeId(null);
  };

  const [versionControlOpen, setVersionControlOpen] = useState(false);
  const [historyCommits, setHistoryCommits] = useState<FlowCommit[]>([]);

  const loadVersionedFlow = async (
    flow: Flow,
    branch: string,
    preferLocalDraft = true,
  ) => {
    const version = await versionControlService.getState(flow.id, branch);
    const draft = preferLocalDraft
      ? await versionControlService.loadDraft(flow, branch)
      : null;
    const graph = draft?.graph
      ? (draft.graph as { nodes: FlowNode[]; edges: RFEdge[] })
      : await versionControlService.loadGraph({ ...flow, version }, branch);
    const versioned = {
      ...flow,
      version,
      steps: graph,
      localDraft: draft
        ? { baseCommitId: draft.baseCommitId, updatedAt: draft.updatedAt }
        : undefined,
    };
    loadFlowOntoCanvas(versioned);
    return versioned;
  };

  const clearGraph = () => {
    nodesRef.current = [];
    edgesRef.current = [];
    setNodes([]);
    setEdges([]);
  };

  /** Open project → dashboard (not straight into editor). */
  const openProjectDashboard = async (proj: Project) => {
    setSelectedProject(proj);
    try {
      const flowList = await flowService.getByProject(proj.id);
      setFlows(flowList);
      setSelectedFlow(null);
      clearGraph();
      resetHistory();
      setView('dashboard');
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Failed to open project');
    }
  };

  const openFlowInEditor = async (flow: Flow) => {
    if (!selectedProject) return;
    try {
      const [flowList, latest] = await Promise.all([
        flowService.getByProject(selectedProject.id),
        flowService.getById(flow.id),
      ]);
      setFlows(flowList);
      const versioned = await loadVersionedFlow(latest, 'main');
      loadFlowOntoCanvas(versioned);
      resetHistory();
      setView('editor');
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Failed to open flow');
    }
  };

  const handleBackToProjects = () => {
    setView('menu');
    setSelectedProject(null);
    setSelectedFlow(null);
    clearGraph();
    setHighlightedNodeId(null);
    resetHistory();
  };

  const handleBackToDashboard = () => {
    setView('dashboard');
    setSelectedFlow(null);
    clearGraph();
    setHighlightedNodeId(null);
    resetHistory();
  };

  const handleSelectFlow = async (flow: Flow) => {
    pushHistory(nodesRef.current, edgesRef.current);
    try {
      const latest = await flowService.getById(flow.id);
      await loadVersionedFlow(latest, flow.version?.currentBranch || 'main');
    } catch (err) {
      console.error(err);
      loadFlowOntoCanvas(flow);
    }
  };

  const handleChangeBranch = async (branch: string) => {
    if (!selectedFlow) return;
    try {
      const switched = await loadVersionedFlow(selectedFlow, branch);
      setHistoryCommits(await versionControlService.listCommits(switched.id, branch));
      resetHistory();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Could not switch branch');
    }
  };

  const handleCreateBranch = async (name: string) => {
    if (!selectedFlow) return;
    if (!name?.trim()) return;
    try {
      const currentBranch = selectedFlow.version?.currentBranch || 'main';
      const currentState = await versionControlService.getState(
        selectedFlow.id,
        currentBranch,
      );
      await versionControlService.createBranch(
        selectedFlow.id,
        name.trim(),
        currentState.headCommitId,
      );
      const refreshedState = await versionControlService.getState(
        selectedFlow.id,
        currentBranch,
      );
      const updated = { ...selectedFlow, version: refreshedState };
      setSelectedFlow(updated);
      setFlows((prev) => prev.map((flow) => (flow.id === updated.id ? updated : flow)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not create branch');
    }
  };

  const handleSync = (message: string) => {
    if (!message?.trim()) {
      alert('A sync message is required.');
      return;
    }
    if (!selectedFlow) return;
    void (async () => {
      try {
        const branch = selectedFlow.version?.currentBranch || 'main';
        const updated = await editorService.sync(selectedFlow, branch, message.trim());
        const synced = {
          ...updated,
          steps: editorService.toGraph(nodes as FlowNode[], edges),
        };
        setSelectedFlow(synced);
        setFlows((prev) => prev.map((flow) => (flow.id === synced.id ? synced : flow)));
        setHistoryCommits(await versionControlService.listCommits(synced.id, branch));
        alert('Flow synced.');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed';
        alert(
          message.includes('Branch has changed') || message.includes('STALE_BRANCH')
            ? 'This branch changed on the server. Pull the latest branch, then reapply your local changes.'
            : message,
        );
      }
    })();
  };

  const handlePull = async () => {
    if (!selectedFlow) return;
    const confirmed = window.confirm(
      'Pull the remote branch and replace the current editor contents?',
    );
    if (!confirmed) return;
    try {
      const pulled = await loadVersionedFlow(
        selectedFlow,
        selectedFlow.version?.currentBranch || 'main',
        false,
      );
      const savedLocally = await editorService.save(
        pulled,
        pulled.steps,
        pulled.version?.currentBranch || 'main',
        pulled.version?.headCommitId ?? null,
      );
      setSelectedFlow(savedLocally);
      setFlows((prev) => prev.map((flow) => (flow.id === savedLocally.id ? savedLocally : flow)));
      resetHistory();
      setHistoryCommits(
        await versionControlService.listCommits(
          selectedFlow.id,
          selectedFlow.version?.currentBranch || 'main',
        ),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not pull branch');
    }
  };

  const handleOpenHistory = async () => {
    if (!selectedFlow) return;
    try {
      const branch = selectedFlow.version?.currentBranch || 'main';
      setHistoryCommits(await versionControlService.listCommits(selectedFlow.id, branch));
      setVersionControlOpen(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not load history');
    }
  };

  const handleRevert = async (commitId: string) => {
    if (!selectedFlow) return;
    const branch = selectedFlow.version?.currentBranch || 'main';
    try {
      const result = await versionControlService.revert(selectedFlow, commitId);
      const reverted = await editorService.save(
        selectedFlow,
        result.graph,
        branch,
        selectedFlow.version?.headCommitId ?? null,
      );
      loadFlowOntoCanvas(reverted);
      setFlows((prev) => prev.map((flow) => (flow.id === reverted.id ? reverted : flow)));
      setVersionControlOpen(false);
      alert('Flow reverted locally. Sync to create a new commit.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not revert version');
    }
  };

  const handleMerge = async (source: string) => {
    if (!selectedFlow) return;
    const target = selectedFlow.version?.currentBranch || 'main';
    if (!source?.trim() || source.trim() === target) return;
    try {
      const merge = await versionControlService.merge(
        selectedFlow,
        source.trim(),
        target,
        `Merge ${source.trim()} into ${target}`,
      );
      if (merge.conflicts.length > 0) {
        const resolutions: Record<string, 'ours' | 'theirs'> = {};
        for (const conflict of merge.conflicts) {
          const theirs = window.confirm(
            `Conflict in ${conflict.nodeId} / ${conflict.field}.\nOK = use source branch, Cancel = keep current branch.`,
          );
          resolutions[`${conflict.nodeId}:${conflict.field}`] = theirs ? 'theirs' : 'ours';
        }
        const resolved = await versionControlService.resolveMerge(
          selectedFlow,
          merge,
          resolutions,
        );
        const version = await versionControlService.getState(selectedFlow.id, target);
        const merged = await editorService.save(
          { ...selectedFlow, steps: resolved.graph, version },
          resolved.graph,
          target,
          version.headCommitId,
        );
        loadFlowOntoCanvas(merged);
        setFlows((prev) => prev.map((flow) => (flow.id === merged.id ? merged : flow)));
        return;
      }
      const version = await versionControlService.getState(selectedFlow.id, target);
      const merged = await editorService.save(
        { ...selectedFlow, steps: merge.graph, version },
        merge.graph,
        target,
        version.headCommitId,
      );
      loadFlowOntoCanvas(merged);
      setFlows((prev) => prev.map((flow) => (flow.id === merged.id ? merged : flow)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not merge branches');
    }
  };

  const handleAddStep = useCallback((kind: StepKind = 'script') => {
    const newId = `node-${Date.now()}`;
    setGraphWithHistory(({ nodes: currentNodes, edges: currentEdges }) => {
      const ordered = orderFlowNodes(currentNodes as FlowNode[], currentEdges);
      const last = ordered[ordered.length - 1];
      const data = defaultDataForKind(kind);
      if (kind === 'script') {
        data.label = `Step ${ordered.length + 1}`;
      }
      const newNode: RFNode = {
        id: newId,
        type: 'customStep',
        position: {
          x: last?.position?.x ?? 80,
          y: (last?.position?.y ?? -100) + 140,
        },
        data,
      };
      const { nodes: nextNodes, edges: nextEdges } = appendLinearNode(
        currentNodes as FlowNode[],
        currentEdges,
        newNode,
        last?.id,
      );
      return { nodes: nextNodes as RFNode[], edges: nextEdges };
    });
    setSelectedNodeId(newId);
  }, [setGraphWithHistory]);

  const handleSaveFlow = async () => {
    if (!selectedFlow) return;
    try {
      const updated = await editorService.save(
        selectedFlow,
        editorService.toGraph(nodes as FlowNode[], edges),
        selectedFlow.version?.currentBranch || 'main',
        selectedFlow.version?.headCommitId ?? null,
      );
      setSelectedFlow(updated);
      setFlows((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      alert('Flow saved locally.');
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleRunFlow = async () => {
    if (!selectedFlow || !selectedProject) return;
    const branch = selectedFlow.version?.currentBranch || 'main';
    const localDraft = await versionControlService.loadDraft(selectedFlow, branch);
    if (!localDraft) {
      alert('Save the flow locally before running it.');
      return;
    }
    const localGraph = localDraft.graph as { nodes: FlowNode[]; edges: RFEdge[] };
    const ready = await flowEditorRef.current?.prepareForRun();
    if (ready === false) return;
    setIsExecuting(true);
    try {
      const result = await editorService.run(
        selectedFlow,
        selectedProject,
        localGraph,
        lineDelayMs,
        recordVideo,
      );
      setActiveResultId(result.id);
      setHighlightedNodeId(result.currentNodeId);
      const version = await versionControlService.getState(
        selectedFlow.id,
        branch,
      );
      const refreshed = { ...selectedFlow, steps: localGraph, version };
      setSelectedFlow(refreshed);
      setFlows((prev) => prev.map((f) => (f.id === refreshed.id ? refreshed : f)));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleOpenManual = useCallback(async () => {
    if (!selectedFlow || !selectedProject || manualOpening) return;
    if (!window.autoTester) {
      alert('Desktop runtime required to auto-capture manual screenshots.');
      return;
    }
    setManualOpening(true);
    try {
      const graph = editorService.toGraph(nodes as FlowNode[], edges);
      const created = await manualService.create({
        projectId: selectedProject.id,
        flowId: selectedFlow.id,
        title: `${selectedFlow.name} Manual`,
        nodes: graph.nodes,
      });

      const stepMap: Record<string, number> = {};
      for (const step of created.steps || []) {
        if (step.stepNodeId) stepMap[step.stepNodeId] = step.id;
      }

      const result = await editorService.runManualCapture(
        selectedFlow,
        selectedProject,
        graph,
        created.id,
        stepMap,
        lineDelayMs,
      );
      setActiveResultId(result.id);
      setManualEditorId(created.id);
      setShowManualEditor(true);
      const version = await versionControlService.getState(
        selectedFlow.id,
        selectedFlow.version?.currentBranch || 'main',
      );
      const updated = { ...selectedFlow, steps: graph, version };
      setSelectedFlow(updated);
      setFlows((prev) => prev.map((flow) => (flow.id === updated.id ? updated : flow)));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Failed to create manual');
    } finally {
      setManualOpening(false);
    }
  }, [selectedFlow, selectedProject, manualOpening, nodes, edges, lineDelayMs]);

  const handleCloseManual = useCallback(() => {
    setShowManualEditor(false);
    setManualEditorId(null);
  }, []);

  const handleRunProgress = useCallback((result: Result) => {
    setHighlightedNodeId(result.currentNodeId);
  }, []);

  const handleCreateProject = async (data: { name: string; description?: string; url: string }) => {
    try {
      const proj = await projectService.create(data);
      await refreshProjects();
      setIsProjectModalOpen(false);
      await openProjectDashboard(proj);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const handleDeleteProject = async (id: number) => {
    await projectService.remove(id);
    await refreshProjects();
  };

  const handleCreateFlow = async (data: { projectId: number; name: string; description?: string }) => {
    try {
      const starterScript = selectedProject?.url
        ? `await page.goto('${selectedProject.url}');\n`
        : `await page.goto('https://example.com');\n`;
      const starterNodes: FlowNode[] = [
        {
          id: 'node-start',
          type: 'customStep',
          position: { x: 80, y: 40 },
          data: {
            label: 'Start Navigation',
            description: 'Open the application',
            scriptText: starterScript,
            stepKind: 'script',
          },
        },
      ];
      const { nodes: graphNodes, edges: graphEdges } = linearizeGraph(starterNodes);
      const newFlow = await flowService.create({
        ...data,
        steps: { nodes: graphNodes, edges: graphEdges },
      });
      setFlows((prev) => [...prev, newFlow]);
      await openFlowInEditor(newFlow);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Create flow failed');
    }
  };

  const canUndo = historyTick >= 0 && historyRef.current.length > 0;
  const canRedo = historyTick >= 0 && futureRef.current.length > 0;

  if (!session) {
    return <LoginPage onAuthenticated={handleAuthenticated} />;
  }

  if (view === 'menu') {
    return (
      <>
        <ProjectMenu
          projects={projects}
          session={session}
          onOpenProject={openProjectDashboard}
          onCreateProject={() => setIsProjectModalOpen(true)}
          onDeleteProject={handleDeleteProject}
          onManageUsers={() => setIsUsersModalOpen(true)}
          onLogout={handleLogout}
        />
        <ProjectModal
          isOpen={isProjectModalOpen}
          onClose={() => setIsProjectModalOpen(false)}
          onCreateProject={handleCreateProject}
        />
        {session.role === 'owner' && (
          <ManageUsersModal
            isOpen={isUsersModalOpen}
            onClose={() => setIsUsersModalOpen(false)}
          />
        )}
      </>
    );
  }

  if (view === 'dashboard' && selectedProject) {
    return (
      <>
        <ProjectDashboard
          project={selectedProject}
          onBackToProjects={handleBackToProjects}
          onOpenFlow={openFlowInEditor}
          onCreateFlow={() => setIsFlowModalOpen(true)}
          onDeleteFlow={(flowId) => {
            setFlows((prev) => prev.filter((f) => f.id !== flowId));
            if (selectedFlow?.id === flowId) {
              setSelectedFlow(null);
              clearGraph();
            }
          }}
        />
        <FlowModal
          isOpen={isFlowModalOpen}
          onClose={() => setIsFlowModalOpen(false)}
          onCreateFlow={handleCreateFlow}
          selectedProjectId={selectedProject.id}
        />
      </>
    );
  }

  return (
    <div className="editor-shell">
      <EditorToolbar
        selectedProject={selectedProject}
        flows={flows}
        selectedFlow={selectedFlow}
        onSelectFlow={handleSelectFlow}
        onOpenFlowModal={() => setIsFlowModalOpen(true)}
        onSaveFlow={handleSaveFlow}
        onRunFlow={handleRunFlow}
        onBackToProjects={handleBackToProjects}
        onBackToDashboard={handleBackToDashboard}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        lineDelayMs={lineDelayMs}
        onLineDelayChange={setLineDelayMs}
        recordVideo={recordVideo}
        onToggleRecordVideo={() => setRecordVideo((prev) => !prev)}
        onOpenManual={handleOpenManual}
        isExecuting={isExecuting || manualOpening}
        desktopReady={desktopReady}
        panelVisibility={panelVisibility}
        onOpenVersionControl={handleOpenHistory}
        onTogglePanel={(panel: WorkbenchPanelId) => {
          const next = !panelVisibility[panel];
          flowEditorRef.current?.setPanelVisible(panel, next);
        }}
      />

      <FlowEditor
        ref={flowEditorRef}
        nodes={nodes}
        edges={edges}
        selectedFlow={selectedFlow}
        selectedProject={selectedProject}
        selectedNodeId={selectedNodeId}
        highlightedNodeId={highlightedNodeId}
        setSelectedNodeId={setSelectedNodeId}
        onGraphChange={setGraphWithHistory}
        onAddStep={handleAddStep}
        activeResultId={activeResultId}
        onCloseRunPanel={() => {
          setActiveResultId(null);
          setHighlightedNodeId(null);
        }}
        onRunProgress={handleRunProgress}
        onPanelVisibilityChange={setPanelVisibility}
      />

      <FlowModal
        isOpen={isFlowModalOpen}
        onClose={() => setIsFlowModalOpen(false)}
        onCreateFlow={handleCreateFlow}
        selectedProjectId={selectedProject?.id}
      />

      {showManualEditor && selectedFlow && selectedProject && manualEditorId != null && (
        <ManualEditor
          flowId={selectedFlow.id}
          projectId={selectedProject.id}
          manualId={manualEditorId}
          onClose={handleCloseManual}
        />
      )}

      <VersionControlWindow
        open={versionControlOpen}
        currentBranch={selectedFlow?.version?.currentBranch || 'main'}
        branches={selectedFlow?.version?.branches || []}
        commits={historyCommits}
        onClose={() => setVersionControlOpen(false)}
        onChangeBranch={handleChangeBranch}
        onCreateBranch={handleCreateBranch}
        onSync={handleSync}
        onPull={handlePull}
        onMerge={handleMerge}
        onRevert={handleRevert}
      />
    </div>
  );
}
