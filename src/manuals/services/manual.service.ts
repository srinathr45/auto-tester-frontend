import { getDesktopApi } from '../../shared/http';

export interface ManualStep {
  id: number;
  manualId: number;
  orderIndex: number;
  name: string;
  description: string | null;
  stepNodeId: string | null;
  screenshotArtifactId: number | null;
  beforeScreenshotArtifactId: number | null;
  afterScreenshotArtifactId: number | null;
}

export interface Manual {
  id: number;
  projectId: number;
  flowId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  steps?: ManualStep[];
}

function api() {
  const desktop = getDesktopApi();
  if (typeof desktop.getManual !== 'function') {
    throw new Error(
      'Manuals are unavailable. Restart the app (npm run dev) so Electron reloads preload.',
    );
  }
  return desktop;
}

/** Manuals live in Electron (JSON on disk). Nest only stores screenshot artifacts. */
export const manualService = {
  listByFlow: (flowId: number) => api().listManuals({ flowId }),

  getById: (id: number) => api().getManual(id),

  create: (data: {
    projectId: number;
    flowId: number;
    title?: string;
    nodes?: Array<{ id?: string; data?: { label?: string; description?: string } }>;
  }) => api().createManual(data),

  update: (id: number, data: { title?: string }) => api().updateManual(id, data),

  remove: (id: number) => api().removeManual(id),

  updateStep: (
    manualId: number,
    stepId: number,
    data: Partial<{
      name: string;
      description: string | null;
      orderIndex: number;
      screenshotArtifactId: number | null;
      beforeScreenshotArtifactId: number | null;
      afterScreenshotArtifactId: number | null;
    }>,
  ) => api().updateManualStep(manualId, stepId, data),

  exportPdf: async (manual: Manual) => {
    const latest = await api().getManual(manual.id);
    if (typeof api().exportManualPdf !== 'function') {
      throw new Error(
        'PDF export is unavailable. Restart the app (npm run dev) so Electron reloads preload.',
      );
    }
    return api().exportManualPdf({
      id: latest.id,
      title: latest.title,
      flowId: latest.flowId,
      steps: (latest.steps || []).map((step) => ({
        name: step.name,
        description: step.description,
        beforeScreenshotArtifactId: step.beforeScreenshotArtifactId,
        afterScreenshotArtifactId: step.afterScreenshotArtifactId,
        screenshotArtifactId: step.screenshotArtifactId,
      })),
    });
  },
};
