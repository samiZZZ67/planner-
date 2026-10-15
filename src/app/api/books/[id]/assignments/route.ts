import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, listBookPages, updateBook } from '@/lib/server/books';
import { listBookAssignments, replaceDraftAssignments } from '@/lib/server/bookAssignments';
import { generateConceptReadingPlan, generateFlexibleReadingPlan } from '@/lib/server/readingPlan';
import { getModelById } from '@/lib/server/freellm/catalog';

export async function GET(request: Request, context: RouteContext<'/api/books/[id]/assignments'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to access reading assignments.' }, { status: 401 });
  const { id } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  return NextResponse.json({ assignments: await listBookAssignments(session.userId, id) });
}

export async function POST(request: Request, context: RouteContext<'/api/books/[id]/assignments'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to generate a reading plan.' }, { status: 401 });
  const { id } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  if (book.extractionStatus !== 'completed' && book.extractionStatus !== 'needs_review') {
    return NextResponse.json({ error: 'Complete extraction and review all OCR pages before generating a plan.' }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const sectionsPerDay = Number.isInteger(body.sectionsPerDay) && body.sectionsPerDay > 0
    ? Number(body.sectionsPerDay)
    : (book.sectionsPerDay || 1);
  const postingTimes = Array.isArray(body.postingTimes) && body.postingTimes.length
    ? body.postingTimes
    : (book.postingTimes || undefined);

  const existing = await listBookAssignments(session.userId, id);
  const completedAssignments = existing.filter(a => a.status === 'completed');

  let startPlanningPage = book.startPage;
  if (completedAssignments.length > 0) {
    const highestCompletedPage = Math.max(...completedAssignments.map(a => a.endPdfPage));
    startPlanningPage = Math.max(book.currentPage, highestCompletedPage + 1);
  } else if (book.currentPage > book.startPage) {
    startPlanningPage = book.currentPage;
  }

  if (startPlanningPage > book.endPage) {
    return NextResponse.json({ error: `All pages up to ${book.endPage} are already completed and delivered.` }, { status: 400 });
  }

  const model = typeof body.model === 'string' ? body.model.trim() : 'auto';
  if (model !== 'auto') {
    const modelInfo = getModelById(model);
    if (!modelInfo || !modelInfo.capabilities.some(capability => capability === 'text' || capability === 'reasoning')) {
      return NextResponse.json({ error: 'Choose a text-capable model from the existing FreeLLM model list.' }, { status: 400 });
    }
  }

  try {
    const pages = await listBookPages(session.userId, id, book.startPage, book.endPage);
    const plan = await generateConceptReadingPlan({
      book,
      pages,
      sectionsPerDay,
      postingTimes,
      model,
      startFromPage: startPlanningPage,
      signal: request.signal,
    });

    await replaceDraftAssignments(session.userId, id, plan.assignments);
    await updateBook({ ...book, sectionsPerDay, postingTimes, status: 'draft' });
    return NextResponse.json({ assignments: plan.assignments, issues: plan.issues, model: plan.model, provider: plan.provider });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Reading plan generation failed.' }, { status: 422 });
  }
}
