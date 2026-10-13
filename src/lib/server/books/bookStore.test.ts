import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookPageRecord, BookRecord } from '@/lib/books/types';

let temporaryDirectory = '';
let previousBookDataDir: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = '';
  if (previousBookDataDir === undefined) delete process.env.BOOK_DATA_DIR;
  else process.env.BOOK_DATA_DIR = previousBookDataDir;
  previousBookDataDir = undefined;
  vi.resetModules();
});

describe('book extraction persistence', () => {
  it('persists page text and PDF page references, scoped to the owning user', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nightplanner-books-'));
    previousBookDataDir = process.env.BOOK_DATA_DIR;
    process.env.BOOK_DATA_DIR = temporaryDirectory;
    vi.resetModules();
    const store = await import('../books');
    const now = Date.now();
    const book: BookRecord = {
      id: 'book-1', userId: 'owner-1', title: 'Exact Text', author: 'Author', metadata: '',
      originalFilename: 'source.pdf', storedFilename: 'book-1.pdf', fileSize: 5,
      startPage: 20, endPage: 21, durationDays: 2, startDate: '2026-01-01', studyMinutes: 60, postingTime: '08:00', timezone: 'Africa/Nairobi', currentPage: 20,
      status: 'draft', extractionStatus: 'processing', extractionMessage: '', createdAt: now, updatedAt: now,
    };
    const exactText = 'Do not change this wording, punctuation, or spacing.\nNext paragraph.';
    await store.saveBook(book, new Uint8Array([37, 80, 68, 70, 45]));
    const pages: BookPageRecord[] = [
      { bookId: book.id, pdfPage: 20, text: exactText, method: 'native', confidence: null, warnings: [], requiresReview: false, updatedAt: now },
      { bookId: book.id, pdfPage: 21, text: 'Scanned words are an OCR estimate.', method: 'ocr', confidence: 92.5, warnings: ['Review against PDF.'], requiresReview: true, updatedAt: now },
    ];
    await store.saveBookPages(book, pages);

    expect((await store.listBookPages('owner-1', book.id, 20, 20)).map(page => [page.pdfPage, page.text])).toEqual([[20, exactText]]);
    expect(await store.listBookPages('other-user', book.id)).toEqual([]);
    expect(await fs.readFile(path.join(temporaryDirectory, 'books', 'book-1.pdf'))).toEqual(Buffer.from([37, 80, 68, 70, 45]));
  });

  it('restores PDF file and page preview from database when ephemeral disk file is deleted', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nightplanner-books-restore-'));
    previousBookDataDir = process.env.BOOK_DATA_DIR;
    process.env.BOOK_DATA_DIR = temporaryDirectory;
    vi.resetModules();

    // Mock neon getDb to simulate Neon DB persistent storage
    const fakeBookFiles = new Map<string, string>();
    const fakePreviews = new Map<string, string>();
    const fakeBooks = new Map<string, any>();
    const fakePages = new Map<string, any>();

    const fakeSql = Object.assign(async (strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.join('?');
      if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX') || query.includes('ALTER TABLE')) {
        return [];
      }
      if (query.includes('INSERT INTO books')) {
        const id = values[0];
        const data = typeof values[2] === 'string' ? JSON.parse(values[2]) : values[2];
        fakeBooks.set(id, data);
        return [];
      }
      if (query.includes('INSERT INTO book_files')) {
        const bookId = values[0];
        // values: book_id, filename, b64, size, now
        fakeBookFiles.set(bookId, values[2]);
        return [];
      }
      if (query.includes('INSERT INTO book_previews')) {
        const key = `${values[0]}:${values[1]}`;
        // values: book_id, page, filename, mime, b64, now
        fakePreviews.set(key, values[4]);
        return [];
      }
      if (query.includes('SELECT data FROM books WHERE id =')) {
        const id = values[0];
        const book = fakeBooks.get(id);
        return book ? [{ data: book }] : [];
      }
      if (query.includes('SELECT encode(data, \'base64\') AS data_base64\n        FROM book_files')) {
        const id = values[0];
        const b64 = fakeBookFiles.get(id);
        return b64 ? [{ data_base64: b64 }] : [];
      }
      if (query.includes('SELECT encode(data, \'base64\') AS data_base64\n        FROM book_previews')) {
        const key = `${values[0]}:${values[1]}`;
        const b64 = fakePreviews.get(key);
        return b64 ? [{ data_base64: b64 }] : [];
      }
      if (query.includes('SELECT book_id, pdf_page, text')) {
        const bookId = values[0];
        const pageNum = values[2];
        const pageRecord = fakePages.get(`${bookId}:${pageNum}`);
        return pageRecord ? [{
          book_id: pageRecord.bookId,
          pdf_page: pageRecord.pdfPage,
          text: pageRecord.text,
          method: pageRecord.method,
          confidence: pageRecord.confidence,
          warnings: pageRecord.warnings,
          requires_review: pageRecord.requiresReview,
          reviewed_by_user: pageRecord.reviewedByUser,
          visual_preview: pageRecord.visualPreview,
          updated_at: pageRecord.updatedAt,
        }] : [];
      }
      return [];
    }, {});

    vi.doMock('../neon', () => ({
      getDb: () => fakeSql,
    }));

    const store = await import('../books');
    const now = Date.now();
    const book: BookRecord = {
      id: 'book-restore-1', userId: 'owner-restore', title: 'Permanent Storage Book', author: 'Author', metadata: '',
      originalFilename: 'restore.pdf', storedFilename: 'book-restore-1.pdf', fileSize: 5,
      startPage: 1, endPage: 1, durationDays: 1, startDate: '2026-01-01', studyMinutes: 30, postingTime: '08:00', timezone: 'UTC', currentPage: 1,
      status: 'draft', extractionStatus: 'processing', extractionMessage: '', createdAt: now, updatedAt: now,
    };
    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // %PDF-1.4
    await store.saveBook(book, pdfBytes);

    // Save a page with visual preview
    const previewDir = path.join(temporaryDirectory, 'books', book.id, 'page-previews');
    await fs.mkdir(previewDir, { recursive: true });
    const previewBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // JPEG magic header
    await fs.writeFile(path.join(previewDir, 'page-1.jpg'), previewBytes);

    const pageRecord: BookPageRecord = {
      bookId: book.id,
      pdfPage: 1,
      text: 'Preview page text',
      method: 'native',
      confidence: null,
      warnings: [],
      requiresReview: false,
      reviewedByUser: false,
      visualPreview: { filename: 'page-1.jpg', mimeType: 'image/jpeg', width: 800, height: 1000 },
      updatedAt: now,
    };
    fakePages.set(`${book.id}:1`, pageRecord);
    await store.saveBookPages(book, [pageRecord]);

    // Verify it was stored in the mock database
    expect(fakeBookFiles.has(book.id)).toBe(true);
    expect(fakePreviews.has(`${book.id}:1`)).toBe(true);

    // Simulate ephemeral container wipe: delete disk PDF and preview files!
    const diskPdfPath = path.join(temporaryDirectory, 'books', book.storedFilename);
    const diskPreviewPath = path.join(previewDir, 'page-1.jpg');
    await fs.rm(diskPdfPath, { force: true });
    await fs.rm(diskPreviewPath, { force: true });
    expect(await fs.stat(diskPdfPath).catch(() => null)).toBeNull();
    expect(await fs.stat(diskPreviewPath).catch(() => null)).toBeNull();

    // Calling getBookPdfPath restores the PDF from database!
    const restoredPdfPath = await store.getBookPdfPath('owner-restore', book.id);
    expect(restoredPdfPath).toBe(diskPdfPath);
    const restoredPdfBytes = await fs.readFile(diskPdfPath);
    expect(restoredPdfBytes).toEqual(Buffer.from(pdfBytes));

    // Calling getBookPagePreviewPath restores the preview image from database!
    const restoredPreviewPath = await store.getBookPagePreviewPath('owner-restore', book.id, 1);
    expect(restoredPreviewPath).toBe(diskPreviewPath);
    const restoredPreviewBytes = await fs.readFile(diskPreviewPath);
    expect(restoredPreviewBytes).toEqual(previewBytes);
  });
});
