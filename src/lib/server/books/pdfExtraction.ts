import fs from 'node:fs/promises';
import path from 'node:path';
import type { BookPageRecord } from '@/lib/books/types';
import { sanitizeUtf8 } from '../telegramFormatter';

export interface PdfExtractionOptions {
  bookId: string;
  filePath: string;
  startPage: number;
  endPage: number;
  pageNumbers?: number[];
  skipPages?: Set<number> | number[];
  maxPages?: number;
  signal?: AbortSignal;
  onProgress?: (page: BookPageRecord, completedPages: number, totalPages: number) => Promise<void>;
}

function reconstructText(items: any[]) {
  let output = '';
  let previous: any = null;
  for (const item of items) {
    if (typeof item?.str !== 'string' || item.str.length === 0) continue;
    const cleanStr = sanitizeUtf8(item.str);
    if (!cleanStr) continue;
    if (previous) {
      if (previous.hasEOL) {
        if (output && !output.endsWith('\n')) output += '\n';
      } else {
        const previousY = Number(previous.transform?.[5] ?? previous.y ?? 0);
        const itemY = Number(item.transform?.[5] ?? item.y ?? 0);
        const fontSize = Math.max(Number(item.height || 0), Number(previous.height || 0), 1);
        if (Math.abs(itemY - previousY) > fontSize * 0.55) {
          if (output && !output.endsWith('\n')) output += '\n';
        } else {
          const previousEndX = Number(previous.transform?.[4] ?? previous.x ?? 0) + Number(previous.width || 0);
          const itemStartX = Number(item.transform?.[4] ?? item.x ?? 0);
          const gap = itemStartX - previousEndX;
          if (gap > fontSize * 0.18 && output && !/[\s]$/.test(output) && !/^[\s]/.test(cleanStr)) output += ' ';
        }
      }
    }
    output += cleanStr;
    if (item.hasEOL && !output.endsWith('\n')) output += '\n';
    previous = item;
  }
  return sanitizeUtf8(output);
}

function reconstructLinesWithTables(lines: any[][]): string {
  const result = lines
    .map(line => {
      let output = '';
      let previous: any = null;
      for (const item of line) {
        if (typeof item?.str !== 'string' || item.str.length === 0) continue;
        const cleanStr = sanitizeUtf8(item.str);
        if (!cleanStr) continue;
        if (previous) {
          const previousEndX = Number(previous.x ?? previous.transform?.[4] ?? 0) + Number(previous.width || 0);
          const itemStartX = Number(item.x ?? item.transform?.[4] ?? 0);
          const gap = itemStartX - previousEndX;
          const fontSize = Math.max(Number(item.height || 0), Number(previous.height || 0), 1);
          // Large horizontal gap between items on the same line indicates structured table columns:
          if (gap > fontSize * 2.5) {
            output += '\t';
          } else if (gap > fontSize * 0.18 && !/[\s]$/.test(output) && !/^[\s]/.test(cleanStr)) {
            output += ' ';
          }
        }
        output += cleanStr;
        previous = item;
      }
      return output.trimEnd();
    })
    .filter(line => line.length > 0)
    .join('\n');
  return sanitizeUtf8(result);
}

async function recognizePage(page: any, canvasModule: any, worker: any) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, viewport, background: '#ffffff' }).promise;
  const png = canvas.toBuffer('image/png');
  const result = await worker.recognize(png, {}, { text: true });
  return { text: sanitizeUtf8(String(result.data.text || '').trim()), confidence: Number(result.data.confidence || 0) };
}

async function renderPagePreview(page: any, canvasModule: any, filePath: string, bookId: string, pdfPage: number) {
  const filename = `page-${pdfPage}.jpg`;
  const previewDir = path.join(path.dirname(filePath), bookId, 'page-previews');
  const previewPath = path.join(previewDir, filename);

  try {
    const stat = await fs.stat(previewPath);
    if (stat.size > 0) {
      return { filename, mimeType: 'image/jpeg' as const, width: 800, height: 1100 };
    }
  } catch {}

  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(1.5, 1400 / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale });
  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, viewport, background: '#ffffff' }).promise;
  await fs.mkdir(previewDir, { recursive: true });
  await fs.writeFile(previewPath, canvas.toBuffer('image/jpeg', 80));
  return { filename, mimeType: 'image/jpeg' as const, width: canvas.width, height: canvas.height };
}

export async function extractPdfRange(options: PdfExtractionOptions) {
  const bytes = await fs.readFile(options.filePath);

  // New extractor: pdf.js-extract
  const { PDFExtract } = await import('./pdf.js-extract/lib/index.mjs');
  const pdfExtract = new PDFExtract();

  const skipSet = options.skipPages
    ? (options.skipPages instanceof Set ? options.skipPages : new Set(options.skipPages))
    : null;

  let targetPages: number[];
  if (options.pageNumbers && options.pageNumbers.length > 0) {
    targetPages = options.pageNumbers.filter(
      p => p >= options.startPage && p <= options.endPage && (!skipSet || !skipSet.has(p))
    );
  } else {
    targetPages = [];
    for (let p = options.startPage; p <= options.endPage; p++) {
      if (!skipSet || !skipSet.has(p)) {
        targetPages.push(p);
      }
    }
  }

  if (options.maxPages && options.maxPages > 0) {
    targetPages = targetPages.slice(0, options.maxPages);
  }

  const firstPage = targetPages.length > 0 ? Math.min(...targetPages) : options.startPage;
  const lastPage = targetPages.length > 0 ? Math.max(...targetPages) : options.endPage;

  const extractResult = await pdfExtract.extractBuffer(bytes, {
    firstPage,
    lastPage,
    includeImages: false,
    includeAttachments: false,
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });

  if (!extractResult || !extractResult.pages || typeof extractResult.info?.numPages !== 'number') {
    throw new Error('PDF extraction returned no page data.');
  }

  const totalPdfPages = extractResult.info.numPages;

  if (options.startPage > totalPdfPages || options.endPage > totalPdfPages) {
    throw new Error(`Selected range exceeds the PDF's ${totalPdfPages} pages.`);
  }

  const totalPages = targetPages.length;
  const scannedPages: number[] = [];
  const skippedPages: number[] = [];
  let worker: any = null;
  let canvasModule: any = null;
  let renderDocTask: any = null;
  let renderDoc: any = null;
  let completedPages = 0;
  const results: BookPageRecord[] = [];
  const tessLanguages = (process.env.PDF_OCR_LANGS || 'eng').trim();

  try {
    for (const pdfPage of targetPages) {
      if (options.signal?.aborted) throw new Error('PDF extraction cancelled by user.');
      const pageData: any = extractResult.pages.find((p: any) => p?.info?.num === pdfPage);
      const items: any[] = pageData?.content || [];

      // Reconstruct text preserving structured lines & tables from pdf.js-extract
      let nativeText = '';
      if (pageData && PDFExtract.utils?.pageToLines) {
        const lines = PDFExtract.utils.pageToLines(pageData, 4);
        nativeText = reconstructLinesWithTables(lines);
      }
      if (!nativeText && items.length > 0) {
        nativeText = reconstructText(items);
      }

      // Visual preview metadata (fast on-demand reference; rendered on-demand when inspected)
      let visualPreview: BookPageRecord['visualPreview'] = undefined;
      const previewDir = path.join(path.dirname(options.filePath), options.bookId, 'page-previews');
      const previewPath = path.join(previewDir, `page-${pdfPage}.jpg`);
      try {
        const stat = await fs.stat(previewPath);
        if (stat.size > 0) {
          visualPreview = { filename: `page-${pdfPage}.jpg`, mimeType: 'image/jpeg' as const, width: 800, height: 1100 };
        }
      } catch {
        visualPreview = { filename: `page-${pdfPage}.jpg`, mimeType: 'image/jpeg' as const, width: 800, height: 1100 };
      }

      const warnings: string[] = [];
      let text = nativeText;
      let method: BookPageRecord['method'] = 'native';
      let confidence: number | null = null;
      let requiresReview = false;

      // Scanned document / OCR fallback
      if (nativeText.trim().length < 20) {
        try {
          if (!worker) {
            const tesseract = await import('tesseract.js');
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
          if (!canvasModule) canvasModule = await import('@napi-rs/canvas');
          if (!renderDoc) {
            const { getDocument } = await import('./pdf.js-extract/lib/pdfjs/pdf.mjs');
            renderDocTask = getDocument({ data: new Uint8Array(bytes), verbosity: -1 });
            renderDoc = await renderDocTask.promise;
          }
          const pageProxy = await renderDoc.getPage(pdfPage);
          const recognized = await recognizePage(pageProxy, canvasModule, worker);
          pageProxy.cleanup?.();
          if (recognized.text && recognized.text.trim().length > 0) {
            text = recognized.text;
            confidence = recognized.confidence;
            method = 'ocr';
            requiresReview = true;
            scannedPages.push(pdfPage);
            warnings.push(
              `OCR text is an estimate (confidence ${confidence.toFixed(1)}%). Compare this page with the PDF before using or publishing it.`
            );
          }
        } catch {
          // If OCR fails or is unavailable, page will be handled cleanly as empty/skipped
        }
      } else if (items.some((item: any) => item.dir === 'rtl')) {
        requiresReview = true;
        warnings.push('Right-to-left text ordering can vary by PDF layout; compare this page with the source.');
      }

      // Detect pages with no meaningful extracted text: skip cleanly instead of treating as errors or threats
      if (!text.trim()) {
        method = 'empty';
        requiresReview = false;
        skippedPages.push(pdfPage);
        warnings.push(`Page ${pdfPage} is blank or has no readable text (skipped).`);
      }

      const record: BookPageRecord = {
        bookId: options.bookId,
        pdfPage,
        text,
        method,
        confidence,
        warnings,
        requiresReview,
        visualPreview,
        updatedAt: Date.now(),
      };

      results.push(record);
      completedPages += 1;
      if (options.onProgress) await options.onProgress(record, completedPages, totalPages);
    }
  } finally {
    if (worker) await worker.terminate().catch(() => null);
    if (renderDocTask) await renderDocTask.destroy().catch(() => null);
  }

  return { pages: results, totalPdfPages, scannedPages, skippedPages, ocrLanguages: tessLanguages };
}

export function reconstructPdfTextForTest(items: any[]) {
  return reconstructText(items);
}
