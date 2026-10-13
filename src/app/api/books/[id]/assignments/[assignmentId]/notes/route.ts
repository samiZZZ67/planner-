import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, listBookPages } from '@/lib/server/books';
import { listBookAssignments, updateBookAssignment } from '@/lib/server/bookAssignments';
import { generateAssignmentStudyNotes, validateStudyNotes } from '@/lib/server/studyNotes';
import { getModelById } from '@/lib/server/freellm/catalog';
import { makeBookPublishJob, upsertBookPublishJob } from '@/lib/server/bookScheduler';

async function getOwnedAssignment(userId: string, bookId: string, assignmentId: string) {
  const book = await getBook(userId, bookId);
  if (!book) return { error: 'Book not found.' as const };
  const assignment = (await listBookAssignments(userId, bookId)).find(item => item.id === assignmentId);
  if (!assignment) return { error: 'Reading assignment not found.' as const };
  return { book, assignment };
}

export async function POST(request: Request, context: RouteContext<'/api/books/[id]/assignments/[assignmentId]/notes'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to generate study notes.' }, { status: 401 });
  const { id, assignmentId } = await context.params;
  const owned = await getOwnedAssignment(session.userId, id, assignmentId);
  if ('error' in owned) return NextResponse.json({ error: owned.error }, { status: 404 });
  if (owned.assignment.status === 'approved' || owned.assignment.status === 'completed') {
    return NextResponse.json({ error: 'Approved or completed assignments are locked. Return this assignment to draft before regenerating its notes.' }, { status: 409 });
  }
  const body = await request.json().catch(() => ({}));
  const model = typeof body.model === 'string' ? body.model.trim() : 'auto';
  const modelInfo = getModelById(model);
  if (!modelInfo || !modelInfo.capabilities.some(capability => capability === 'text' || capability === 'reasoning')) {
    return NextResponse.json({ error: 'Choose a text-capable model from the existing FreeLLM model list.' }, { status: 400 });
  }
  try {
    const pages = await listBookPages(session.userId, id, owned.assignment.startPdfPage, owned.assignment.endPdfPage);
    const generated = await generateAssignmentStudyNotes({ book: owned.book, assignment: owned.assignment, pages, model });
    const assignment = await updateBookAssignment({ ...owned.assignment, studyNotes: generated.studyNotes, updatedAt: Date.now() });
    return NextResponse.json({ assignment, model: generated.model, provider: generated.provider });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Study-note generation failed.' }, { status: 422 });
  }
}

export async function PATCH(request: Request, context: RouteContext<'/api/books/[id]/assignments/[assignmentId]/notes'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to update this assignment.' }, { status: 401 });
  const { id, assignmentId } = await context.params;
  const owned = await getOwnedAssignment(session.userId, id, assignmentId);
  if ('error' in owned) return NextResponse.json({ error: owned.error }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || !['draft', 'approved'].includes(body.status)) return NextResponse.json({ error: 'Choose draft or approved status.' }, { status: 400 });
  try {
    const edited = validateStudyNotes(body.studyNotes, owned.assignment);
    const nextAssignment = {
      ...owned.assignment,
      studyNotes: { ...edited, generatedByModel: body.studyNotes.generatedByModel || 'User-edited', generatedAt: Number(body.studyNotes.generatedAt) || Date.now() },
      status: body.status as 'draft' | 'approved',
      updatedAt: Date.now(),
    };
    if (body.status === 'approved') {
      const pages = await listBookPages(session.userId, id, owned.assignment.startPdfPage, owned.assignment.endPdfPage);
      if (pages.length !== owned.assignment.endPdfPage - owned.assignment.startPdfPage + 1 || pages.some(page => page.method === 'empty' || !page.text.trim() || (page.requiresReview && !page.reviewedByUser))) {
        return NextResponse.json({ error: 'This assignment has unreadable pages or OCR pages that still need review.' }, { status: 409 });
      }
      makeBookPublishJob(owned.book, nextAssignment);
    }
    const assignment = await updateBookAssignment(nextAssignment);
    let publishJob: Awaited<ReturnType<typeof upsertBookPublishJob>> | null = null;
    if (body.status === 'approved') {
      try { publishJob = await upsertBookPublishJob(owned.book, assignment); }
      catch (error) {
        await updateBookAssignment({ ...assignment, status: 'draft', updatedAt: Date.now() }).catch(() => undefined);
        throw error;
      }
    }
    return NextResponse.json({ assignment, publishJob });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Assignment update failed.' }, { status: 400 });
  }
}
