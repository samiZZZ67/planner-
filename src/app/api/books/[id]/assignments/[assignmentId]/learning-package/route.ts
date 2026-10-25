import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, listBookPages } from '@/lib/server/books';
import { listBookAssignments } from '@/lib/server/bookAssignments';
import { getOrGenerateLearningPackage, buildAndSaveLearningPackage } from '@/lib/server/books/learningContent';
import { getAssignmentSourceIssues } from '@/lib/server/books/sourceCoverage';

async function getOwnedAssignment(userId: string, bookId: string, assignmentId: string) {
  const book = await getBook(userId, bookId);
  if (!book) return { error: 'Book not found.' as const };
  const assignment = (await listBookAssignments(userId, bookId)).find(item => item.id === assignmentId);
  if (!assignment) return { error: 'Reading assignment not found.' as const };
  return { book, assignment };
}

export async function GET(
  request: Request,
  context: RouteContext<'/api/books/[id]/assignments/[assignmentId]/learning-package'>
) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to access learning package.' }, { status: 401 });

  const { id, assignmentId } = await context.params;
  const owned = await getOwnedAssignment(session.userId, id, assignmentId);
  if ('error' in owned) return NextResponse.json({ error: owned.error }, { status: 404 });

  const { book, assignment } = owned;
  const pages = await listBookPages(session.userId, id, assignment.startPdfPage, assignment.endPdfPage);
  const sourceIssues = getAssignmentSourceIssues(assignment, pages);
  if (sourceIssues.length) return NextResponse.json({ error: `Original source extraction is incomplete for PDF pages ${sourceIssues.join(', ')}. Re-run extraction before generating study materials.`, missingPages: sourceIssues }, { status: 409 });
  const unreviewedOcr = pages.filter(page => page.method === 'ocr' && page.text?.trim() && page.requiresReview && !page.reviewedByUser).map(page => page.pdfPage);
  if (unreviewedOcr.length) return NextResponse.json({ error: `Review OCR source pages ${unreviewedOcr.join(', ')} before generating study materials.`, unreviewedOcrPages: unreviewedOcr }, { status: 409 });
  const pkg = await getOrGenerateLearningPackage(session.userId, book, assignment, pages);

  return NextResponse.json({
    ok: true,
    learningPackage: pkg,
    assignment: {
      id: assignment.id,
      dayNumber: assignment.dayNumber,
      startPdfPage: assignment.startPdfPage,
      endPdfPage: assignment.endPdfPage,
      status: assignment.status,
    },
  });
}

export async function POST(
  request: Request,
  context: RouteContext<'/api/books/[id]/assignments/[assignmentId]/learning-package'>
) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to update learning package.' }, { status: 401 });

  const { id, assignmentId } = await context.params;
  const owned = await getOwnedAssignment(session.userId, id, assignmentId);
  if ('error' in owned) return NextResponse.json({ error: owned.error }, { status: 404 });

  const { book, assignment } = owned;
  const body = await request.json().catch(() => ({}));
  const component = body?.component as 'quiz' | 'summary' | 'examples' | undefined;
  const model = body?.model as string | undefined;

  const pages = await listBookPages(session.userId, id, assignment.startPdfPage, assignment.endPdfPage);
  const sourceIssues = getAssignmentSourceIssues(assignment, pages);
  if (sourceIssues.length) return NextResponse.json({ error: `Original source extraction is incomplete for PDF pages ${sourceIssues.join(', ')}. Re-run extraction before generating study materials.`, missingPages: sourceIssues }, { status: 409 });
  const unreviewedOcr = pages.filter(page => page.method === 'ocr' && page.text?.trim() && page.requiresReview && !page.reviewedByUser).map(page => page.pdfPage);
  if (unreviewedOcr.length) return NextResponse.json({ error: `Review OCR source pages ${unreviewedOcr.join(', ')} before generating study materials.`, unreviewedOcrPages: unreviewedOcr }, { status: 409 });
  const pkg = await buildAndSaveLearningPackage({
    userId: session.userId,
    book,
    assignment,
    pages,
    model,
    regenerateOnly: component,
  });

  return NextResponse.json({ ok: true, learningPackage: pkg });
}
