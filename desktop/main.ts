import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { applyDotEnvFile, getApiBackendUrl, setApiBackendUrl } from './apiConfig';
import { setNestAuthToken } from './artifactUpload';
import { captureManager } from './capture';
import { saveManualPdfToDownloads, type ManualPdfInput } from './manualPdf';
import { manualStore, type CreateManualInput } from './manualStore';
import { previewBridge, type PreviewInputEvent } from './preview';
import { runner } from './runner';
import type { AiFillField, StartCaptureBody, StartRunBody } from './types';
import {
  downloadCommit,
  loadDraft,
  saveDraft,
  syncDraft,
  uploadCommit,
} from './versionControl';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL?.trim() || '';
const isDev = Boolean(DEV_SERVER_URL);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'Auto Tester',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;
  previewBridge.setWindow(win);

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
      previewBridge.setWindow(null);
    }
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
    void win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(`<!doctype html><html><body style="font-family:sans-serif;padding:40px;background:#0f1115;color:#e8eaed">
          <h1>UI failed to load</h1>
          <p><code>${validatedURL || '(no url)'}</code></p>
          <p>${errorDescription} (${errorCode})</p>
          <p>Keep Vite running, then restart Electron:</p>
          <pre style="background:#161a22;padding:12px;border-radius:8px"># terminal A
cd app && npx vite --host 127.0.0.1 --port 5173

# terminal B
cd app && env VITE_DEV_SERVER_URL=http://127.0.0.1:5173 npx electron .
</pre>
          <p>Or from repo root: <code>npm run dev:app</code> (starts Vite + Electron).</p>
        </body></html>`),
    );
  });

  if (isDev) {
    void win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function registerIpc() {
  ipcMain.handle('health', () => ({ ok: true, service: 'auto-tester-electron' }));
  ipcMain.handle('api:getBackendUrl', () => getApiBackendUrl());
  ipcMain.handle('api:setBackendUrl', (_event, url: string) => setApiBackendUrl(url));

  /** Renderer pushes JWT so main-process Nest uploads stay authenticated. */
  ipcMain.handle('auth:setToken', (_event, token: string | null) => {
    setNestAuthToken(typeof token === 'string' && token.length > 0 ? token : null);
    return { ok: true };
  });

  ipcMain.handle('runs:start', (_event, body: StartRunBody) => {
    if (!body?.resultId || body.flowId == null || body.projectId == null) {
      throw new Error('resultId, flowId, and projectId are required');
    }
    if (!Array.isArray(body.nodes)) {
      throw new Error('nodes array is required');
    }
    return runner.start({
      ...body,
      edges: body.edges || [],
      lineDelayMs: Math.min(1000, Math.max(0, Number(body.lineDelayMs) || 0)),
      recordVideo: Boolean(body.recordVideo),
      manualCapture: body.manualCapture || undefined,
    });
  });

  ipcMain.handle('runs:get', (_event, id: number) => {
    const snap = runner.get(id);
    if (!snap) throw new Error(`Run ${id} not found`);
    return snap;
  });

  ipcMain.handle('runs:pause', (_event, id: number) => runner.pause(id));
  ipcMain.handle('runs:resume', (_event, id: number) => runner.resume(id));
  ipcMain.handle('runs:stop', (_event, id: number) => runner.stop(id));
  ipcMain.handle('runs:exportExcel', (_event, id: number) => runner.exportExcel(id));
  ipcMain.handle('version:commit', (_event, body: Parameters<typeof uploadCommit>[0]) =>
    uploadCommit(body),
  );
  ipcMain.handle('version:saveDraft', (_event, body: Parameters<typeof saveDraft>[0]) =>
    saveDraft(body),
  );
  ipcMain.handle('version:syncDraft', (_event, body: Parameters<typeof syncDraft>[0]) =>
    syncDraft(body),
  );
  ipcMain.handle('version:loadDraft', (_event, projectId: number, flowId: number, branch: string) =>
    loadDraft(projectId, flowId, branch),
  );
  ipcMain.handle('version:download', (_event, flowId: number, commitId: string) =>
    downloadCommit(flowId, commitId),
  );

  ipcMain.handle('manuals:list', (_event, filters?: { flowId?: number; projectId?: number }) =>
    manualStore.list(filters || {}),
  );
  ipcMain.handle('manuals:get', (_event, id: number) => manualStore.get(id));
  ipcMain.handle('manuals:create', (_event, input: CreateManualInput) =>
    manualStore.create(input),
  );
  ipcMain.handle('manuals:update', (_event, id: number, data: { title?: string }) =>
    manualStore.update(id, data),
  );
  ipcMain.handle('manuals:remove', (_event, id: number) => manualStore.remove(id));
  ipcMain.handle(
    'manuals:updateStep',
    (
      _event,
      manualId: number,
      stepId: number,
      data: Parameters<typeof manualStore.updateStep>[2],
    ) => manualStore.updateStep(manualId, stepId, data),
  );
  ipcMain.handle('manuals:exportPdf', (_event, body: ManualPdfInput) =>
    saveManualPdfToDownloads(body),
  );

  ipcMain.handle('capture:start', async (_event, body: StartCaptureBody) =>
    captureManager.start({
      ...body,
      nodes: body.nodes || [],
      edges: body.edges || [],
    }),
  );

  ipcMain.handle('capture:html', async (_event, body: StartCaptureBody) =>
    captureManager.captureHtml({
      ...body,
      nodes: body.nodes || [],
      edges: body.edges || [],
    }),
  );

  ipcMain.handle(
    'capture:sliceHtml',
    (_event, sessionId: string, body: { hint?: unknown; pickedIds?: string[] }) =>
      captureManager.sliceHtml(sessionId, body as Parameters<typeof captureManager.sliceHtml>[1]),
  );

  ipcMain.handle('capture:fields', async (_event, body: StartCaptureBody) =>
    captureManager.captureFields({
      ...body,
      nodes: body.nodes || [],
      edges: body.edges || [],
    }),
  );
  ipcMain.handle('capture:apis', async (_event, body: StartCaptureBody) =>
    captureManager.captureApis({
      ...body,
      nodes: body.nodes || [],
      edges: body.edges || [],
    }),
  );
  ipcMain.handle('capture:fieldPicker:start', (_event, sessionId: string) =>
    captureManager.startFieldPicker(sessionId),
  );
  ipcMain.handle('capture:fieldPicker:stop', (_event, sessionId: string) =>
    captureManager.stopFieldPicker(sessionId),
  );
  ipcMain.handle(
    'capture:fieldPicker:highlight',
    (_event, sessionId: string, fields: unknown[]) =>
      captureManager.highlightFields(sessionId, fields as AiFillField[]),
  );
  ipcMain.handle('capture:triggerPicker:start', (_event, sessionId: string) =>
    captureManager.startTriggerPicker(sessionId),
  );
  ipcMain.handle('capture:triggerPicker:stop', (_event, sessionId: string) =>
    captureManager.stopTriggerPicker(sessionId),
  );

  ipcMain.handle(
    'capture:events',
    (_event, sessionId: string, afterId?: number) =>
      captureManager.pollEvents(sessionId, afterId),
  );

  ipcMain.handle('capture:stop', async (_event, sessionId: string) =>
    captureManager.stop(sessionId),
  );

  // Preview: renderer → main (input); main → renderer uses webContents.send
  ipcMain.handle('preview:input', async (_event, event: PreviewInputEvent) => {
    await previewBridge.handleInput(event);
    return { ok: true };
  });

  ipcMain.handle('preview:status', () => ({
    active: previewBridge.isActive(),
    viewport: previewBridge.getViewport(),
  }));

  ipcMain.handle('preview:snapshot', () => previewBridge.captureSnapshot());
}

app.whenReady().then(() => {
  applyDotEnvFile();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
