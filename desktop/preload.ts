import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type VersionGraph = { nodes: unknown[]; edges: unknown[] };
type VersionCommit = {
  id: string;
  flowId: number;
  parentIds: string[];
  branchName: string;
  authorUserId: number;
  message: string;
  contentHash: string;
  createdAt: string;
  snapshot?: VersionGraph;
};

export type ElectronApi = {
  health: () => Promise<{ ok: boolean; service: string }>;
  getApiBackendUrl: () => Promise<string>;
  setApiBackendUrl: (url: string) => Promise<string>;
  setAuthToken: (token: string | null) => Promise<{ ok: boolean }>;
  startRun: (body: unknown) => Promise<unknown>;
  getRun: (id: number) => Promise<unknown>;
  pauseRun: (id: number) => Promise<unknown>;
  resumeRun: (id: number) => Promise<unknown>;
  stopRun: (id: number) => Promise<unknown>;
  exportRunExcel: (id: number) => Promise<string | null>;
  createFlowCommit: (body: {
    flowId: number;
    projectId: number;
    branch: string;
    baseCommitId: string | null;
    parentIds?: string[];
    message: string;
    graph: VersionGraph;
    sourceBranch?: string;
  }) => Promise<{
    commit: VersionCommit;
    graph: VersionGraph;
    manifest: VersionCommit;
  }>;
  saveFlowDraft: (body: {
    flowId: number;
    projectId: number;
    branch: string;
    baseCommitId: string | null;
    message: string;
    graph: VersionGraph;
  }) => Promise<{
    graph: VersionGraph;
    baseCommitId: string | null;
    updatedAt: string;
  }>;
  syncFlowDraft: (body: {
    flowId: number;
    projectId: number;
    branch: string;
    message: string;
    sourceBranch?: string;
  }) => Promise<{
    commit: VersionCommit;
    graph: VersionGraph;
    manifest: VersionCommit;
  }>;
  loadFlowDraft: (
    projectId: number,
    flowId: number,
    branch: string,
  ) => Promise<unknown>;
  downloadFlowCommit: (flowId: number, commitId: string) => Promise<{
    graph: VersionGraph;
    manifest: VersionCommit;
  }>;
  listManuals: (filters?: { flowId?: number; projectId?: number }) => Promise<unknown>;
  getManual: (id: number) => Promise<unknown>;
  createManual: (input: unknown) => Promise<unknown>;
  updateManual: (id: number, data: { title?: string }) => Promise<unknown>;
  removeManual: (id: number) => Promise<{ ok: true }>;
  updateManualStep: (manualId: number, stepId: number, data: unknown) => Promise<unknown>;
  exportManualPdf: (body: unknown) => Promise<string | null>;
  startCapture: (body: unknown) => Promise<unknown>;
  captureHtml: (body: unknown) => Promise<unknown>;
  sliceHtml: (sessionId: string, body: unknown) => Promise<unknown>;
  captureFields: (body: unknown) => Promise<unknown>;
  captureApis: (body: unknown) => Promise<unknown>;
  startFieldPicker: (sessionId: string) => Promise<{ ok: true }>;
  stopFieldPicker: (sessionId: string) => Promise<{ ok: true }>;
  startTriggerPicker: (sessionId: string) => Promise<{ ok: true }>;
  stopTriggerPicker: (sessionId: string) => Promise<{ ok: true }>;
  highlightFields: (sessionId: string, fields: unknown[]) => Promise<{ ok: true }>;
  captureEvents: (sessionId: string, afterId?: number) => Promise<unknown>;
  stopCapture: (sessionId: string) => Promise<{ ok: true; eventCount: number }>;
  previewInput: (event: unknown) => Promise<{ ok: boolean }>;
  getPreviewStatus: () => Promise<{ active: boolean; viewport: { width: number; height: number } }>;
  getPageSnapshot: () => Promise<{ active: boolean; snapshot: string }>;
  onPreviewFrame: (cb: (payload: unknown) => void) => () => void;
  onPreviewStatus: (cb: (payload: unknown) => void) => () => void;
  onPreviewFieldPicker: (cb: (payload: unknown) => void) => () => void;
  onPreviewTriggerPicker: (cb: (payload: unknown) => void) => () => void;
};

const api: ElectronApi = {
  health: () => ipcRenderer.invoke('health'),
  getApiBackendUrl: () => ipcRenderer.invoke('api:getBackendUrl'),
  setApiBackendUrl: (url) => ipcRenderer.invoke('api:setBackendUrl', url),
  setAuthToken: (token) => ipcRenderer.invoke('auth:setToken', token),
  startRun: (body) => ipcRenderer.invoke('runs:start', body),
  getRun: (id) => ipcRenderer.invoke('runs:get', id),
  pauseRun: (id) => ipcRenderer.invoke('runs:pause', id),
  resumeRun: (id) => ipcRenderer.invoke('runs:resume', id),
  stopRun: (id) => ipcRenderer.invoke('runs:stop', id),
  exportRunExcel: (id) => ipcRenderer.invoke('runs:exportExcel', id),
  createFlowCommit: (body) => ipcRenderer.invoke('version:commit', body),
  saveFlowDraft: (body) => ipcRenderer.invoke('version:saveDraft', body),
  syncFlowDraft: (body) => ipcRenderer.invoke('version:syncDraft', body),
  loadFlowDraft: (projectId, flowId, branch) =>
    ipcRenderer.invoke('version:loadDraft', projectId, flowId, branch),
  downloadFlowCommit: (flowId, commitId) =>
    ipcRenderer.invoke('version:download', flowId, commitId),
  listManuals: (filters) => ipcRenderer.invoke('manuals:list', filters),
  getManual: (id) => ipcRenderer.invoke('manuals:get', id),
  createManual: (input) => ipcRenderer.invoke('manuals:create', input),
  updateManual: (id, data) => ipcRenderer.invoke('manuals:update', id, data),
  removeManual: (id) => ipcRenderer.invoke('manuals:remove', id),
  updateManualStep: (manualId, stepId, data) =>
    ipcRenderer.invoke('manuals:updateStep', manualId, stepId, data),
  exportManualPdf: (body) => ipcRenderer.invoke('manuals:exportPdf', body),
  startCapture: (body) => ipcRenderer.invoke('capture:start', body),
  captureHtml: (body) => ipcRenderer.invoke('capture:html', body),
  sliceHtml: (sessionId, body) => ipcRenderer.invoke('capture:sliceHtml', sessionId, body),
  captureFields: (body) => ipcRenderer.invoke('capture:fields', body),
  captureApis: (body) => ipcRenderer.invoke('capture:apis', body),
  startFieldPicker: (sessionId) => ipcRenderer.invoke('capture:fieldPicker:start', sessionId),
  stopFieldPicker: (sessionId) => ipcRenderer.invoke('capture:fieldPicker:stop', sessionId),
  startTriggerPicker: (sessionId) => ipcRenderer.invoke('capture:triggerPicker:start', sessionId),
  stopTriggerPicker: (sessionId) => ipcRenderer.invoke('capture:triggerPicker:stop', sessionId),
  highlightFields: (sessionId, fields) =>
    ipcRenderer.invoke('capture:fieldPicker:highlight', sessionId, fields),
  captureEvents: (sessionId, afterId) =>
    ipcRenderer.invoke('capture:events', sessionId, afterId),
  stopCapture: (sessionId) => ipcRenderer.invoke('capture:stop', sessionId),
  previewInput: (event) => ipcRenderer.invoke('preview:input', event),
  getPreviewStatus: () => ipcRenderer.invoke('preview:status'),
  getPageSnapshot: () => ipcRenderer.invoke('preview:snapshot'),
  onPreviewFrame: (cb) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on('preview:frame', handler);
    return () => ipcRenderer.removeListener('preview:frame', handler);
  },
  onPreviewStatus: (cb) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on('preview:status', handler);
    return () => ipcRenderer.removeListener('preview:status', handler);
  },
  onPreviewFieldPicker: (cb) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on('preview:fieldPicker', handler);
    return () => ipcRenderer.removeListener('preview:fieldPicker', handler);
  },
  onPreviewTriggerPicker: (cb) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on('preview:triggerPicker', handler);
    return () => ipcRenderer.removeListener('preview:triggerPicker', handler);
  },
};

contextBridge.exposeInMainWorld('autoTester', api);
