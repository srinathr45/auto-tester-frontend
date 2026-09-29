import { request, getDesktopApi } from '../../shared/http';
import type {
  CommitConflict,
  Flow,
  FlowBranch,
  FlowCommit,
  FlowGraph,
  FlowNode,
  FlowVersionState,
} from '../../shared/types';

export interface MergeResult {
  graph: FlowGraph;
  conflicts: CommitConflict[];
  commit?: FlowCommit;
  baseCommitId: string | null;
  oursCommitId: string;
  theirsCommitId: string;
  targetBranch: string;
  sourceBranch: string;
}

/** Version-control API and local graph merge operations for the flow editor. */
export const versionControlService = {
  getState: (flowId: number, branch = 'main') =>
    request<FlowVersionState>(`/flows/${flowId}/version?branch=${encodeURIComponent(branch)}`),

  listBranches: (flowId: number) =>
    request<FlowBranch[]>(`/flows/${flowId}/version/branches`),

  createBranch: (flowId: number, name: string, fromCommitId?: string | null) =>
    request<FlowBranch>(`/flows/${flowId}/version/branches`, {
      method: 'POST',
      body: JSON.stringify({ name, fromCommitId }),
    }),

  deleteBranch: (flowId: number, name: string) =>
    request<void>(
      `/flows/${flowId}/version/branches/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    ),

  listCommits: (flowId: number, branch: string) =>
    request<FlowCommit[]>(
      `/flows/${flowId}/version/branches/${encodeURIComponent(branch)}/commits`,
    ),

  /** Upload the app-created bundle and return the new immutable commit. */
  commit: async (
    flow: Flow,
    graph: FlowGraph,
    branch: string,
    baseCommitId: string | null,
    message: string,
    parentIds?: string[],
    sourceBranch?: string,
  ) => {
    const result = await getDesktopApi().createFlowCommit({
      flowId: flow.id,
      projectId: flow.projectId,
      branch,
      baseCommitId,
      parentIds,
      message,
      graph,
      sourceBranch,
    });
    return result;
  },

  /** Download the checked-out commit, or use legacy graph data before migration. */
  loadGraph: async (flow: Flow, branch = 'main'): Promise<FlowGraph> => {
    const state = await versionControlService.getState(flow.id, branch);
    if (!state.headCommitId || !window.autoTester) return flow.steps;
    const bundle = await getDesktopApi().downloadFlowCommit(flow.id, state.headCommitId);
    return bundle.graph as FlowGraph;
  },

  /** Load the persistent local draft without contacting the backend. */
  loadDraft: async (flow: Flow, branch = 'main') => {
    if (!window.autoTester) return null;
    return getDesktopApi().loadFlowDraft(flow.projectId, flow.id, branch);
  },

  /** Load an old snapshot into the editor without changing the remote branch. */
  revert: async (
    flow: Flow,
    targetCommitId: string,
  ) => {
    const bundle = await getDesktopApi().downloadFlowCommit(flow.id, targetCommitId);
    return { commit: bundle.manifest, graph: bundle.graph as FlowGraph };
  },

  /**
   * Merge two branch heads locally using a three-way graph merge. Only the
   * resolved ZIP is sent to Nest, so merge semantics remain in the app.
   */
  merge: async (
    flow: Flow,
    sourceBranch: string,
    targetBranch: string,
    message: string,
  ): Promise<MergeResult> => {
    const [sourceState, targetState] = await Promise.all([
      versionControlService.getState(flow.id, sourceBranch),
      versionControlService.getState(flow.id, targetBranch),
    ]);
    if (!sourceState.headCommitId || !targetState.headCommitId) {
      throw new Error('Both branches must contain commits before merging');
    }

    const [sourceCommits, targetCommits] = await Promise.all([
      versionControlService.listCommits(flow.id, sourceBranch),
      versionControlService.listCommits(flow.id, targetBranch),
    ]);
    const all = new Map([...sourceCommits, ...targetCommits].map((commit) => [commit.id, commit]));
    const baseCommitId = findMergeBase(
      targetState.headCommitId,
      sourceState.headCommitId,
      all,
    );
    if (!baseCommitId) throw new Error('Branches do not have a common ancestor');

    const [baseBundle, oursBundle, theirsBundle] = await Promise.all([
      getDesktopApi().downloadFlowCommit(flow.id, baseCommitId),
      getDesktopApi().downloadFlowCommit(flow.id, targetState.headCommitId),
      getDesktopApi().downloadFlowCommit(flow.id, sourceState.headCommitId),
    ]);
    const merged = mergeGraphs(
      baseBundle.graph as FlowGraph,
      oursBundle.graph as FlowGraph,
      theirsBundle.graph as FlowGraph,
    );
    if (merged.conflicts.length > 0) {
      return {
        ...merged,
        baseCommitId,
        oursCommitId: targetState.headCommitId,
        theirsCommitId: sourceState.headCommitId,
        targetBranch,
        sourceBranch,
      };
    }

    const result = await versionControlService.commit(
      flow,
      merged.graph,
      targetBranch,
      targetState.headCommitId,
      message || `Merge ${sourceBranch} into ${targetBranch}`,
      [targetState.headCommitId, sourceState.headCommitId],
      sourceBranch,
    );
    return {
      ...merged,
      baseCommitId,
      commit: result.commit as FlowCommit,
      oursCommitId: targetState.headCommitId,
      theirsCommitId: sourceState.headCommitId,
      targetBranch,
      sourceBranch,
    };
  },

  /** Apply per-conflict choices and upload the resolved two-parent merge. */
  resolveMerge: async (
    flow: Flow,
    merge: MergeResult,
    resolutions: Record<string, 'ours' | 'theirs'>,
  ) => {
    const graph = applyResolutions(merge.graph, merge.conflicts, resolutions);
    const result = await versionControlService.commit(
      flow,
      graph,
      merge.targetBranch,
      merge.oursCommitId,
      `Merge ${merge.sourceBranch} into ${merge.targetBranch}`,
      [merge.oursCommitId, merge.theirsCommitId],
      merge.sourceBranch,
    );
    return { graph, commit: result.commit as FlowCommit };
  },
};

function findMergeBase(
  ours: string,
  theirs: string,
  commits: Map<string, FlowCommit>,
): string | null {
  const oursAncestors = new Set<string>();
  const oursQueue = [ours];
  while (oursQueue.length > 0) {
    const id = oursQueue.shift()!;
    if (oursAncestors.has(id)) continue;
    oursAncestors.add(id);
    for (const parent of commits.get(id)?.parentIds || []) oursQueue.push(parent);
  }
  const theirsQueue = [theirs];
  const visited = new Set<string>();
  while (theirsQueue.length > 0) {
    const id = theirsQueue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (oursAncestors.has(id)) return id;
    for (const parent of commits.get(id)?.parentIds || []) theirsQueue.push(parent);
  }
  return null;
}

function mergeGraphs(
  base: FlowGraph,
  ours: FlowGraph,
  theirs: FlowGraph,
): { graph: FlowGraph; conflicts: CommitConflict[] } {
  const conflicts: CommitConflict[] = [];
  const baseNodes = new Map(base.nodes.map((node) => [node.id, node]));
  const ourNodes = new Map(ours.nodes.map((node) => [node.id, node]));
  const theirNodes = new Map(theirs.nodes.map((node) => [node.id, node]));
  const nodeIds = new Set([...baseNodes.keys(), ...ourNodes.keys(), ...theirNodes.keys()]);
  const nodes: FlowNode[] = [];

  for (const nodeId of nodeIds) {
    const merged = mergeNode(
      nodeId,
      baseNodes.get(nodeId),
      ourNodes.get(nodeId),
      theirNodes.get(nodeId),
      conflicts,
    );
    if (merged) nodes.push(merged);
  }

  const edges = mergeCollection(
    base.edges,
    ours.edges,
    theirs.edges,
    'edge',
    conflicts,
  ) as FlowGraph['edges'];
  const baseOrder = base.nodes.map((node) => node.id);
  const ourOrder = ours.nodes.map((node) => node.id);
  const theirOrder = theirs.nodes.map((node) => node.id);
  if (!same(baseOrder, ourOrder) && !same(baseOrder, theirOrder) && !same(ourOrder, theirOrder)) {
    conflicts.push({
      nodeId: '__graph__',
      field: 'order',
      base: baseOrder,
      ours: ourOrder,
      theirs: theirOrder,
    });
  }

  return { graph: { nodes, edges }, conflicts };
}

function mergeNode(
  nodeId: string,
  base: FlowNode | undefined,
  ours: FlowNode | undefined,
  theirs: FlowNode | undefined,
  conflicts: CommitConflict[],
): FlowNode | undefined {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  if (!ours || !theirs) {
    conflicts.push({ nodeId, field: 'node', base, ours, theirs });
    return ours || theirs;
  }

  const keys = new Set([
    ...Object.keys(ours),
    ...Object.keys(theirs),
    ...Object.keys(base || {}),
  ]);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const value = mergeValue(
      base?.[key],
      ours[key],
      theirs[key],
      nodeId,
      key,
      conflicts,
    );
    if (value !== undefined) result[key] = value;
  }
  return result as unknown as FlowNode;
}

function mergeCollection(
  base: unknown[],
  ours: unknown[],
  theirs: unknown[],
  kind: string,
  conflicts: CommitConflict[],
): unknown[] {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  conflicts.push({ nodeId: '__graph__', field: kind, base, ours, theirs });
  return ours;
}

function mergeValue(
  base: unknown,
  ours: unknown,
  theirs: unknown,
  nodeId: string,
  field: string,
  conflicts: CommitConflict[],
): unknown {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  conflicts.push({ nodeId, field, base, ours, theirs });
  return ours;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function applyResolutions(
  graph: FlowGraph,
  conflicts: CommitConflict[],
  resolutions: Record<string, 'ours' | 'theirs'>,
): FlowGraph {
  const nodes = graph.nodes.map(
    (node) => ({ ...node, data: { ...(node.data || {}) } }) as FlowNode,
  );
  for (const conflict of conflicts) {
    if (conflict.nodeId === '__graph__') continue;
    const node = nodes.find((item) => item.id === conflict.nodeId);
    if (!node) continue;
    const chosen = resolutions[`${conflict.nodeId}:${conflict.field}`] === 'theirs'
      ? conflict.theirs
      : conflict.ours;
    if (conflict.field === 'node' && chosen && typeof chosen === 'object') {
      Object.assign(node, chosen);
    } else if (conflict.field === 'data') {
      node.data = (chosen || {}) as typeof node.data;
    } else {
      (node as unknown as Record<string, unknown>)[conflict.field] = chosen;
    }
  }
  return { nodes, edges: graph.edges };
}
