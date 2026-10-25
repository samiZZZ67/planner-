import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, listBookPages } from '@/lib/server/books';
import { listBookAssignments, updateBookAssignment } from '@/lib/server/bookAssignments';
import { getOrGenerateLearningPackage, buildAndSaveLearningPackage } from '@/lib/server/books/learningContent';
import { saveQuizSession, getQuizSession, type BookQuizSession } from '@/lib/server/books/bookQuiz';
import { randomUUID } from 'node:crypto';
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
  context: RouteContext<'/api/books/[id]/assignments/[assignmentId]/quiz'>
) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to access quizzes.' }, { status: 401 });

  const { id, assignmentId } = await context.params;
  const owned = await getOwnedAssignment(session.userId, id, assignmentId);
  if ('error' in owned) return NextResponse.json({ error: owned.error }, { status: 404 });

  const { book, assignment } = owned;

  // Revalidate the saved package against the complete current source before returning quiz material.
  const pages = await listBookPages(session.userId, id, assignment.startPdfPage, assignment.endPdfPage);
  const sourceIssues = getAssignmentSourceIssues(assignment, pages);
  if (sourceIssues.length) return NextResponse.json({ error: `Original source extraction is incomplete for PDF pages ${sourceIssues.join(', ')}.`, missingPages: sourceIssues }, { status: 409 });
  const unreviewedOcrPages = pages.filter(page => page.method === 'ocr' && page.text?.trim() && page.requiresReview && !page.reviewedByUser).map(page => page.pdfPage);
  if (unreviewedOcrPages.length) return NextResponse.json({ error: `Review OCR pages ${unreviewedOcrPages.join(', ')} before studying this unit.`, unreviewedOcrPages }, { status: 409 });
  const learningPackage = await getOrGenerateLearningPackage(session.userId, book, assignment, pages);

  return NextResponse.json({
    ok: true,
    book: {
      id: book.id,
      title: book.title,
      author: book.author,
    },
    assignment: {
      id: assignment.id,
      dayNumber: assignment.dayNumber,
      startPdfPage: assignment.startPdfPage,
      endPdfPage: assignment.endPdfPage,
      scheduledDate: assignment.scheduledDate,
      status: assignment.status,
    },
    quiz: learningPackage.quiz,
    summary: learningPackage.summary,
    keyConcepts: learningPackage.keyConcepts,
    realLifeExamples: learningPackage.realLifeExamples,
  });
}

export async function POST(
  request: Request,
  context: RouteContext<'/api/books/[id]/assignments/[assignmentId]/quiz'>
) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to interact with quizzes.' }, { status: 401 });

  const { id, assignmentId } = await context.params;
  const owned = await getOwnedAssignment(session.userId, id, assignmentId);
  if ('error' in owned) return NextResponse.json({ error: owned.error }, { status: 404 });

  const { book, assignment } = owned;
  const body = await request.json().catch(() => ({}));
  const action = body?.action || 'submit_answer';

  // 1. Regenerate quiz specifically without touching summary or examples
  if (action === 'regenerate') {
    const pages = await listBookPages(session.userId, id, assignment.startPdfPage, assignment.endPdfPage);
    const sourceIssues = getAssignmentSourceIssues(assignment, pages);
    if (sourceIssues.length) return NextResponse.json({ error: `Original source extraction is incomplete for PDF pages ${sourceIssues.join(', ')}.`, missingPages: sourceIssues }, { status: 409 });
    const unreviewedOcrPages = pages.filter(page => page.method === 'ocr' && page.text?.trim() && page.requiresReview && !page.reviewedByUser).map(page => page.pdfPage);
    if (unreviewedOcrPages.length) return NextResponse.json({ error: `Review OCR pages ${unreviewedOcrPages.join(', ')} before regenerating this quiz.`, unreviewedOcrPages }, { status: 409 });
    const updatedPackage = await buildAndSaveLearningPackage({
      userId: session.userId,
      book,
      assignment,
      pages,
      model: body.model,
      regenerateOnly: 'quiz',
    });
    return NextResponse.json({ ok: true, quiz: updatedPackage.quiz });
  }

  // 2. Submit individual question answer for immediate verification
  if (action === 'submit_answer') {
    const { questionId, selectedOptionIndex } = body;
    const questions = assignment.learningPackage?.quiz || [];
    const question = questions.find(q => q.id === questionId);
    if (!question) {
      return NextResponse.json({ error: 'Question not found.' }, { status: 404 });
    }

    const isCorrect = Number(selectedOptionIndex) === question.correctOptionIndex;
    return NextResponse.json({
      ok: true,
      questionId,
      isCorrect,
      correctOptionIndex: question.correctOptionIndex,
      explanation: question.explanation,
      conceptTested: question.conceptTested,
    });
  }

  // 3. Complete and record full quiz session results
  if (action === 'finish_session') {
    const { score, totalQuestions, answers } = body;
    const sessionId = randomUUID();

    const quizSession: BookQuizSession = {
      id: sessionId,
      userId: session.userId,
      bookId: book.id,
      assignmentId: assignment.id,
      bookTitle: book.title,
      author: book.author,
      dayNumber: assignment.dayNumber,
      chatId: 'web-interactive',
      status: 'completed',
      currentSectionIndex: 0,
      currentQuestionIndex: totalQuestions - 1,
      totalSections: 1,
      totalQuestions: Number(totalQuestions) || 0,
      sections: [],
      answers: typeof answers === 'object' && answers ? answers : {},
      score: Number(score) || 0,
      settings: {
        userId: session.userId,
        enabled: true,
        questionsPerSection: Number(totalQuestions) || 2,
        deliveryTiming: 'with_reading',
        revealExplanation: 'after_answer',
        updatedAt: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: Date.now(),
    };

    await saveQuizSession(quizSession);

    return NextResponse.json({
      ok: true,
      sessionId,
      score: quizSession.score,
      totalQuestions: quizSession.totalQuestions,
      completedAt: quizSession.completedAt,
    });
  }

  return NextResponse.json({ error: 'Invalid quiz action.' }, { status: 400 });
}
