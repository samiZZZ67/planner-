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
});
