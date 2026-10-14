import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, getBookPagesStats, getBookPdfPath, saveBookPages, updateBook } from '@/lib/server/books';
import { extractPdfRange } from '@/lib/server/books/pdfExtraction';

export async function GET(request: Request, context: RouteContext<'/api/books/[id]/extract'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to inspect extraction status.' }, { status: 401 });
  const { id } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  const stats = await getBookPagesStats(session.userId, id, book.startPage, book.endPage);
  return NextResponse.json({ book, stats });
}

export async function POST(request: Request, context: RouteContext<'/api/books/[id]/extract'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to extract this book.' }, { status: 401 });
  const { id } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const batchSize = Math.max(1, Math.min(100, Number(body.batchSize || 25)));
  const force = Boolean(body.force);

  // Stale lock check: if extraction has been processing for more than 45 seconds without updating, allow resuming
  const isStale = (Date.now() - (book.updatedAt || 0)) > 45_000;
  if (book.extractionStatus === 'processing' && !force && !isStale) {
    return NextResponse.json({
      error: 'Extraction is currently in progress. Please wait a moment or click resume.',
      book,
      canResume: true,
    }, { status: 409 });
  }

  const pdfPath = await getBookPdfPath(session.userId, id);
  if (!pdfPath) return NextResponse.json({ error: 'The stored PDF is unavailable on this server.' }, { status: 404 });

  const currentStats = await getBookPagesStats(session.userId, id, book.startPage, book.endPage);

  // If all pages are already extracted, finalize status and return
  if (currentStats.missingPageNumbers.length === 0) {
    const finalStatus = currentStats.needsReviewCount > 0 ? 'needs_review' : 'completed';
    const updated = await updateBook({
      ...book,
      status: 'draft',
      extractionStatus: finalStatus,
      extractionProgress: { completedPages: currentStats.totalExpected, totalPages: currentStats.totalExpected },
      extractionMessage: currentStats.needsReviewCount > 0
        ? `All ${currentStats.totalExpected} selected pages are extracted. ${currentStats.needsReviewCount} page(s) contain OCR or extraction warnings and need review.`
        : `All ${currentStats.totalExpected} selected pages are extracted and verified. Ready for review.`,
    });
    return NextResponse.json({
      book: updated,
      isComplete: true,
      batchProcessed: 0,
      completedPages: currentStats.totalExpected,
      totalPages: currentStats.totalExpected,
      missingCount: 0,
      nextBatchStart: null,
      needsReviewCount: currentStats.needsReviewCount,
      ocrPageNumbers: [],
      reviewPageNumbers: [],
    });
  }

  // Determine which page numbers to process in this batch
  const pagesToExtract = Array.isArray(body.pageNumbers) && body.pageNumbers.length > 0
    ? body.pageNumbers.filter((p: number) => currentStats.missingPageNumbers.includes(p)).slice(0, batchSize)
    : currentStats.missingPageNumbers.slice(0, batchSize);

  const batchStart = pagesToExtract[0];
  const batchEnd = pagesToExtract[pagesToExtract.length - 1];

  const started = await updateBook({
    ...book,
    status: 'processing',
    extractionStatus: 'processing',
    extractionProgress: { completedPages: currentStats.totalExtracted, totalPages: currentStats.totalExpected },
    extractionMessage: `Extracting pages ${batchStart}–${batchEnd} (${currentStats.totalExtracted} of ${currentStats.totalExpected} already done)...`,
  });

  let pendingPages: Parameters<typeof saveBookPages>[1] = [];
  try {
    const result = await extractPdfRange({
      bookId: book.id,
      filePath: pdfPath,
      startPage: book.startPage,
      endPage: book.endPage,
      pageNumbers: pagesToExtract,
      onProgress: async (page, completedInBatch) => {
        pendingPages.push(page);
        if (pendingPages.length >= 8 || completedInBatch === pagesToExtract.length) {
          await saveBookPages(book, pendingPages);
          pendingPages = [];
          const curDone = currentStats.totalExtracted + completedInBatch;
          await updateBook({
            ...started,
            extractionProgress: { completedPages: curDone, totalPages: currentStats.totalExpected },
            extractionMessage: `Extracted ${curDone} of ${currentStats.totalExpected} selected pages...`,
          });
        }
      },
    });

    if (pendingPages.length) await saveBookPages(book, pendingPages);

    const newStats = await getBookPagesStats(session.userId, id, book.startPage, book.endPage);
    const isComplete = newStats.missingPageNumbers.length === 0;
    const finalExtractionStatus = isComplete
      ? (newStats.needsReviewCount > 0 ? 'needs_review' : 'completed')
      : 'processing';

    const message = isComplete
      ? (newStats.needsReviewCount > 0
          ? `Extracted all ${newStats.totalExpected} selected pages. ${newStats.needsReviewCount} page(s) contain OCR or extraction warnings and need review.`
          : `Extracted selectable text from all ${newStats.totalExpected} selected pages. Review the pages before generating or publishing study material.`)
      : `Extracted ${newStats.totalExtracted} of ${newStats.totalExpected} pages (${newStats.missingPageNumbers.length} pages remaining).`;

    const updated = await updateBook({
      ...started,
      status: isComplete ? 'draft' : 'processing',
      extractionStatus: finalExtractionStatus,
      totalPdfPages: result.totalPdfPages,
      extractionProgress: { completedPages: newStats.totalExtracted, totalPages: newStats.totalExpected },
      extractionMessage: message,
    });

    return NextResponse.json({
      book: updated,
      isComplete,
      batchProcessed: result.pages.length,
      completedPages: newStats.totalExtracted,
      totalPages: newStats.totalExpected,
      missingCount: newStats.missingPageNumbers.length,
      nextBatchStart: newStats.missingPageNumbers[0] || null,
      needsReviewCount: newStats.needsReviewCount,
      ocrPageNumbers: result.scannedPages,
      ocrLanguages: result.ocrLanguages,
      reviewPageNumbers: result.pages.filter(p => p.requiresReview).map(p => p.pdfPage),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PDF extraction failed.';
    const latestStats = await getBookPagesStats(session.userId, id, book.startPage, book.endPage).catch(() => null);
    const savedCount = latestStats?.totalExtracted || currentStats.totalExtracted;
    const failed = await updateBook({
      ...started,
      status: 'draft',
      extractionStatus: 'failed',
      extractionProgress: { completedPages: savedCount, totalPages: currentStats.totalExpected },
      extractionMessage: `Batch extraction failed: ${message}${savedCount > 0 ? ` (${savedCount} pages safely saved; click Resume to continue)` : ''}`,
    }).catch(() => started);
    return NextResponse.json({ error: message, book: failed, completedPages: savedCount }, { status: 422 });
  }
}
