import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, listBookPages, updateBookPageText } from '@/lib/server/books';

export async function GET(request: Request, context: RouteContext<'/api/books/[id]/pages'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to access extracted pages.' }, { status: 401 });
  const { id } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  const { searchParams } = new URL(request.url);
  const rawFrom = searchParams.get('from');
  const rawTo = searchParams.get('to');
  const from = rawFrom === null ? book.startPage : Number(rawFrom);
  const to = rawTo === null ? Math.min(book.endPage, from + 99) : Number(rawTo);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < book.startPage || to > book.endPage || to < from || to - from > 99) {
    return NextResponse.json({ error: 'Page range must be within the book selection and no larger than 100 pages.' }, { status: 400 });
  }
  const pages = await listBookPages(session.userId, id, from, to);
  return NextResponse.json({ pages, book: { id: book.id, startPage: book.startPage, endPage: book.endPage, extractionStatus: book.extractionStatus } });
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
    return NextResponse.json({ ok: true, page: updatedPage });
  } catch (err: any) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not update page text.' }, { status: 500 });
  }
}

