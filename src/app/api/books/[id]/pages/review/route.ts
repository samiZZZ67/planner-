import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { approveAllBookPages, getBook, getBookPagesStats, markBookPageReviewed, updateBook } from '@/lib/server/books';

export async function POST(request: Request, context: RouteContext<'/api/books/[id]/pages/review'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to review extracted pages.' }, { status: 401 });
  const { id } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });

  const body = await request.json().catch(() => null);

  // Approve all pages at once
  if (body?.approveAll === true || body?.pdfPage === 'all') {
    try {
      const result = await approveAllBookPages(session.userId, id, book.startPage, book.endPage);
      return NextResponse.json({
        ok: true,
        book: result.book,
        stats: result.stats,
        pendingReviewCount: 0,
        message: 'All extracted pages have been approved. You can now load or generate your reading plan.',
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to approve pages.' }, { status: 400 });
    }
  }

  const pdfPage = Number(body?.pdfPage);
  if (!Number.isInteger(pdfPage) || pdfPage < book.startPage || pdfPage > book.endPage) {
    return NextResponse.json({ error: 'Page number must be inside the selected book range.' }, { status: 400 });
  }
  try {
    const page = await markBookPageReviewed(session.userId, id, pdfPage);
    const stats = await getBookPagesStats(session.userId, id, book.startPage, book.endPage);
    const pendingReview = stats.unreviewedCount;
    const updated = await updateBook({
      ...book,
      extractionStatus: pendingReview === 0 ? 'completed' : 'needs_review',
      extractionMessage: pendingReview === 0
        ? 'All selected pages with OCR or extraction warnings have been visually checked against the PDF.'
        : `${pendingReview} selected page(s) still need visual review against the PDF.`,
    });
    return NextResponse.json({ page, book: updated, pendingReviewCount: pendingReview, stats });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Page review failed.' }, { status: 400 });
  }
}
