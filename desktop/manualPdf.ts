import { fetchArtifactBuffer } from './artifactUpload';
import {
  bodyText,
  collectPdf,
  drawImage,
  ensureSpace,
  heading,
  sectionTitle,
  subheading,
} from './reports/pdf-report';
import { pickAndSaveFile } from './reports/saveDownload';

export type ManualPdfStep = {
  name: string;
  description: string | null;
  beforeScreenshotArtifactId?: number | null;
  afterScreenshotArtifactId?: number | null;
  screenshotArtifactId?: number | null;
};

export type ManualPdfInput = {
  id: number;
  title: string;
  flowId: number;
  steps: ManualPdfStep[];
};

/**
 * Load screenshot bytes from Nest artifacts, build the PDF locally,
 * then ask where to save it.
 */
export async function saveManualPdfToDownloads(
  input: ManualPdfInput,
): Promise<string | null> {
  type StepImages = { before?: Buffer; after?: Buffer };
  const images = new Map<number, StepImages>();

  for (let i = 0; i < input.steps.length; i++) {
    const step = input.steps[i];
    const entry: StepImages = {};
    const beforeId = step.beforeScreenshotArtifactId;
    const afterId = step.afterScreenshotArtifactId ?? step.screenshotArtifactId;
    if (beforeId) {
      const buf = await fetchArtifactBuffer(beforeId);
      if (buf) entry.before = buf;
    }
    if (afterId) {
      const buf = await fetchArtifactBuffer(afterId);
      if (buf) entry.after = buf;
    }
    if (entry.before || entry.after) images.set(i, entry);
  }

  const pdfBuffer = await collectPdf((doc) => {
    heading(doc, input.title);
    subheading(doc, `Manual #${input.id} · Flow ${input.flowId}`);

    if (!input.steps.length) {
      bodyText(doc, 'No steps in this manual.');
      return;
    }

    for (let i = 0; i < input.steps.length; i++) {
      const step = input.steps[i];
      ensureSpace(doc, 50);
      sectionTitle(doc, `${i + 1}. ${step.name}`);
      if (step.description) {
        bodyText(doc, step.description);
      } else {
        bodyText(doc, '(No description)', '#9ca3af');
      }
      const imgs = images.get(i);
      if (imgs?.before) {
        bodyText(doc, 'Before:', '#6b7280');
        drawImage(doc, imgs.before, 240);
      }
      if (imgs?.after) {
        bodyText(doc, 'After:', '#6b7280');
        drawImage(doc, imgs.after, 240);
      }
      doc.moveDown(0.6);
    }
  });

  const safeTitle = input.title.replace(/[^\w.-]+/g, '_').slice(0, 40);
  const filename = `manual-${input.id}-${safeTitle}.pdf`;
  const dest = await pickAndSaveFile({
    defaultFilename: filename,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    buffer: pdfBuffer,
  });
  if (!dest) return null;
  console.log(`[manual pdf] saved ${dest}`);
  return dest;
}
