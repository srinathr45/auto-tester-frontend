import PDFDocument from 'pdfkit';

/**
 * Build a PDF buffer from a PDFKit document via stream collect.
 */
export function collectPdf(
  build: (doc: PDFKit.PDFDocument) => void | Promise<void>,
): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      info: { Author: 'Auto Tester', Creator: 'Auto Tester' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      await build(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Ensure enough vertical space; add a page if needed. */
export function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

/**
 * Draw a PNG/JPEG screenshot scaled to page width, preserving aspect.
 */
export function drawImage(
  doc: PDFKit.PDFDocument,
  buffer: Buffer,
  maxHeight = 280,
) {
  ensureSpace(doc, Math.min(maxHeight, 120) + 16);
  const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  try {
    doc.image(buffer, {
      fit: [maxWidth, maxHeight],
      align: 'center',
    });
    doc.moveDown(0.5);
  } catch {
    doc
      .fontSize(9)
      .fillColor('#b91c1c')
      .text('(Screenshot could not be rendered)')
      .fillColor('#111827');
  }
}

export function heading(doc: PDFKit.PDFDocument, text: string) {
  doc.fontSize(20).fillColor('#111827').text(text, { underline: false });
  doc.moveDown(0.4);
}

export function subheading(doc: PDFKit.PDFDocument, text: string) {
  doc.fontSize(11).fillColor('#6b7280').text(text);
  doc.moveDown(0.8);
}

export function sectionTitle(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 40);
  doc.fontSize(13).fillColor('#111827').text(text);
  doc.moveDown(0.3);
}

export function bodyText(doc: PDFKit.PDFDocument, text: string, color = '#374151') {
  doc.fontSize(10).fillColor(color).text(text, { lineGap: 2 });
  doc.moveDown(0.4);
}
