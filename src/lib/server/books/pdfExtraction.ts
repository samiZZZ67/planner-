import fs from 'node:fs/promises';
import path from 'node:path';
import type { BookPageRecord } from '@/lib/books/types';

export interface PdfExtractionOptions {
  bookId: string;
  filePath: string;
  startPage: number;
  endPage: number;
  onProgress?: (page: BookPageRecord, completedPages: number, totalPages: number) => Promise<void>;
}

function reconstructText(items: any[]) {
  let output = '';
  let previous: any = null;
  for (const item of items) {
    if (typeof item?.str !== 'string' || item.str.length === 0) continue;
    if (previous) {
      if (previous.hasEOL) {
        if (output && !output.endsWith('\n')) output += '\n';
      } else {
        const previousY = Number(previous.transform?.[5] || 0);
        const itemY = Number(item.transform?.[5] || 0);
        const fontSize = Math.max(Number(item.height || 0), Number(previous.height || 0), 1);
        if (Math.abs(itemY - previousY) > fontSize * 0.55) {
          if (output && !output.endsWith('\n')) output += '\n';
        } else {
          const previousEndX = Number(previous.transform?.[4] || 0) + Number(previous.width || 0);
          const itemStartX = Number(item.transform?.[4] || 0);
          const gap = itemStartX - previousEndX;
          if (gap > fontSize * 0.18 && output && !/[\s]$/.test(output)) output += ' ';
        }
      }
    }
    output += item.str;
    if (item.hasEOL && !output.endsWith('\n')) output += '\n';
    previous = item;
  }
  return output;
}

async function recognizePage(page: any, canvasModule: any, worker: any) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, viewport, background: '#ffffff' }).promise;
  const png = canvas.toBuffer('image/png');
  const result = await worker.recognize(png, {}, { text: true });
  return { text: String(result.data.text || '').trim(), confidence: Number(result.data.confidence || 0) };
}

export async function extractPdfRange(options: PdfExtractionOptions) {
  const bytes = await fs.readFile(options.filePath);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  const document = await loadingTask.promise;
  const totalPdfPages = document.numPages;

  if (options.startPage > totalPdfPages || options.endPage > totalPdfPages) {
    await loadingTask.destroy();
    throw new Error(`Selected range exceeds the PDF's ${totalPdfPages} pages.`);
  }

  const totalPages = options.endPage - options.startPage + 1;
  const scannedPages: number[] = [];
  let worker: any = null;
  let canvasModule: any = null;
  let completedPages = 0;
  const results: BookPageRecord[] = [];
  const tessLanguages = (process.env.PDF_OCR_LANGS || 'eng').trim();

  try {
    for (let pdfPage = options.startPage; pdfPage <= options.endPage; pdfPage += 1) {
      const page = await document.getPage(pdfPage);
      const textContent = await page.getTextContent({ includeMarkedContent: false });
      const items = textContent.items.filter((item: any) => typeof item.str === 'string');
      const nativeText = reconstructText(items);
      const warnings: string[] = [];
      let text = nativeText;
      let method: BookPageRecord['method'] = 'native';
      let confidence: number | null = null;
      let requiresReview = false;

      if (nativeText.trim().length < 20) {
        scannedPages.push(pdfPage);
        if (!worker) {
          const tesseract = await import('tesseract.js');
          canvasModule = await import('@napi-rs/canvas');
          const cachePath = path.join(process.env.BOOK_DATA_DIR?.trim() || path.join(process.cwd(), '.data'), 'tessdata');
          await fs.mkdir(cachePath, { recursive: true });
          worker = await tesseract.createWorker(tessLanguages, undefined, {
            cachePath,
            langPath: process.env.TESSERACT_LANG_PATH || undefined,
            gzip: true,
            logger: () => undefined,
          });
          await worker.setParameters({ preserve_interword_spaces: '1' });
        }
        try {
          const recognized = await recognizePage(page, canvasModule, worker);
          text = recognized.text;
          confidence = recognized.confidence;
          method = text ? 'ocr' : 'empty';
          requiresReview = true;
          warnings.push(text
            ? `OCR text is an estimate (confidence ${confidence.toFixed(1)}%). Compare this page with the PDF before using or publishing it.`
            : 'OCR did not recover readable text. This page must be inspected manually.');
        } catch (error) {
          text = '';
          method = 'empty';
          requiresReview = true;
          warnings.push(`OCR failed: ${error instanceof Error ? error.message : 'unknown OCR error'}`);
        }
      } else if (items.some((item: any) => item.dir === 'rtl')) {
        requiresReview = true;
        warnings.push('Right-to-left text ordering can vary by PDF layout; compare this page with the source.');
      }

      if (!text.trim()) {
        method = 'empty';
        requiresReview = true;
        if (warnings.length === 0) warnings.push('No selectable text or readable OCR text was found on this page.');
      }
      const record: BookPageRecord = {
        bookId: options.bookId,
        pdfPage,
        text,
        method,
        confidence,
        warnings,
        requiresReview,
        updatedAt: Date.now(),
      };
      results.push(record);
      completedPages += 1;
      if (options.onProgress) await options.onProgress(record, completedPages, totalPages);
      page.cleanup();
    }
  } finally {
    if (worker) await worker.terminate();
    await loadingTask.destroy();
  }

  return { pages: results, totalPdfPages, scannedPages, ocrLanguages: tessLanguages };
}

export function reconstructPdfTextForTest(items: any[]) {
  return reconstructText(items);
}
