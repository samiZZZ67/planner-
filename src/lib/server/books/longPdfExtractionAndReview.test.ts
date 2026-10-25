import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookPageRecord, BookRecord } from '@/lib/books/types';

let temporaryDirectory = '';
let previousBookDataDir: string | undefined;

// Helper to generate a valid multi-page PDF document with selectable text on every page
function generateMultiPagePdf(pagesText: string[]): Buffer {
  const pageCount = pagesText.length;
  // Object IDs:
  // 1: Catalog
  // 2: Pages root
  // 3: Font
  // For each page i (0-indexed):
  //   Page obj id: 4 + i * 2
  //   Content stream obj id: 5 + i * 2
  const fontObjId = 3;
  const pageObjIds: number[] = [];
  const objects: { id: number; body: string | Buffer }[] = [];

  for (let i = 0; i < pageCount; i++) {
    const pageId = 4 + i * 2;
    const contentId = 5 + i * 2;
    pageObjIds.push(pageId);

    const text = pagesText[i];
    const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const stream = `BT /F1 12 Tf 24 150 Td (${escaped}) Tj ET`;

    objects.push({
      id: pageId,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 ${fontObjId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    });
    objects.push({
      id: contentId,
      body: Buffer.concat([
        Buffer.from(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`),
      ]),
    });
  }

  const catalogObj = {
    id: 1,
    body: '<< /Type /Catalog /Pages 2 0 R >>',
  };
  const pagesObj = {
    id: 2,
    body: `<< /Type /Pages /Kids [${pageObjIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  };
  const fontObj = {
    id: 3,
    body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };

  const allObjects = [catalogObj, pagesObj, fontObj, ...objects].sort((a, b) => a.id - b.id);

  let pdfHeader = Buffer.from('%PDF-1.4\n', 'ascii');
  const offsets: number[] = [0];
  let currentOffset = pdfHeader.length;
  const chunks: Buffer[] = [pdfHeader];

  for (const obj of allObjects) {
    offsets.push(currentOffset);
    const header = Buffer.from(`${obj.id} 0 obj\n`, 'ascii');
    const footer = Buffer.from('\nendobj\n', 'ascii');
    const body = typeof obj.body === 'string' ? Buffer.from(obj.body, 'ascii') : obj.body;
    const combined = Buffer.concat([header, body, footer]);
    chunks.push(combined);
    currentOffset += combined.length;
  }

  const xrefOffset = currentOffset;
  let xref = `xref\n0 ${allObjects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= allObjects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${allObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref + trailer, 'ascii'));

  return Buffer.concat(chunks);
}

afterEach(async () => {
  if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = '';
  if (previousBookDataDir === undefined) delete process.env.BOOK_DATA_DIR;
  else process.env.BOOK_DATA_DIR = previousBookDataDir;
  previousBookDataDir = undefined;
  vi.resetModules();
});

describe('Long PDF Extraction, Batching, Persistence, and Review Suite', () => {
  it('generates and extracts a short PDF (< 10 pages) completely and stores pages in dedicated pages.json without bloating books.json', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'np-short-pdf-'));
    previousBookDataDir = process.env.BOOK_DATA_DIR;
    process.env.BOOK_DATA_DIR = temporaryDirectory;
    vi.resetModules();

    const store = await import('../books');
    const { extractPdfRange } = await import('./pdfExtraction');

    const pageTexts = [
      'Page 1 introduction with full selectable text paragraphs.',
      'Page 2 chapter 1 concepts and complete explanations.',
      'Page 3 deep dive on subject matter with plenty of text.',
      'Page 4 advanced concepts and study notes.',
      'Page 5 conclusions and reading summaries for today.'
    ];
    const pdfBuffer = generateMultiPagePdf(pageTexts);

    const now = Date.now();
    const book: BookRecord = {
      id: 'short-book-1',
      userId: 'test-user-1',
      title: 'Short Book Test',
      author: 'Author One',
      metadata: '',
      originalFilename: 'short.pdf',
      storedFilename: 'short-book.pdf',
      fileSize: pdfBuffer.length,
      startPage: 1,
      endPage: 5,
      durationDays: 5,
      startDate: '2026-01-01',
      studyMinutes: 30,
      postingTime: '08:00',
      timezone: 'UTC',
      currentPage: 1,
      status: 'draft',
      extractionStatus: 'processing',
      extractionMessage: '',
      createdAt: now,
      updatedAt: now,
    };
    await store.saveBook(book, new Uint8Array(pdfBuffer));
    const pdfPath = path.join(temporaryDirectory, 'books', 'short-book.pdf');

    // Extract pages
    const result = await extractPdfRange({
      bookId: book.id,
      filePath: pdfPath,
      startPage: 1,
      endPage: 5,
    });
    expect(result.totalPdfPages).toBe(5);
    expect(result.pages).toHaveLength(5);
    await store.saveBookPages(book, result.pages);

    // Verify stats
    const stats = await store.getBookPagesStats('test-user-1', book.id, 1, 5);
    expect(stats.isComplete).toBe(true);
    expect(stats.totalExtracted).toBe(5);
    expect(stats.missingPageNumbers).toEqual([]);
    expect(stats.extractedPageNumbers).toEqual([1, 2, 3, 4, 5]);

    // Verify page retrieval
    const pages = await store.listBookPages('test-user-1', book.id);
    expect(pages).toHaveLength(5);
    expect(pages.map(p => p.text)).toEqual(pageTexts);

    // Verify disk storage isolation:
    // 1. .data/books/short-book-1/pages.json exists with the 5 pages
    const diskPagesPath = path.join(temporaryDirectory, 'books', book.id, 'pages.json');
    const diskPages = JSON.parse(await fs.readFile(diskPagesPath, 'utf8'));
    expect(diskPages).toHaveLength(5);

    // 2. books.json does NOT contain extractedPages
    const booksJson = JSON.parse(await fs.readFile(path.join(temporaryDirectory, 'books.json'), 'utf8'));
    expect(booksJson[0].extractedPages).toBeUndefined();
  }, 30_000);

  it('extracts a long PDF (> 10 pages, e.g. 25 pages) in safe batches, skips already extracted pages, and supports resumption', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'np-long-pdf-'));
    previousBookDataDir = process.env.BOOK_DATA_DIR;
    process.env.BOOK_DATA_DIR = temporaryDirectory;
    vi.resetModules();

    const store = await import('../books');
    const { extractPdfRange } = await import('./pdfExtraction');

    const totalPagesCount = 25;
    const pageTexts = Array.from({ length: totalPagesCount }, (_, i) => `Verbatim content for PDF page ${i + 1} of long document.`);
    const pdfBuffer = generateMultiPagePdf(pageTexts);

    const now = Date.now();
    const book: BookRecord = {
      id: 'long-book-1',
      userId: 'test-user-1',
      title: 'Long Book Test',
      author: 'Author Two',
      metadata: '',
      originalFilename: 'long.pdf',
      storedFilename: 'long-book.pdf',
      fileSize: pdfBuffer.length,
      startPage: 1,
      endPage: 25,
      durationDays: 10,
      startDate: '2026-01-01',
      studyMinutes: 30,
      postingTime: '08:00',
      timezone: 'UTC',
      currentPage: 1,
      status: 'draft',
      extractionStatus: 'processing',
      extractionMessage: '',
      createdAt: now,
      updatedAt: now,
    };
    await store.saveBook(book, new Uint8Array(pdfBuffer));
    const pdfPath = path.join(temporaryDirectory, 'books', 'long-book.pdf');

    // Batch 1: Process first 10 pages (pages 1–10)
    const batch1 = await extractPdfRange({
      bookId: book.id,
      filePath: pdfPath,
      startPage: 1,
      endPage: 25,
      pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    expect(batch1.pages).toHaveLength(10);
    await store.saveBookPages(book, batch1.pages);

    let stats = await store.getBookPagesStats('test-user-1', book.id, 1, 25);
    expect(stats.isComplete).toBe(false);
    expect(stats.totalExtracted).toBe(10);
    expect(stats.missingPageNumbers).toHaveLength(15);
    expect(stats.missingPageNumbers[0]).toBe(11);

    // Batch 2: Process next 10 pages (pages 11–20)
    const batch2 = await extractPdfRange({
      bookId: book.id,
      filePath: pdfPath,
      startPage: 1,
      endPage: 25,
      pageNumbers: stats.missingPageNumbers.slice(0, 10),
    });
    expect(batch2.pages).toHaveLength(10);
    await store.saveBookPages(book, batch2.pages);

    stats = await store.getBookPagesStats('test-user-1', book.id, 1, 25);
    expect(stats.isComplete).toBe(false);
    expect(stats.totalExtracted).toBe(20);
    expect(stats.missingPageNumbers).toHaveLength(5);
    expect(stats.missingPageNumbers).toEqual([21, 22, 23, 24, 25]);

    // Batch 3: Process final 5 pages (pages 21–25)
    const batch3 = await extractPdfRange({
      bookId: book.id,
      filePath: pdfPath,
      startPage: 1,
      endPage: 25,
      pageNumbers: stats.missingPageNumbers,
    });
    expect(batch3.pages).toHaveLength(5);
    await store.saveBookPages(book, batch3.pages);

    stats = await store.getBookPagesStats('test-user-1', book.id, 1, 25);
    expect(stats.isComplete).toBe(true);
    expect(stats.totalExtracted).toBe(25);
    expect(stats.missingPageNumbers).toEqual([]);

    // Verify all 25 pages are intact after persistence
    const allPages = await store.listBookPages('test-user-1', book.id, 1, 25);
    expect(allPages).toHaveLength(25);
    for (let i = 0; i < 25; i++) {
      expect(allPages[i].pdfPage).toBe(i + 1);
      expect(allPages[i].text).toBe(pageTexts[i]);
    }
  });

  it('supports summaryOnly mode for instant page navigation across large ranges without memory bloat', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'np-summary-'));
    previousBookDataDir = process.env.BOOK_DATA_DIR;
    process.env.BOOK_DATA_DIR = temporaryDirectory;
    vi.resetModules();

    const store = await import('../books');
    const now = Date.now();
    const book: BookRecord = {
      id: 'large-summary-book',
      userId: 'user-1',
      title: 'Large Document Summary Test',
      author: 'Author',
      metadata: '',
      originalFilename: 'doc.pdf',
      storedFilename: 'doc.pdf',
      fileSize: 1000,
      startPage: 1,
      endPage: 150,
      durationDays: 30,
      startDate: '2026-01-01',
      studyMinutes: 30,
      postingTime: '08:00',
      timezone: 'UTC',
      currentPage: 1,
      status: 'draft',
      extractionStatus: 'completed',
      extractionMessage: '',
      createdAt: now,
      updatedAt: now,
    };
    await store.saveBook(book, new Uint8Array([37, 80, 68, 70]));

    // Generate 150 page records with heavy text
    const heavyPages: BookPageRecord[] = Array.from({ length: 150 }, (_, i) => ({
      bookId: book.id,
      pdfPage: i + 1,
      text: `Paragraph ${i + 1}: `.repeat(100), // heavy text
      method: (i % 20 === 0 ? 'ocr' : 'native') as BookPageRecord['method'],
      confidence: i % 20 === 0 ? 88.5 : null,
      warnings: i % 20 === 0 ? ['OCR estimate.'] : [],
      requiresReview: i % 20 === 0,
      updatedAt: now,
    }));
    await store.saveBookPages(book, heavyPages);

    // summaryOnly: true returns empty text strings, preserving page metadata
    const summaries = await store.listBookPages('user-1', book.id, 1, 150, { summaryOnly: true });
    expect(summaries).toHaveLength(150);
    expect(summaries[0].pdfPage).toBe(1);
    expect(summaries[0].text).toBe(''); // Text stripped for bandwidth efficiency
    expect(summaries[0].requiresReview).toBe(true); // OCR warning preserved!
    expect(summaries[1].requiresReview).toBe(false);

    // Full text for a single page is still accessible
    const singlePage = await store.listBookPages('user-1', book.id, 42, 42);
    expect(singlePage).toHaveLength(1);
    expect(singlePage[0].text).toContain('Paragraph 42:');
  });

  it('updates edited text, marks pages reviewed, and transitions book extraction status', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'np-review-'));
    previousBookDataDir = process.env.BOOK_DATA_DIR;
    process.env.BOOK_DATA_DIR = temporaryDirectory;
    vi.resetModules();

    const store = await import('../books');
    const now = Date.now();
    const book: BookRecord = {
      id: 'review-book-1',
      userId: 'reviewer-1',
      title: 'Review Transition Test',
      author: 'Author',
      metadata: '',
      originalFilename: 'r.pdf',
      storedFilename: 'r.pdf',
      fileSize: 100,
      startPage: 1,
      endPage: 2,
      durationDays: 2,
      startDate: '2026-01-01',
      studyMinutes: 30,
      postingTime: '08:00',
      timezone: 'UTC',
      currentPage: 1,
      status: 'draft',
      extractionStatus: 'needs_review',
      extractionMessage: '1 page needs review',
      createdAt: now,
      updatedAt: now,
    };
    await store.saveBook(book, new Uint8Array([37, 80, 68, 70]));

    const pages: BookPageRecord[] = [
      {
        bookId: book.id,
        pdfPage: 1,
        text: 'Clean page text',
        method: 'native',
        confidence: null,
        warnings: [],
        requiresReview: false,
        reviewedByUser: false,
        updatedAt: now,
      },
      {
        bookId: book.id,
        pdfPage: 2,
        text: 'Misrecognized text from OCR',
        method: 'ocr',
        confidence: 65.0,
        warnings: ['OCR text is an estimate (confidence 65.0%).'],
        requiresReview: true,
        reviewedByUser: false,
        updatedAt: now,
      },
    ];
    await store.saveBookPages(book, pages);

    let stats = await store.getBookPagesStats('reviewer-1', book.id, 1, 2);
    expect(stats.needsReviewCount).toBe(1);
    expect(stats.unreviewedCount).toBe(1);

    // Edit text on page 2
    const correctedText = 'Corrected verbatim text for page 2.';
    const updatedPage = await store.updateBookPageText('reviewer-1', book.id, 2, correctedText);
    expect(updatedPage.text).toBe(correctedText);
    expect(updatedPage.reviewedByUser).toBe(true);
    expect(updatedPage.requiresReview).toBe(false);

    // Check stats after text edit: unreviewedCount drops to 0!
    stats = await store.getBookPagesStats('reviewer-1', book.id, 1, 2);
    expect(stats.unreviewedCount).toBe(0);

    // Mark page 1 reviewed
    const reviewedPage1 = await store.markBookPageReviewed('reviewer-1', book.id, 1);
    expect(reviewedPage1.reviewedByUser).toBe(true);
  });

  it('handles /api/books/[id]/pages for ranges > 100 pages without HTTP 400 crash', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'np-api-pages-'));
    previousBookDataDir = process.env.BOOK_DATA_DIR;
    process.env.BOOK_DATA_DIR = temporaryDirectory;
    vi.resetModules();

    // Mock authentication before importing route
    vi.doMock('@/lib/server/auth', () => ({
      getSessionUser: async () => ({ userId: 'owner-api', email: 'owner@example.com' }),
    }));

    const store = await import('../books');
    const { GET: pagesGet } = await import('../../../app/api/books/[id]/pages/route');

    const now = Date.now();
    const book: BookRecord = {
      id: 'book-120-pages',
      userId: 'owner-api',
      title: '120 Page Book',
      author: 'Author',
      metadata: '',
      originalFilename: 'b120.pdf',
      storedFilename: 'b120.pdf',
      fileSize: 500,
      startPage: 1,
      endPage: 120,
      durationDays: 30,
      startDate: '2026-01-01',
      studyMinutes: 30,
      postingTime: '08:00',
      timezone: 'UTC',
      currentPage: 1,
      status: 'ready',
      extractionStatus: 'completed',
      extractionMessage: '',
      createdAt: now,
      updatedAt: now,
    };
    await store.saveBook(book, new Uint8Array([37, 80, 68, 70]));

    // Generate 120 pages
    const pages: BookPageRecord[] = Array.from({ length: 120 }, (_, i) => ({
      bookId: book.id,
      pdfPage: i + 1,
      text: `Text of page ${i + 1}`,
      method: 'native',
      confidence: null,
      warnings: [],
      requiresReview: false,
      updatedAt: now,
    }));
    await store.saveBookPages(book, pages);

    // 1. Querying range 1..120 previously threw HTTP 400 (to - from > 99). Now it safely returns HTTP 200 clamped to 100 pages!
    const req1 = new Request('http://localhost/api/books/book-120-pages/pages?from=1&to=120');
    const res1 = await pagesGet(req1, { params: Promise.resolve({ id: 'book-120-pages' }) } as any);
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.pages).toHaveLength(100);
    expect(data1.from).toBe(1);
    expect(data1.to).toBe(100);

    // 2. Querying with all=true returns all 120 pages without throwing an error
    const req2 = new Request('http://localhost/api/books/book-120-pages/pages?from=1&to=120&all=true');
    const res2 = await pagesGet(req2, { params: Promise.resolve({ id: 'book-120-pages' }) } as any);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.pages).toHaveLength(120);

    // 3. Querying with summaryOnly=true returns all 120 pages with empty text
    const req3 = new Request('http://localhost/api/books/book-120-pages/pages?summaryOnly=true');
    const res3 = await pagesGet(req3, { params: Promise.resolve({ id: 'book-120-pages' }) } as any);
    expect(res3.status).toBe(200);
    const data3 = await res3.json();
    expect(data3.pages).toHaveLength(120);
    expect(data3.pages[0].text).toBe('');

    // 4. Querying single page by pageNumber
    const req4 = new Request('http://localhost/api/books/book-120-pages/pages?pageNumber=77');
    const res4 = await pagesGet(req4, { params: Promise.resolve({ id: 'book-120-pages' }) } as any);
    expect(res4.status).toBe(200);
    const data4 = await res4.json();
    expect(data4.page.pdfPage).toBe(77);
    expect(data4.page.text).toBe('Text of page 77');

    // 5. Querying stats only
    const req5 = new Request('http://localhost/api/books/book-120-pages/pages?stats=true');
    const res5 = await pagesGet(req5, { params: Promise.resolve({ id: 'book-120-pages' }) } as any);
    expect(res5.status).toBe(200);
    const data5 = await res5.json();
    expect(data5.stats.totalExtracted).toBe(120);
    expect(data5.stats.isComplete).toBe(true);
  });

  it('runs multi-batch extraction via POST /api/books/[id]/extract and updates progress incrementally', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'np-api-extract-'));
    previousBookDataDir = process.env.BOOK_DATA_DIR;
    process.env.BOOK_DATA_DIR = temporaryDirectory;
    vi.resetModules();

    // Mock authentication
    vi.doMock('@/lib/server/auth', () => ({
      getSessionUser: async () => ({ userId: 'owner-batch', email: 'batch@example.com' }),
    }));

    const store = await import('../books');
    const { POST: extractPost, GET: extractGet } = await import('../../../app/api/books/[id]/extract/route');
    const { GET: pagesGet } = await import('../../../app/api/books/[id]/pages/route');

    const totalPagesCount = 15;
    const pageTexts = Array.from({ length: totalPagesCount }, (_, i) => `Verbatim text content for batch test page ${i + 1} with plenty of words.`);
    const pdfBuffer = generateMultiPagePdf(pageTexts);

    const now = Date.now();
    const book: BookRecord = {
      id: 'batch-book-15',
      userId: 'owner-batch',
      title: 'Batch Book 15 Pages',
      author: 'Author',
      metadata: '',
      originalFilename: 'b15.pdf',
      storedFilename: 'b15.pdf',
      fileSize: pdfBuffer.length,
      startPage: 1,
      endPage: 15,
      durationDays: 5,
      startDate: '2026-01-01',
      studyMinutes: 30,
      postingTime: '08:00',
      timezone: 'UTC',
      currentPage: 1,
      status: 'draft',
      extractionStatus: 'pending',
      extractionMessage: 'Not started',
      createdAt: now,
      updatedAt: now,
    };
    await store.saveBook(book, new Uint8Array(pdfBuffer));

    // Batch 1: Process 10 pages
    const req1 = new Request('http://localhost/api/books/batch-book-15/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchSize: 10 }),
    });
    const res1 = await extractPost(req1, { params: Promise.resolve({ id: 'batch-book-15' }) } as any);
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.isComplete).toBe(false);
    expect(data1.completedPages).toBe(10);
    expect(data1.totalPages).toBe(15);
    expect(data1.missingCount).toBe(5);
    expect(data1.nextBatchStart).toBe(11);
    expect(data1.book.extractionStatus).toBe('processing');

    // Batch 2: Process remaining 5 pages with force: true
    const req2 = new Request('http://localhost/api/books/batch-book-15/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchSize: 10, force: true }),
    });
    const res2 = await extractPost(req2, { params: Promise.resolve({ id: 'batch-book-15' }) } as any);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.isComplete).toBe(true);
    expect(data2.completedPages).toBe(15);
    expect(data2.totalPages).toBe(15);
    expect(data2.missingCount).toBe(0);
    expect(data2.book.extractionStatus).toBe('completed');

    // Calling GET /api/books/[id]/extract returns final stats
    const reqGet = new Request('http://localhost/api/books/batch-book-15/extract');
    const resGet = await extractGet(reqGet, { params: Promise.resolve({ id: 'batch-book-15' }) } as any);
    expect(resGet.status).toBe(200);
    const dataGet = await resGet.json();
    expect(dataGet.stats.isComplete).toBe(true);
    expect(dataGet.stats.totalExtracted).toBe(15);

    // Calling GET /api/books/[id]/pages retrieves all 15 pages with verbatim text
    const reqPages = new Request('http://localhost/api/books/batch-book-15/pages?from=1&to=15');
    const resPages = await pagesGet(reqPages, { params: Promise.resolve({ id: 'batch-book-15' }) } as any);
    expect(resPages.status).toBe(200);
    const dataPages = await resPages.json();
    expect(dataPages.pages).toHaveLength(15);
    expect(dataPages.pages[14].text).toContain('batch test page 15');
  }, 30_000);

  it('detects and skips blank pages without treating them as threats, notifies skipped page numbers, and allows approval', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'np-blank-pages-'));
    previousBookDataDir = process.env.BOOK_DATA_DIR;
    process.env.BOOK_DATA_DIR = temporaryDirectory;
    vi.resetModules();

    const store = await import('../books');
    const { extractPdfRange } = await import('./pdfExtraction');

    // Pages 1, 3, 5 have meaningful text. Pages 2 and 4 are completely blank.
    const pageTexts = [
      'Meaningful chapter text on page 1 with substantial concepts.',
      '   ', // Blank / whitespace-only page
      'Meaningful chapter text on page 3 continuing the discussion.',
      '',     // Completely empty page
      'Meaningful summary text on page 5 concluding the chapter.',
    ];
    const pdfBuffer = generateMultiPagePdf(pageTexts);

    const now = Date.now();
    const book: BookRecord = {
      id: 'blank-test-book',
      userId: 'test-user-blank',
      title: 'Blank Page Test Book',
      author: 'Test Author',
      metadata: '',
      originalFilename: 'blank.pdf',
      storedFilename: 'blank.pdf',
      fileSize: pdfBuffer.length,
      startPage: 1,
      endPage: 5,
      durationDays: 5,
      startDate: '2026-01-01',
      studyMinutes: 30,
      postingTime: '08:00',
      timezone: 'UTC',
      currentPage: 1,
      status: 'draft',
      extractionStatus: 'pending',
      extractionMessage: '',
      createdAt: now,
      updatedAt: now,
    };
    await store.saveBook(book, new Uint8Array(pdfBuffer));
    const pdfPath = path.join(temporaryDirectory, 'books', 'blank.pdf');

    const result = await extractPdfRange({
      bookId: book.id,
      filePath: pdfPath,
      startPage: 1,
      endPage: 5,
    });

    // 1. Skips blank pages and notifies which page numbers were skipped
    expect(result.skippedPages).toEqual([2, 4]);
    expect(result.pages).toHaveLength(5);

    // 2. Pages 2 and 4 are marked as empty and do NOT require review as threats
    expect(result.pages[1].pdfPage).toBe(2);
    expect(result.pages[1].method).toBe('empty');
    expect(result.pages[1].requiresReview).toBe(false);
    expect(result.pages[1].warnings[0]).toContain('skipped');

    expect(result.pages[3].pdfPage).toBe(4);
    expect(result.pages[3].method).toBe('empty');
    expect(result.pages[3].requiresReview).toBe(false);

    // 3. Meaningful pages 1, 3, 5 extracted cleanly
    expect(result.pages[0].method).toBe('native');
    expect(result.pages[0].text).toContain('page 1');
    expect(result.pages[2].method).toBe('native');
    expect(result.pages[4].method).toBe('native');

    // 4. Persistence and stats
    await store.saveBookPages(book, result.pages);
    const stats = await store.getBookPagesStats('test-user-blank', book.id, 1, 5);
    expect(stats.isComplete).toBe(true);
    expect(stats.totalExtracted).toBe(5);
    expect(stats.emptyCount).toBe(2);
    expect(stats.needsReviewCount).toBe(0); // Blank pages are skipped, NOT blocking threats!
    expect(stats.unreviewedCount).toBe(0);

    // 5. Approving a blank page directly does NOT throw an error
    const approvedBlank = await store.markBookPageReviewed('test-user-blank', book.id, 2);
    expect(approvedBlank.reviewedByUser).toBe(true);
    expect(approvedBlank.requiresReview).toBe(false);

    // 6. Bulk approveAllBookPages works smoothly
    const approveAllResult = await store.approveAllBookPages('test-user-blank', book.id, 1, 5);
    expect(approveAllResult.book?.extractionStatus).toBe('completed');
    expect(approveAllResult.stats.unreviewedCount).toBe(0);
  });

  it('allows approving extracted content via review route and loading saved plan even with skipped pages', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'np-approve-route-'));
    previousBookDataDir = process.env.BOOK_DATA_DIR;
    process.env.BOOK_DATA_DIR = temporaryDirectory;
    vi.resetModules();

    vi.doMock('@/lib/server/auth', () => ({
      getSessionUser: async () => ({ userId: 'approver-1', email: 'approver@example.com' }),
    }));

    const store = await import('../books');
    const { POST: reviewPost } = await import('../../../app/api/books/[id]/pages/review/route');
    const { generateConceptReadingPlan } = await import('../readingPlan');

    const now = Date.now();
    const book: BookRecord = {
      id: 'book-review-approve',
      userId: 'approver-1',
      title: 'Review Approve Book',
      author: 'Author',
      metadata: '',
      originalFilename: 'r.pdf',
      storedFilename: 'r.pdf',
      fileSize: 100,
      startPage: 1,
      endPage: 3,
      durationDays: 3,
      startDate: '2026-01-01',
      studyMinutes: 30,
      postingTime: '08:00',
      timezone: 'UTC',
      currentPage: 1,
      status: 'draft',
      extractionStatus: 'needs_review',
      extractionMessage: '1 page needs review',
      createdAt: now,
      updatedAt: now,
    };
    await store.saveBook(book, new Uint8Array([37, 80, 68, 70]));

    const pages: BookPageRecord[] = [
      {
        bookId: book.id,
        pdfPage: 1,
        text: 'Core principles of architectural thinking: Chapter 1 provides fundamental design rules.',
        method: 'ocr',
        confidence: 72,
        warnings: ['OCR text is an estimate.'],
        requiresReview: true,
        reviewedByUser: false,
        updatedAt: now,
      },
      {
        bookId: book.id,
        pdfPage: 2,
        text: '', // Blank page (skipped)
        method: 'empty',
        confidence: null,
        warnings: ['Page 2 is blank or has no readable text (skipped).'],
        requiresReview: false,
        reviewedByUser: false,
        updatedAt: now,
      },
      {
        bookId: book.id,
        pdfPage: 3,
        text: 'Chapter 2: Component cohesion and coupling principles explained with concrete examples.',
        method: 'native',
        confidence: null,
        warnings: [],
        requiresReview: false,
        reviewedByUser: false,
        updatedAt: now,
      },
    ];
    await store.saveBookPages(book, pages);

    // Initial state: 1 unreviewed OCR page
    let stats = await store.getBookPagesStats('approver-1', book.id, 1, 3);
    expect(stats.unreviewedCount).toBe(1);

    // Post to review route with approveAll: true
    const req = new Request('http://localhost/api/books/book-review-approve/pages/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approveAll: true }),
    });
    const res = await reviewPost(req, { params: Promise.resolve({ id: 'book-review-approve' }) } as any);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Verify book extractionStatus is now completed and ready for plan loading
    expect(data.book.extractionStatus).toBe('completed');
    expect(data.pendingReviewCount).toBe(0);

    // Verify reading plan can be generated incorporating the blank page into adjacent sections
    const plan = await generateConceptReadingPlan({ book: data.book, pages });
    expect(plan.assignments.length).toBeGreaterThanOrEqual(1);
    expect(plan.assignments[0].startPdfPage).toBe(1);
    // Blank page incorporated cleanly without error
    expect(plan.issues.some(iss => iss.includes('minimal text'))).toBe(true);
  });
});
