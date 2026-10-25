import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, getBookPagesStats, listBookPages, updateBook, updateBookPageText } from '@/lib/server/books';

export async function GET(request: Request, context: RouteContext<'/api/books/[id]/pages'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to access extracted pages.' }, { status: 401 });
  const { id } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });

  const { searchParams } = new URL(request.url);

  // Quick stats mode
  if (searchParams.get('stats') === 'true') {
    const stats = await getBookPagesStats(session.userId, id, book.startPage, book.endPage);
    return NextResponse.json({ stats, book: { id: book.id, startPage: book.startPage, endPage: book.endPage, extractionStatus: book.extractionStatus } });
  }

  // Single page mode (full text + visual preview info)
  const rawPageNumber = searchParams.get('pageNumber');
  if (rawPageNumber !== null) {
    const pageNum = Number(rawPageNumber);
    if (!Number.isInteger(pageNum) || pageNum < book.startPage || pageNum > book.endPage) {
      return NextResponse.json({ error: `Invalid page number. Must be between ${book.startPage} and ${book.endPage}.` }, { status: 400 });
    }
    const pages = await listBookPages(session.userId, id, pageNum, pageNum);
    return NextResponse.json({ page: pages[0] || null, book: { id: book.id, startPage: book.startPage, endPage: book.endPage, extractionStatus: book.extractionStatus } });
  }

  const isSummaryOnly = searchParams.get('summaryOnly') === 'true';
  const fetchAll = searchParams.get('all') === 'true';

  const rawFrom = searchParams.get('from');
  const rawTo = searchParams.get('to');
  const from = rawFrom === null ? book.startPage : Math.max(book.startPage, Number(rawFrom));
  let to: number;
  if (rawTo === null) {
    to = isSummaryOnly || fetchAll ? book.endPage : Math.min(book.endPage, from + 99);
  } else {
    to = Math.min(book.endPage, Math.max(from, Number(rawTo)));
  }

  // Safe clamping for full text requests without crashing
  if (!isSummaryOnly && !fetchAll && (to - from > 99)) {
    to = from + 99;
  }

  const pages = await listBookPages(session.userId, id, from, to, { summaryOnly: isSummaryOnly });
  const available = new Set(pages.map(page => page.pdfPage));
  const missingPages = Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index)
    .filter(pageNumber => !available.has(pageNumber));
  return NextResponse.json({
    pages,
    from,
    to,
    totalPages: book.endPage - book.startPage + 1,
    missingPages,
    isComplete: missingPages.length === 0,
    book: { id: book.id, startPage: book.startPage, endPage: book.endPage, extractionStatus: book.extractionStatus }
  });
}

export async function PATCH(request: Request, context: RouteContext<'/api/books/[id]/pages'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to edit extracted pages.' }, { status: 401 });
  const { id } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const pdfPage = Number(body.pdfPage);
  if (!Number.isInteger(pdfPage) || pdfPage < book.startPage || pdfPage > book.endPage) {
    return NextResponse.json({ error: `Invalid page number. Must be between ${book.startPage} and ${book.endPage}.` }, { status: 400 });
  }
  if (typeof body.text !== 'string') {
    return NextResponse.json({ error: 'Page text must be a string.' }, { status: 400 });
  }

  try {
    const updatedPage = await updateBookPageText(session.userId, id, pdfPage, body.text);
    const stats = await getBookPagesStats(session.userId, id, book.startPage, book.endPage);
    let updatedBook = book;
    if (stats.unreviewedCount === 0 && book.extractionStatus === 'needs_review') {
      updatedBook = await updateBook({
        ...book,
        extractionStatus: 'completed',
        extractionMessage: 'All selected pages with OCR or extraction warnings have been visually checked against the PDF.',
      });
    }
    return NextResponse.json({ ok: true, page: updatedPage, book: updatedBook, stats });
  } catch (err: any) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not update page text.' }, { status: 500 });
  }
}

