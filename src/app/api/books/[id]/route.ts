import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { deleteBook, getBook, updateBook } from '@/lib/server/books';
import { deleteBookAssignments } from '@/lib/server/bookAssignments';
import { deleteBookPublishJobs } from '@/lib/server/bookScheduler';
import { deleteBookDeliveries } from '@/lib/server/telegram';

export async function PATCH(request: Request, context: RouteContext<'/api/books/[id]'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to update this book.' }, { status: 401 });
  const { id } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  try {
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : book.title;
    const author = typeof body.author === 'string' ? body.author.trim() : book.author;
    const metadata = typeof body.metadata === 'string' ? body.metadata.trim().slice(0, 2000) : book.metadata;
    const postingTime = typeof body.postingTime === 'string' ? body.postingTime : book.postingTime;
    const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : book.timezone;
    const startDate = typeof body.startDate === 'string' ? body.startDate : book.startDate;
    const durationDays = body.durationDays === undefined ? book.durationDays : Number(body.durationDays);
    const studyMinutes = body.studyMinutes === undefined ? book.studyMinutes : Number(body.studyMinutes);
    const currentPage = body.currentPage === undefined ? book.currentPage : Number(body.currentPage);
    if (!title || title.length > 240 || !author || author.length > 240 || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365 || !Number.isInteger(studyMinutes) || studyMinutes < 5 || studyMinutes > 1440 || !Number.isInteger(currentPage) || currentPage < book.startPage || currentPage > book.endPage) {
      return NextResponse.json({ error: 'Check the title, author, reading days, study minutes, and current page.' }, { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(postingTime) || !Number.isFinite(Date.parse(`1970-01-01T${postingTime}:00Z`)) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(`${startDate}T12:00:00Z`))) {
      return NextResponse.json({ error: 'Enter a valid start date and posting time.' }, { status: 400 });
    }
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch {
      return NextResponse.json({ error: 'Enter a valid IANA timezone.' }, { status: 400 });
    }
    const updated = await updateBook({ ...book, title, author, metadata, postingTime, timezone, startDate, durationDays, studyMinutes, currentPage });
    return NextResponse.json({ book: updated });
  } catch {
    return NextResponse.json({ error: 'Could not update this book.' }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext<'/api/books/[id]'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to delete this book.' }, { status: 401 });
  const { id } = await context.params;
  try {
    const book = await getBook(session.userId, id);
    if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
    await Promise.all([
      deleteBookAssignments(session.userId, id),
      deleteBookPublishJobs(session.userId, id),
      deleteBookDeliveries(session.userId, id),
    ]);
    await deleteBook(session.userId, id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not delete this book and its saved reading data.' }, { status: 500 });
  }
}
