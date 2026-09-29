import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getNestAuthToken, nestApiBase } from './artifactUpload';
import type { FlowEdge, FlowNode } from './types';

export interface FlowBundleGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowCommitResponse {
  id: string;
  flowId: number;
  parentIds: string[];
  branchName: string;
  authorUserId: number;
  message: string;
  contentHash: string;
  createdAt: string;
  snapshot?: FlowBundleGraph;
}

export interface CommitUploadParams {
  flowId: number;
  projectId: number;
  branch: string;
  baseCommitId: string | null;
  parentIds?: string[];
  message: string;
  graph: FlowBundleGraph;
  sourceBranch?: string;
}

export interface LocalDraft {
  graph: FlowBundleGraph;
  baseCommitId: string | null;
  updatedAt: string;
}

interface DraftLocation {
  draftPath: string;
}

function authHeaders(): Record<string, string> {
  const token = getNestAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Send one graph to Nest; the backend appends it to the flow repository file. */
export async function uploadCommit(input: CommitUploadParams) {
  const endpoint = input.sourceBranch ? 'merge' : 'commits';
  const response = await fetch(
    `${nestApiBase()}/flows/${input.flowId}/version/${endpoint}`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        branch: input.branch,
        targetBranch: input.sourceBranch ? input.branch : undefined,
        sourceBranch: input.sourceBranch,
        baseCommitId: input.baseCommitId,
        parentIds: input.parentIds,
        message: input.message,
        graph: input.graph,
        sourceCommitId: input.sourceBranch ? input.parentIds?.[1] : undefined,
      }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(
      typeof body.message === 'string'
        ? body.message
        : `Commit upload failed (${response.status})`,
    ) as Error & { status?: number; details?: unknown };
    error.status = response.status;
    error.details = body;
    throw error;
  }
  const result = await response.json() as {
    commit: FlowCommitResponse;
    graph: FlowBundleGraph;
  };
  return {
    ...result,
    manifest: result.commit,
  };
}

/** Save one local draft JSON file without contacting Nest. */
export async function saveDraft(input: CommitUploadParams): Promise<LocalDraft> {
  const location = draftLocation(input.projectId, input.flowId, input.branch);
  const draft: LocalDraft = {
    graph: input.graph,
    baseCommitId: input.baseCommitId,
    updatedAt: new Date().toISOString(),
  };
  await writeAtomically(location.draftPath, JSON.stringify(draft, null, 2));
  return draft;
}

/** Load a local draft so unsynced work survives closing and reopening the app. */
export async function loadDraft(
  projectId: number,
  flowId: number,
  branch: string,
): Promise<LocalDraft | null> {
  try {
    const raw = await fs.promises.readFile(
      draftLocation(projectId, flowId, branch).draftPath,
      'utf8',
    );
    const draft = JSON.parse(raw) as LocalDraft;
    if (
      !draft ||
      !draft.graph ||
      !Array.isArray(draft.graph.nodes) ||
      !Array.isArray(draft.graph.edges)
    ) {
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

/** Commit the draft and replace it only after the server accepts the commit. */
export async function syncDraft(input: {
  flowId: number;
  projectId: number;
  branch: string;
  message: string;
  sourceBranch?: string;
}) {
  const draft = await loadDraft(input.projectId, input.flowId, input.branch);
  if (!draft) {
    throw new Error('No local draft found. Press Save before Sync.');
  }
  const result = await uploadCommit({
    ...input,
    baseCommitId: draft.baseCommitId,
    graph: draft.graph,
  });
  await saveDraft({
    ...input,
    baseCommitId: result.commit.id,
    graph: result.graph,
    message: 'Local draft',
  });
  return result;
}

/** Download and parse one commit entry from the flow repository. */
export async function downloadCommit(
  flowId: number,
  commitId: string,
): Promise<{ graph: FlowBundleGraph; manifest: FlowCommitResponse }> {
  const response = await fetch(
    `${nestApiBase()}/flows/${flowId}/version/commits/${commitId}/download`,
    { headers: authHeaders() },
  );
  if (!response.ok) {
    throw new Error(`Commit download failed (${response.status})`);
  }
  const result = await response.json() as {
    commit: FlowCommitResponse;
    graph: FlowBundleGraph;
  };
  return {
    graph: result.graph,
    manifest: result.commit,
  };
}

function draftLocation(projectId: number, flowId: number, branch: string): DraftLocation {
  const branchPart = encodeURIComponent(branch);
  const root = path.join(
    app.getPath('userData'),
    'auto-tester',
    'flows',
    String(projectId),
    String(flowId),
  );
  return { draftPath: path.join(root, `${branchPart}.draft.json`) };
}

async function writeAtomically(filePath: string, contents: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(tempPath, contents, 'utf8');
  await fs.promises.rename(tempPath, filePath);
}
