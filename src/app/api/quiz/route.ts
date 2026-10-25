import { NextResponse } from 'next/server';
import { findBookAssignmentById, updateBookAssignment } from '@/lib/server/bookAssignments';
import { getBook, listBookPages } from '@/lib/server/books';
import {
  getQuizSession,
  getActiveQuizSessionForAssignment,
  saveQuizSession,
  generateBookQuizQuestions,
  type BookQuizSession,
  type BookQuizQuestion,
} from '@/lib/server/books/bookQuiz';
import { generateReadingQuiz, type EnrichedQuizQuestion } from '@/lib/server/sources/enrichment';
import { randomUUID } from 'node:crypto';
import { getSessionUser } from '@/lib/server/auth';

export async function GET(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return NextResponse.json({ error: 'Sign in to access this quiz.' }, { status: 401 });
  const url = new URL(request.url);
  const assignmentId = url.searchParams.get('assignmentId') || url.searchParams.get('quiz');
  const sessionId = url.searchParams.get('sessionId');

  if (!assignmentId && !sessionId) {
    return NextResponse.json({ error: 'assignmentId or sessionId parameter is required.' }, { status: 400 });
  }

  let assignment = assignmentId ? await findBookAssignmentById(assignmentId) : null;
  let session: BookQuizSession | null = null;

  if (sessionId) {
    session = await getQuizSession(sessionId);
    if (session && !assignment) {
      assignment = await findBookAssignmentById(session.assignmentId);
    }
  }

  if (!assignment && assignmentId) {
    // Check if assignmentId was actually a sessionId
    session = await getQuizSession(assignmentId);
    if (session) {
      assignment = await findBookAssignmentById(session.assignmentId);
    }
  }

  if (!assignment) {
    return NextResponse.json({ error: 'Reading assignment not found. Please verify the link or contact your administrator.' }, { status: 404 });
  }

  if (assignment.userId !== sessionUser.userId) {
    return NextResponse.json({ error: 'Reading assignment not found.' }, { status: 404 });
  }

  const book = await getBook(assignment.userId, assignment.bookId);
  if (!book) {
    return NextResponse.json({ error: 'Book associated with this assignment was not found.' }, { status: 404 });
  }

  // 1. Check existing questions on assignment learningPackage
  let questions: Array<{
    id: string;
    question: string;
    options: string[];
    correctOptionIndex: number;
    explanation: string;
    difficulty: 'easy' | 'medium' | 'hard';
    sourcePdfPages: number[];
    definition?: { term: string; explanation: string; pdfPage?: number };
    practicalExample?: { kind: 'source' | 'illustrative'; situation: string; lesson: string; sourceDisclosure?: string; pdfPage?: number };
  }> = [];

  if (assignment.learningPackage?.quiz?.length) {
    questions = assignment.learningPackage.quiz.map((q, idx) => ({
      id: (q as any).id || `q_${idx}`,
      question: q.question,
      options: q.options,
      correctOptionIndex: q.correctOptionIndex,
      explanation: q.explanation || `Supported by assigned PDF reading pages ${assignment!.startPdfPage}–${assignment!.endPdfPage}`,
      difficulty: q.difficulty || 'medium',
      sourcePdfPages: q.sourcePdfPages || [assignment!.startPdfPage],
    })).filter(q => q.options.length === 4 && new Set(q.options).size === 4 && q.correctOptionIndex >= 0 && q.correctOptionIndex < 4);
  }

  // 2. Check existing BookQuizSession
  if (questions.length === 0) {
    if (!session) {
      session = await getActiveQuizSessionForAssignment(assignment.userId, assignment.id);
    }
    if (session?.sections?.length) {
      const allQ = session.sections.flatMap(s => s.questions);
      if (allQ.length > 0) {
        questions = allQ.map((q, idx) => ({
          id: q.id || `q_${idx}`,
          question: q.question,
          options: q.options,
          correctOptionIndex: q.correctOptionId,
          explanation: q.detailedExplanation || q.conciseExplanation || `Supported by PDF page ${q.sourcePdfPages?.[0] || assignment!.startPdfPage}`,
          difficulty: 'medium',
          sourcePdfPages: q.sourcePdfPages || [assignment!.startPdfPage],
          definition: q.definition,
          practicalExample: q.practicalExample,
        }));
      }
    }
  }

  // 3. Generate questions if neither learningPackage nor session had questions
  if (questions.length === 0) {
    const pages = await listBookPages(assignment.userId, assignment.bookId, assignment.startPdfPage, assignment.endPdfPage);
    const enrichedQuestions = generateReadingQuiz(book, assignment, pages, assignment.studyNotes);

    if (enrichedQuestions.length > 0) {
      questions = enrichedQuestions.map((q, idx) => ({
        id: `q_${idx}`,
        question: q.question,
        options: q.options,
        correctOptionIndex: q.correctOptionIndex,
        explanation: q.explanation,
        difficulty: q.difficulty,
        sourcePdfPages: q.sourcePdfPages || [assignment!.startPdfPage],
      }));
    } else {
      const generated = await generateBookQuizQuestions({
        book,
        assignment,
        pages,
        startPage: assignment.startPdfPage,
        endPage: assignment.endPdfPage,
        count: Math.min(6, Math.max(2, assignment.endPdfPage - assignment.startPdfPage + 1)),
      });
      questions = generated.map((q, idx) => ({
        id: q.id || `q_${idx}`,
        question: q.question,
        options: q.options,
        correctOptionIndex: q.correctOptionId,
        explanation: q.detailedExplanation || q.conciseExplanation,
        difficulty: 'medium',
        sourcePdfPages: q.sourcePdfPages || [assignment!.startPdfPage],
        definition: q.definition,
        practicalExample: q.practicalExample,
      }));
    }

    // Persist questions on assignment learningPackage so they remain identical across refreshes
    const updatedPkg = {
      ...(assignment.learningPackage || {
        bookId: book.id,
        assignmentId: assignment.id,
        startPdfPage: assignment.startPdfPage,
        endPdfPage: assignment.endPdfPage,
        summary: assignment.studyNotes?.summary || `Reading section for ${book.title}.`,
        keyConcepts: assignment.concepts.map(c => c.title),
        definitions: assignment.studyNotes?.definitions || [],
        realLifeExamples: [],
        status: { summary: 'success' as const, examples: 'success' as const, quiz: 'success' as const },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      quiz: questions.map((q, idx) => ({
        id: q.id || `q_${idx}`,
        question: q.question,
        options: q.options,
        correctOptionIndex: q.correctOptionIndex,
        explanation: q.explanation,
        difficulty: q.difficulty,
        sourcePdfPages: q.sourcePdfPages,
      })),
      updatedAt: Date.now(),
    };

    try {
      await updateBookAssignment({
        ...assignment,
        learningPackage: updatedPkg,
        updatedAt: Date.now(),
      });
    } catch {}
  }

  return NextResponse.json({
    ok: true,
    book: {
      id: book.id,
      title: book.title,
      author: book.author || '',
    },
    assignment: {
      id: assignment.id,
      dayNumber: assignment.dayNumber,
      startPdfPage: assignment.startPdfPage,
      endPdfPage: assignment.endPdfPage,
      scheduledDate: assignment.scheduledDate,
      concepts: assignment.concepts || [],
    },
    questions,
  });
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return NextResponse.json({ error: 'Sign in to submit this quiz.' }, { status: 401 });
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const { assignmentId, answers } = body || {};
  if (!assignmentId) {
    return NextResponse.json({ error: 'assignmentId is required.' }, { status: 400 });
  }

  const assignment = await findBookAssignmentById(assignmentId);
  if (!assignment) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
  }
  if (assignment.userId !== sessionUser.userId) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
  }

  const book = await getBook(assignment.userId, assignment.bookId);
  if (!book) {
    return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  }

  // Load questions from learningPackage or session
  let questions: Array<{
    id: string;
    question: string;
    options: string[];
    correctOptionIndex: number;
    explanation: string;
    difficulty: string;
    sourcePdfPages?: number[];
  }> = [];

  if (assignment.learningPackage?.quiz?.length) {
    questions = assignment.learningPackage.quiz.map((q, idx) => ({
      id: (q as any).id || `q_${idx}`,
      question: q.question,
      options: q.options,
      correctOptionIndex: q.correctOptionIndex,
      explanation: q.explanation,
      difficulty: q.difficulty,
      sourcePdfPages: q.sourcePdfPages,
    })).filter(q => q.options.length === 4 && new Set(q.options).size === 4 && q.correctOptionIndex >= 0 && q.correctOptionIndex < 4);
  } else {
    const session = await getActiveQuizSessionForAssignment(assignment.userId, assignment.id);
    if (session?.sections?.length) {
      questions = session.sections.flatMap(s => s.questions).map((q, idx) => ({
        id: q.id || `q_${idx}`,
        question: q.question,
        options: q.options,
        correctOptionIndex: q.correctOptionId,
        explanation: q.detailedExplanation || q.conciseExplanation,
        difficulty: 'medium',
        sourcePdfPages: q.sourcePdfPages,
      }));
    }
  }

  if (questions.length === 0) {
    const pages = await listBookPages(assignment.userId, assignment.bookId, assignment.startPdfPage, assignment.endPdfPage);
    const enriched = generateReadingQuiz(book, assignment, pages, assignment.studyNotes);
    questions = enriched.map((q, idx) => ({
      id: `q_${idx}`,
      question: q.question,
      options: q.options,
      correctOptionIndex: q.correctOptionIndex,
      explanation: q.explanation,
      difficulty: q.difficulty,
      sourcePdfPages: q.sourcePdfPages,
    }));
  }

  let correctCount = 0;
  const results = questions.map((q, idx) => {
    let selectedOptionIndex: number | undefined;
    if (typeof answers === 'object' && answers !== null) {
      if (typeof answers[q.id] === 'number') {
        selectedOptionIndex = answers[q.id];
      } else if (typeof answers[idx] === 'number') {
        selectedOptionIndex = answers[idx];
      } else if (typeof answers[String(idx)] === 'number') {
        selectedOptionIndex = answers[String(idx)];
      }
    } else if (Array.isArray(answers) && typeof answers[idx] === 'number') {
      selectedOptionIndex = answers[idx];
    }

    const isCorrect = selectedOptionIndex === q.correctOptionIndex;
    if (isCorrect) correctCount++;

    return {
      questionId: q.id,
      question: q.question,
      options: q.options,
      selectedOptionIndex: selectedOptionIndex ?? -1,
      correctOptionIndex: q.correctOptionIndex,
      isCorrect,
      explanation: q.explanation,
      sourcePdfPages: q.sourcePdfPages || [assignment.startPdfPage],
    };
  });

  const totalQuestions = questions.length;
  const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const passed = score >= 70;

  // If a BookQuizSession exists, update its score and status
  try {
    const session = await getActiveQuizSessionForAssignment(assignment.userId, assignment.id);
    if (session) {
      session.score = score;
      session.status = 'completed';
      session.completedAt = Date.now();
      session.updatedAt = Date.now();
      await saveQuizSession(session);
    }
  } catch {}

  return NextResponse.json({
    ok: true,
    assignmentId,
    totalQuestions,
    correctCount,
    score,
    passed,
    results,
  });
}
