import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook } from '@/lib/server/books';
import { listBookAssignments } from '@/lib/server/bookAssignments';
import { rescheduleBookPublishJob } from '@/lib/server/bookScheduler';
import { updateBookAssignment } from '@/lib/server/bookAssignments';

export async function PATCH(request: Request, context: RouteContext<'/api/books/[id]/assignments/[assignmentId]/schedule'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to reschedule a post.' }, { status: 401 });
  const { id, assignmentId } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  const assignment = (await listBookAssignments(session.userId, id)).find(item => item.id === assignmentId);
  if (!assignment) return NextResponse.json({ error: 'Reading assignment not found.' }, { status: 404 });
  if (assignment.status !== 'approved') return NextResponse.json({ error: 'Approve the assignment before scheduling it.' }, { status: 409 });
  const body = await request.json().catch(() => null);
  if (typeof body?.date !== 'string' || typeof body?.time !== 'string') return NextResponse.json({ error: 'Provide a local date and time.' }, { status: 400 });
  try {
    const job = await rescheduleBookPublishJob(session.userId, book, assignment, body.date, body.time);
    const updatedAssignment = await updateBookAssignment({ ...assignment, scheduledDate: body.date, updatedAt: Date.now() });
    return NextResponse.json({ job, assignment: updatedAssignment });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not reschedule this post.' }, { status: 409 });
  }
}
