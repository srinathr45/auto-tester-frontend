import { authHeaders, request } from '../../shared/http';
import { getAccessToken } from '../../auth/authSession';
import { getApiBase } from '../../shared/apiBackendUrl';

export type ArtifactKind = 'screenshot' | 'video' | 'manual_screenshot';

export interface Artifact {
  id: number;
  projectId: number;
  flowId: number;
  resultId: number | null;
  manualId: number | null;
  stepNodeId: string | null;
  kind: ArtifactKind;
  objectKey: string;
  contentType: string;
  size: number;
  createdAt: string;
}

function apiBase(): string {
  return getApiBase();
}

export const artifactService = {
  listByResult: (resultId: number) =>
    request<Artifact[]>(`/artifacts?resultId=${resultId}`),

  listByManual: (manualId: number) =>
    request<Artifact[]>(`/artifacts?manualId=${manualId}`),

  /** Authenticated download URL for <img>/<video> (JWT via query). */
  downloadUrl: (id: number) => {
    const token = getAccessToken();
    const base = `${apiBase()}/artifacts/${id}/download`;
    if (!token) return base;
    return `${base}?access_token=${encodeURIComponent(token)}`;
  },

  /**
   * Upload a browser File (manual screenshots). Returns saved Artifact row.
   */
  upload: async (fields: {
    file: File;
    projectId: number;
    flowId: number;
    kind: ArtifactKind;
    resultId?: number | null;
    manualId?: number | null;
    stepNodeId?: string | null;
  }): Promise<Artifact> => {
    const form = new FormData();
    form.append('file', fields.file);
    form.append('projectId', String(fields.projectId));
    form.append('flowId', String(fields.flowId));
    form.append('kind', fields.kind);
    if (fields.resultId != null) form.append('resultId', String(fields.resultId));
    if (fields.manualId != null) form.append('manualId', String(fields.manualId));
    if (fields.stepNodeId) form.append('stepNodeId', fields.stepNodeId);

    const res = await fetch(`${apiBase()}/artifacts/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { message?: string }).message || `Upload failed (${res.status})`,
      );
    }
    return res.json();
  },
};
