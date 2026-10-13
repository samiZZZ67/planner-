import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { extractPdfRange, reconstructPdfTextForTest } from './pdfExtraction';

let temporaryDirectory = '';

function onePageTextPdf(text: string) {
  const escapedText = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 12 Tf 24 150 Td (${escapedText}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

async function onePageScannedPdf() {
  const { createCanvas } = await import('@napi-rs/canvas');
  const width = 1100;
  const height = 220;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#111111';
  context.font = 'bold 90px Arial';
  context.fillText('SCANNED TEXT', 30, 145);
  const rgba = context.getImageData(0, 0, width, height).data;
  const rgb = Buffer.alloc(width * height * 3);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    rgb[target] = rgba[source];
    rgb[target + 1] = rgba[source + 1];
    rgb[target + 2] = rgba[source + 2];
  }
  const imageStream = zlib.deflateSync(rgb);
  const contents = Buffer.from('q 550 0 0 110 0 0 cm /Im0 Do Q', 'ascii');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'ascii'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 550 110] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>', 'ascii'),
    Buffer.concat([Buffer.from(`<< /Length ${contents.length} >>\nstream\n`, 'ascii'), contents, Buffer.from('\nendstream', 'ascii')]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${imageStream.length} >>\nstream\n`, 'ascii'), imageStream, Buffer.from('\nendstream', 'ascii')]),
  ];
  let pdf = Buffer.from('%PDF-1.4\n', 'ascii');
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n`, 'ascii'), objects[index], Buffer.from('\nendobj\n', 'ascii')]);
  }
  const xrefOffset = pdf.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf = Buffer.concat([pdf, Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, 'ascii')]);
  return pdf;
}

afterEach(async () => {
  if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = '';
});

describe('PDF text extraction', () => {
  it('retains directly extractable PDF wording and page number without using an LLM', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nightplanner-pdf-'));
    const filePath = path.join(temporaryDirectory, 'source.pdf');
    const sourceText = 'Original wording, punctuation, and terms stay intact.';
    await fs.writeFile(filePath, onePageTextPdf(sourceText));

    const result = await extractPdfRange({ bookId: 'test-book', filePath, startPage: 1, endPage: 1 });

    expect(result.totalPdfPages).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pdfPage).toBe(1);
    expect(result.pages[0].method).toBe('native');
    expect(result.pages[0].text).toBe(sourceText);
  });

  it('keeps PDF text item order and inserts line breaks and spacing from item positions', () => {
    const reconstructed = reconstructPdfTextForTest([
      { str: 'Keep', transform: [1, 0, 0, 12, 0, 30], width: 24, height: 12, hasEOL: false },
      { str: 'these words.', transform: [1, 0, 0, 12, 28, 30], width: 60, height: 12, hasEOL: true },
      { str: 'As a new line.', transform: [1, 0, 0, 12, 0, 15], width: 80, height: 12, hasEOL: false },
    ]);
    expect(reconstructed).toBe('Keep these words.\nAs a new line.');
  });

  (process.env.RUN_PDF_OCR_INTEGRATION === '1' ? it : it.skip)('recognizes scanned page text and flags OCR as requiring review', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nightplanner-ocr-'));
    const filePath = path.join(temporaryDirectory, 'scanned.pdf');
    await fs.writeFile(filePath, await onePageScannedPdf());

    const result = await extractPdfRange({ bookId: 'ocr-book', filePath, startPage: 1, endPage: 1 });

    expect(result.scannedPages).toEqual([1]);
    expect(result.pages[0].method).toBe('ocr');
    expect(result.pages[0].text.toUpperCase()).toContain('SCANNED TEXT');
    expect(result.pages[0].requiresReview).toBe(true);
  }, 120_000);
});
