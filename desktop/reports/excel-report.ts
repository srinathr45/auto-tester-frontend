import ExcelJS from 'exceljs';

export type RunExcelStep = {
  name: string;
  status: string;
  errorMessage?: string | null;
  screenshot?: Buffer | null;
};

export type RunExcelInput = {
  resultId: number;
  projectId: number;
  projectName?: string;
  flowId: number;
  flowName?: string;
  result: string;
  errorMessage?: string | null;
  steps: RunExcelStep[];
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF111827' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
};

/** Viewport thumbnail size inside the Steps sheet (16:9). */
const IMAGE_WIDTH = 420;
const IMAGE_HEIGHT = 236;
const IMAGE_ROW_HEIGHT = 185;

function statusFill(status: string): ExcelJS.Fill | undefined {
  const key = status.toLowerCase();
  if (key === 'passed') {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
  }
  if (key === 'warned' || key === 'passed_with_warnings') {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
  }
  if (key === 'failed' || key === 'cancelled') {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
  }
  return undefined;
}

function countByStatus(steps: RunExcelStep[], status: string): number {
  return steps.filter((s) => s.status.toLowerCase() === status).length;
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'run';
}

/**
 * Build a run Excel workbook: Summary sheet + per-step results with
 * embedded PNG screenshots. Returns xlsx bytes and a download filename.
 */
export async function buildRunExcel(input: RunExcelInput): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Auto Tester';
  workbook.created = new Date();

  const generatedAt = new Date().toISOString();
  const steps = input.steps || [];
  const screenshotCount = steps.filter((s) => s.screenshot?.length).length;

  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: 'Field', key: 'field', width: 22 },
    { header: 'Value', key: 'value', width: 60 },
  ];
  styleHeader(summary);
  summary.addRows([
    { field: 'Run ID', value: String(input.resultId) },
    { field: 'Project', value: input.projectName || `Project #${input.projectId}` },
    { field: 'Flow', value: input.flowName || `Flow #${input.flowId}` },
    { field: 'Status', value: input.result },
    { field: 'Error', value: input.errorMessage || '' },
    { field: 'Generated at', value: generatedAt },
    { field: 'Steps total', value: steps.length },
    { field: 'Passed', value: countByStatus(steps, 'passed') },
    { field: 'Warned', value: countByStatus(steps, 'warned') },
    { field: 'Failed', value: countByStatus(steps, 'failed') },
    { field: 'Pending', value: countByStatus(steps, 'pending') },
    { field: 'Screenshots', value: screenshotCount },
  ]);
  const statusCell = summary.getCell('B5');
  const fill = statusFill(input.result);
  if (fill) statusCell.fill = fill;

  const stepsSheet = workbook.addWorksheet('Steps');
  stepsSheet.columns = [
    { header: '#', key: 'index', width: 8 },
    { header: 'Step', key: 'name', width: 28 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Error', key: 'error', width: 40 },
    { header: 'Screenshot', key: 'shot', width: 62 },
  ];
  styleHeader(stepsSheet);
  stepsSheet.views = [{ state: 'frozen', ySplit: 1 }];

  steps.forEach((step, i) => {
    const row = stepsSheet.addRow({
      index: i + 1,
      name: step.name || `Step ${i + 1}`,
      status: step.status,
      error: step.errorMessage || '',
      shot: step.screenshot?.length ? '' : '(none)',
    });
    const stepFill = statusFill(step.status);
    if (stepFill) {
      row.getCell('status').fill = stepFill;
    }
    row.alignment = { vertical: 'top', wrapText: true };

    if (step.screenshot?.length) {
      row.height = IMAGE_ROW_HEIGHT;
      const imageId = workbook.addImage({
        // exceljs Buffer types clash with Node 22 — base64 avoids the mismatch.
        base64: step.screenshot.toString('base64'),
        extension: 'png',
      });
      // Header is row 1; data starts at row 2. exceljs tl is 0-based.
      const excelRow = i + 2;
      stepsSheet.addImage(imageId, {
        tl: { col: 4, row: excelRow - 1 },
        ext: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
        editAs: 'oneCell',
      });
    }
  });

  const raw = await workbook.xlsx.writeBuffer();
  const flowPart = safeFilenamePart(input.flowName || `flow-${input.flowId}`);
  const statusPart = safeFilenamePart(input.result);
  return {
    buffer: Buffer.from(raw),
    filename: `run-${input.resultId}-${flowPart}-${statusPart}.xlsx`,
  };
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle' };
}
