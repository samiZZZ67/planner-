import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, listBookPages } from '@/lib/server/books';
import { listBookAssignments, updateBookAssignment } from '@/lib/server/bookAssignments';
import { rescheduleBookPublishJob, upsertBookPublishJob } from '@/lib/server/bookScheduler';

export async function GET(request: Request, context: RouteContext<'/api/books/[id]/assignments/[assignmentId]'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to access this reading assignment.' }, { status: 401 });
  const { id, assignmentId } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  const assignment = (await listBookAssignments(session.userId, id)).find(item => item.id === assignmentId);
  if (!assignment) return NextResponse.json({ error: 'Reading assignment not found.' }, { status: 404 });
  const originalPages = await listBookPages(session.userId, id, assignment.startPdfPage, assignment.endPdfPage);
  return NextResponse.json({ book: { title: book.title, author: book.author }, assignment, originalPages });
}

export async function PATCH(request: Request, context: RouteContext<'/api/books/[id]/assignments/[assignmentId]'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to edit this reading assignment.' }, { status: 401 });
  const { id, assignmentId } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  const assignments = await listBookAssignments(session.userId, id);
  const assignment = assignments.find(item => item.id === assignmentId);
  if (!assignment) return NextResponse.json({ error: 'Reading assignment not found.' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const updated = { ...assignment };

  if (typeof body.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.scheduledDate.trim())) {
    updated.scheduledDate = body.scheduledDate.trim();
  }
  if (typeof body.postingTime === 'string' && /^\d{1,2}:\d{2}$/.test(body.postingTime.trim())) {
    updated.postingTime = body.postingTime.trim();
  }
  if (Number.isInteger(body.startPdfPage) && Number.isInteger(body.endPdfPage)) {
    const start = Number(body.startPdfPage);
    const end = Number(body.endPdfPage);
    if (start < book.startPage || end > book.endPage || start > end) {
      return NextResponse.json({ error: `Page range must be within ${book.startPage} and ${book.endPage}.` }, { status: 400 });
    }
    updated.startPdfPage = start;
    updated.endPdfPage = end;
  }
  if (Array.isArray(body.concepts)) {
    updated.concepts = body.concepts;
  }
  if (typeof body.rationale === 'string') {
    updated.rationale = body.rationale.trim();
  }
  if (Number.isFinite(body.estimatedMinutes) && body.estimatedMinutes > 0) {
    updated.estimatedMinutes = Math.ceil(Number(body.estimatedMinutes));
  }
  if (['draft', 'approved', 'completed'].includes(body.status)) {
    updated.status = body.status;
  }
  updated.updatedAt = Date.now();

  await updateBookAssignment(updated);

  if (updated.status === 'approved') {
    try {
      await rescheduleBookPublishJob(session.userId, book, updated, updated.scheduledDate, updated.postingTime || book.postingTime);
    } catch {
      try {
        await upsertBookPublishJob(book, updated);
      } catch {}
    }
  }

  return NextResponse.json({ ok: true, assignment: updated });
}

