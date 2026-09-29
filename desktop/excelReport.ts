import { buildRunExcel } from './reports/excel-report';
import { pickAndSaveFile } from './reports/saveDownload';
import type { RunSnapshot } from './types';

const TERMINAL_RESULTS = new Set([
  'passed',
  'passed_with_warnings',
  'failed',
  'cancelled',
]);

/**
 * Build the run Excel locally, then ask where to save it.
 * Returns null if the run is not finished or the user cancelled the dialog.
 */
export async function saveRunExcelToDownloads(
  snap: RunSnapshot,
  screenshots: Map<string, Buffer>,
): Promise<string | null> {
  if (!TERMINAL_RESULTS.has(snap.result)) return null;

  try {
    const payload = await buildRunExcel({
      resultId: snap.resultId,
      projectId: snap.projectId,
      projectName: snap.projectName,
      flowId: snap.flowId,
      flowName: snap.flowName,
      result: snap.result,
      errorMessage: snap.errorMessage,
      steps: (snap.stepProgress || []).map((step) => ({
        name: step.name,
        status: step.status,
        errorMessage: step.errorMessage ?? null,
        screenshot: screenshots.get(step.nodeId) ?? null,
      })),
    });
    const dest = await pickAndSaveFile({
      defaultFilename: payload.filename,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      buffer: payload.buffer,
    });
    if (!dest) return null;
    console.log(`[excel report] saved ${dest}`);
    return dest;
  } catch (err) {
    console.warn(
      '[excel report] save failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
