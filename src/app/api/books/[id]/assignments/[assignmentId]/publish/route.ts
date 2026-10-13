import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, listBookPages } from '@/lib/server/books';
import { listBookAssignments } from '@/lib/server/bookAssignments';
import { publishApprovedAssignment } from '@/lib/server/telegram';
import { listBookPublishJobs, updateBookPublishJob } from '@/lib/server/bookScheduler';

export async function POST(request: Request, context: RouteContext<'/api/books/[id]/assignments/[assignmentId]/publish'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to publish a reading assignment.' }, { status: 401 });
  const { id, assignmentId } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  const assignment = (await listBookAssignments(session.userId, id)).find(item => item.id === assignmentId);
  if (!assignment) return NextResponse.json({ error: 'Reading assignment not found.' }, { status: 404 });
  if (assignment.status !== 'approved' || !assignment.studyNotes) return NextResponse.json({ error: 'Approve this assignment and its study notes before publishing.' }, { status: 409 });
  try {
    const pages = await listBookPages(session.userId, id, assignment.startPdfPage, assignment.endPdfPage);
    const previous = (await listBookAssignments(session.userId, id)).find(item => item.dayNumber === assignment.dayNumber - 1);
    const delivery = await publishApprovedAssignment(session.userId, book, assignment, pages, previous);
    const job = (await listBookPublishJobs(session.userId)).find(item => item.assignmentId === assignmentId);
    if (job) await updateBookPublishJob({ ...job, status: 'completed', lastError: '' });
    return NextResponse.json({ delivery });
  } catch (error) {
    const failure = error as Error & { delivery?: unknown };
    const retry = failure.delivery as { safeToRetry?: boolean; retryAfterAt?: number | null } | undefined;
    const job = (await listBookPublishJobs(session.userId)).find(item => item.assignmentId === assignmentId);
    if (job && retry?.safeToRetry && retry.retryAfterAt) await updateBookPublishJob({ ...job, status: 'scheduled', scheduledAt: retry.retryAfterAt, lastError: failure.message });
    return NextResponse.json({ error: failure.message, delivery: failure.delivery }, { status: /already exists/i.test(failure.message) ? 409 : 502 });
  }
}
