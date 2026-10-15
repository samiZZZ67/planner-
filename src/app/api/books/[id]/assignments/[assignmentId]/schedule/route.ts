import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook } from '@/lib/server/books';
import { listBookAssignments, updateBookAssignment } from '@/lib/server/bookAssignments';
import { cancelBookPublishJob, rescheduleBookPublishJob } from '@/lib/server/bookScheduler';
import { normalizeTimeString } from '@/lib/date/ethiopianTime';
import { getZonedDateString } from '@/lib/date/bookDeliverySchedule';

export async function PATCH(request: Request, context: RouteContext<'/api/books/[id]/assignments/[assignmentId]/schedule'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to reschedule a post.' }, { status: 401 });
  const { id, assignmentId } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  const assignment = (await listBookAssignments(session.userId, id)).find(item => item.id === assignmentId);
  if (!assignment) return NextResponse.json({ error: 'Reading assignment not found.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const action = body?.action || 'reschedule';

  try {
    // 1. Cancel Action
    if (action === 'cancel') {
      const updatedAssignment = await updateBookAssignment({
        ...assignment,
        status: 'draft',
        deliveryStatus: 'cancelled',
        updatedAt: Date.now(),
      });
      await cancelBookPublishJob(session.userId, assignmentId);
      return NextResponse.json({ ok: true, action: 'cancel', assignment: updatedAssignment });
    }

    // 2. Skip Action (advance scheduled date by 1 day)
    if (action === 'skip') {
      const tz = book.timezone || 'Africa/Addis_Ababa';
      const currentParsed = new Date(`${assignment.scheduledDate}T12:00:00Z`);
      const nextDay = new Date(currentParsed.getTime() + 24 * 3600 * 1000);
      const nextDateStr = getZonedDateString(nextDay, tz);
      const normTime = normalizeTimeString(assignment.postingTime || book.postingTime || '08:00');

      const updatedAssignment = await updateBookAssignment({
        ...assignment,
        scheduledDate: nextDateStr,
        postingTime: normTime,
        deliveryStatus: 'scheduled',
        updatedAt: Date.now(),
      });
      const job = await rescheduleBookPublishJob(session.userId, book, updatedAssignment, nextDateStr, normTime);
      return NextResponse.json({ ok: true, action: 'skip', job, assignment: updatedAssignment });
    }

    // 3. Reschedule Action
    if (typeof body?.date !== 'string' || typeof body?.time !== 'string') {
      return NextResponse.json({ error: 'Provide a local date and time.' }, { status: 400 });
    }

    const normTime = normalizeTimeString(body.time);
    const targetStatus = assignment.status === 'draft' ? 'approved' : assignment.status;
    const updatedAssignment = await updateBookAssignment({
      ...assignment,
      status: targetStatus,
      scheduledDate: body.date,
      postingTime: normTime,
      deliveryStatus: 'scheduled',
      updatedAt: Date.now(),
    });
    const job = await rescheduleBookPublishJob(session.userId, book, updatedAssignment, body.date, normTime);
    return NextResponse.json({ ok: true, action: 'reschedule', job, assignment: updatedAssignment });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update this schedule.' }, { status: 409 });
  }
}
