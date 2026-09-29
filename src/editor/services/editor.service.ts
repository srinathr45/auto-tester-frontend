import type {
  Flow,
  FlowCommit,
  FlowEdge,
  FlowGraph,
  FlowNode,
  Project,
  Result,
} from '../../shared/types';
import { getDesktopApi } from '../../shared/http';
import { versionControlService } from '../../versionControl/services/version-control.service';

/** Allocate a local run id (not a Nest Result row). */
function nextRunId(): number {
  return Date.now();
}

/** Editor save/run — Save is local; Sync is the cloud operation. */
export const editorService = {
  save: async (
    flow: Flow,
    graph: FlowGraph,
    branch = flow.version?.currentBranch || 'main',
    baseCommitId = flow.version?.headCommitId ?? null,
  ) => {
    const draft = await getDesktopApi().saveFlowDraft({
      flowId: flow.id,
      projectId: flow.projectId,
      branch,
      baseCommitId,
      message: 'Local draft',
      graph,
    });
    return {
      ...flow,
      steps: graph,
      localDraft: {
        baseCommitId: draft.baseCommitId,
        updatedAt: draft.updatedAt,
      },
    };
  },

  /** Upload the saved local draft with a required user-provided message. */
  sync: async (
    flow: Flow,
    branch: string,
    message: string,
  ) => {
    const result = await getDesktopApi().syncFlowDraft({
      flowId: flow.id,
      projectId: flow.projectId,
      branch,
      message,
    });
    const commit = result.commit as FlowCommit;
    const version = await versionControlService.getState(flow.id, branch);
    return {
      ...flow,
      version: { ...version, headCommitId: commit.id, head: commit },
      localDraft: {
        baseCommitId: commit.id,
        updatedAt: new Date().toISOString(),
      },
    };
  },

  /**
   * Persist graph to MinIO via Nest, then start an ephemeral local Electron run.
   */
  run: async (
    flow: Flow,
    project: Project,
    graph: FlowGraph,
    lineDelayMs = 0,
    recordVideo = false,
  ): Promise<Result> => {
    const resultId = nextRunId();
    await getDesktopApi().startRun({
      resultId,
      flowId: flow.id,
      projectId: project.id,
      projectUrl: project.url,
      projectName: project.name,
      flowName: flow.name,
      commitId: null,
      lineDelayMs,
      recordVideo,
      nodes: graph.nodes,
      edges: graph.edges,
    });

    return {
      id: resultId,
      flowId: flow.id,
      projectId: project.id,
      result: 'queued',
      failedStepId: null,
      errorMessage: null,
      pauseMessage: null,
      stepProgress: null,
      currentNodeId: null,
      commitId: null,
    };
  },

  /**
   * Start a flow run that auto-captures before/after screenshots onto a manual.
   */
  runManualCapture: async (
    flow: Flow,
    project: Project,
    graph: FlowGraph,
    manualId: number,
    stepMap: Record<string, number>,
    lineDelayMs = 0,
  ): Promise<Result> => {
    const resultId = nextRunId();
    await getDesktopApi().startRun({
      resultId,
      flowId: flow.id,
      projectId: project.id,
      projectUrl: project.url,
      projectName: project.name,
      flowName: flow.name,
      commitId: null,
      lineDelayMs,
      recordVideo: false,
      manualCapture: { manualId, stepMap },
      nodes: graph.nodes,
      edges: graph.edges,
    });

    return {
      id: resultId,
      flowId: flow.id,
      projectId: project.id,
      result: 'queued',
      failedStepId: null,
      errorMessage: null,
      pauseMessage: null,
      stepProgress: null,
      currentNodeId: null,
      commitId: null,
    };
  },

  toGraph: (nodes: FlowNode[], edges: FlowEdge[]): FlowGraph => ({ nodes, edges }),

  nodesFromFlow: (flow: Flow): FlowNode[] =>
    (flow.steps?.nodes || []).map((n) => ({
      id: n.id,
      type: n.type || 'customStep',
      position: n.position,
      data: n.data,
    })),

  edgesFromFlow: (flow: Flow): FlowEdge[] => flow.steps?.edges || [],
};
