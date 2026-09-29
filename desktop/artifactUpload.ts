import fs from 'node:fs';
import { nestApiBase } from './apiConfig';
import { manualStore } from './manualStore';

export { nestApiBase } from './apiConfig';

/** JWT pushed from the renderer after login so main-process Nest calls stay authenticated. */
let nestAuthToken: string | null = null;

export function setNestAuthToken(token: string | null) {
  nestAuthToken = token;
}

export function getNestAuthToken(): string | null {
  return nestAuthToken;
}

function authHeaders(): Record<string, string> {
  return nestAuthToken ? { Authorization: `Bearer ${nestAuthToken}` } : {};
}

export interface UploadArtifactParams {
  projectId: number;
  flowId: number;
  resultId?: number | null;
  manualId?: number | null;
  stepNodeId?: string | null;
  kind: 'screenshot' | 'video' | 'manual_screenshot';
  filePath?: string;
  buffer?: Buffer;
  contentType: string;
  fileName: string;
}

export interface UploadedArtifact {
  id: number;
  kind: string;
  objectKey: string;
}

/**
 * Upload a local file/buffer to Nest → MinIO from Electron main.
 * Uses multipart FormData (Node 18+ / Electron).
 */
export async function uploadArtifact(
  params: UploadArtifactParams,
): Promise<UploadedArtifact | null> {
  const apiBase = nestApiBase();
  try {
    let blob: Blob;
    if (params.buffer) {
      blob = new Blob([new Uint8Array(params.buffer)], { type: params.contentType });
    } else if (params.filePath) {
      const data = await fs.promises.readFile(params.filePath);
      blob = new Blob([new Uint8Array(data)], { type: params.contentType });
    } else {
      throw new Error('buffer or filePath required');
    }

    const form = new FormData();
    form.append('file', blob, params.fileName);
    form.append('projectId', String(params.projectId));
    form.append('flowId', String(params.flowId));
    form.append('kind', params.kind);
    if (params.resultId != null) form.append('resultId', String(params.resultId));
    if (params.manualId != null) form.append('manualId', String(params.manualId));
    if (params.stepNodeId) form.append('stepNodeId', params.stepNodeId);

    const res = await fetch(`${apiBase}/artifacts/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[artifact upload] ${res.status}: ${text}`);
      return null;
    }
    return (await res.json()) as UploadedArtifact;
  } catch (err) {
    console.error('[artifact upload] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Patch local manual step screenshot ids after auto-capture. */
export async function patchManualStep(
  manualId: number,
  stepId: number,
  patch: {
    beforeScreenshotArtifactId?: number | null;
    afterScreenshotArtifactId?: number | null;
    screenshotArtifactId?: number | null;
  },
): Promise<boolean> {
  try {
    manualStore.updateStep(manualId, stepId, patch);
    return true;
  } catch (err) {
    console.error('[manual step patch] failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Download an artifact binary from Nest (CRUD). Used by the local PDF builder. */
export async function fetchArtifactBuffer(id: number): Promise<Buffer | null> {
  try {
    const res = await fetch(`${nestApiBase()}/artifacts/${id}/download`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      console.warn(`[artifact download] ${id} → ${res.status}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn(
      `[artifact download] ${id} failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
