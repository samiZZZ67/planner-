import fs from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, getBookPdfPath, saveBookPages, updateBook } from '@/lib/server/books';
import { extractPdfRange } from '@/lib/server/books/pdfExtraction';

export async function POST(request: Request, context: RouteContext<'/api/books/[id]/extract'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to extract this book.' }, { status: 401 });
  const { id } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  if (book.extractionStatus === 'processing') return NextResponse.json({ error: 'This book is already being extracted.' }, { status: 409 });
  const pdfPath = await getBookPdfPath(session.userId, id);
  if (!pdfPath) return NextResponse.json({ error: 'The stored PDF is unavailable on this server.' }, { status: 404 });

  const started = await updateBook({
    ...book,
    status: 'processing',
    extractionStatus: 'processing',
    extractionProgress: { completedPages: 0, totalPages: book.endPage - book.startPage + 1 },
    extractionMessage: 'Reading selectable PDF text and checking scanned pages.',
  });
  let pendingPages: Parameters<typeof saveBookPages>[1] = [];
  try {
    const result = await extractPdfRange({
      bookId: book.id,
      filePath: pdfPath,
      startPage: book.startPage,
      endPage: book.endPage,
      onProgress: async (page, completedPages, totalPages) => {
        pendingPages.push(page);
        if (pendingPages.length >= 8 || completedPages === totalPages) {
          await saveBookPages(book, pendingPages);
          pendingPages = [];
          await updateBook({
            ...started,
            extractionProgress: { completedPages, totalPages },
            extractionMessage: `Extracted ${completedPages} of ${totalPages} selected pages.`,
          });
        }
      },
    });
    if (pendingPages.length) await saveBookPages(book, pendingPages);
    const needsReviewCount = result.pages.filter(page => page.requiresReview).length;
    const extractionStatus = needsReviewCount ? 'needs_review' : 'completed';
    const updated = await updateBook({
      ...started,
      status: 'draft',
      extractionStatus,
      totalPdfPages: result.totalPdfPages,
      extractionProgress: { completedPages: result.pages.length, totalPages: result.pages.length },
      extractionMessage: needsReviewCount
        ? `Extracted ${result.pages.length} selected pages. ${needsReviewCount} page(s) contain OCR or extraction warnings and need visual review against the PDF.`
        : `Extracted selectable text from all ${result.pages.length} selected pages. Review the pages before generating or publishing study material.`,
    });
    return NextResponse.json({
      book: updated,
      extractedPageCount: result.pages.length,
      ocrPageNumbers: result.scannedPages,
      ocrLanguages: result.ocrLanguages,
      reviewPageNumbers: result.pages.filter(page => page.requiresReview).map(page => page.pdfPage),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PDF extraction failed.';
    const failed = await updateBook({
      ...started,
      status: 'draft',
      extractionStatus: 'failed',
      extractionMessage: message,
    }).catch(() => started);
    return NextResponse.json({ error: message, book: failed }, { status: 422 });
  }
}
