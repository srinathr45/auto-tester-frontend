import { getDesktopApi } from '../../shared/http';
import type { Result, StepProgressItem } from '../../shared/types';

/**
 * Live run controls — Electron in-memory only (nothing persisted to Nest).
 */
export const resultService = {
  /** Live run snapshot from Electron main. */
  getLiveRun: async (id: number): Promise<Result> => {
    const snap = await getDesktopApi().getRun(id);
    return {
      id: snap.resultId,
      flowId: snap.flowId,
      projectId: snap.projectId,
      result: snap.result,
      stepProgress: (snap.stepProgress as StepProgressItem[] | null) ?? null,
      currentNodeId: snap.currentNodeId,
      failedStepId: snap.failedStepId,
      errorMessage: snap.errorMessage,
      pauseMessage: snap.pauseMessage ?? null,
    };
  },

  pause: (id: number) => getDesktopApi().pauseRun(id),
  resume: (id: number) => getDesktopApi().resumeRun(id),
  stop: (id: number) => getDesktopApi().stopRun(id),

  /** Rebuild Excel locally in Electron; user picks the save path. */
  downloadExcel: (resultId: number) => {
    const api = getDesktopApi();
    if (typeof api.exportRunExcel !== 'function') {
      throw new Error(
        'Excel export is unavailable. Restart the app (npm run dev) so Electron reloads preload.',
      );
    }
    return api.exportRunExcel(resultId);
  },
};
