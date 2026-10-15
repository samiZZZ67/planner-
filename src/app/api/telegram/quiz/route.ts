import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import {
  getBookQuizSettings,
  updateBookQuizSettings,
  listRecentQuizSessions,
  getActiveQuizSessionForAssignment,
  startQuizSessionForAssignment,
  processTelegramUpdates,
} from '@/lib/server/books/bookQuiz';
import { getBook, listBookPages } from '@/lib/server/books';
import { listBookAssignments } from '@/lib/server/bookAssignments';
import { envConfig, setTelegramWebhook, getTelegramWebhookInfo } from '@/lib/server/telegram';

export async function GET(request: Request) {
  const session = await getSessionUser(request);
  const userId = session?.userId || 'owner';

  try {
    const [settings, recentSessions, webhookInfo] = await Promise.all([
      getBookQuizSettings(userId),
      listRecentQuizSessions(userId, 10),
      getTelegramWebhookInfo().catch(() => null),
    ]);

    return NextResponse.json({
      settings,
      recentSessions,
      webhookInfo,
      activeSession: recentSessions.find(s => s.status === 'active') || null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to fetch quiz status' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getSessionUser(request);
  const userId = session?.userId || 'owner';

  try {
    const body = await request.json().catch(() => ({}));
    const action = body?.action || 'update_settings';

    if (action === 'update_settings') {
      const updated = await updateBookQuizSettings(userId, {
        enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
        questionsPerSection: body.questionsPerSection ? Number(body.questionsPerSection) : undefined,
        deliveryTiming: body.deliveryTiming === 'on_demand' ? 'on_demand' : 'with_reading',
        revealExplanation: body.revealExplanation === 'immediate' ? 'immediate' : 'after_answer',
      });
      return NextResponse.json({ ok: true, settings: updated });
    }

    if (action === 'start_quiz') {
      const { bookId, assignmentId, chatId: customChatId } = body;
      if (!bookId || !assignmentId) {
        return NextResponse.json({ error: 'Provide bookId and assignmentId' }, { status: 400 });
      }

      const book = await getBook(userId, bookId);
      if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

      const assignments = await listBookAssignments(userId, bookId);
      const assignment = assignments.find(a => a.id === assignmentId);
      if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

      const pages = await listBookPages(userId, bookId, assignment.startPdfPage, assignment.endPdfPage);
      if (!pages.length) return NextResponse.json({ error: 'No extracted pages available for this assignment.' }, { status: 400 });

      const targetChatId = customChatId?.trim() || envConfig().chatId;
      const quizSession = await startQuizSessionForAssignment(userId, book, assignment, pages, targetChatId);

      return NextResponse.json({
        ok: true,
        session: quizSession,
        message: `Interactive Quiz launched in ${targetChatId} with ${quizSession.totalQuestions} questions across ${quizSession.totalSections} section(s).`,
      });
    }

    if (action === 'process_updates') {
      const result = await processTelegramUpdates();
      return NextResponse.json({ ok: true, result });
    }

    if (action === 'set_webhook') {
      const baseUrl = body.url?.trim() || (process.env.RENDER_EXTERNAL_URL ? `https://${process.env.RENDER_EXTERNAL_URL}` : '');
      if (!baseUrl) {
        return NextResponse.json({ error: 'Provide a valid public URL or set RENDER_EXTERNAL_URL on the server.' }, { status: 400 });
      }
      const webhookUrl = `${baseUrl.replace(/\/+$/, '')}/api/telegram/webhook`;
      const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
      const res = await setTelegramWebhook(webhookUrl, secretToken);
      const info = await getTelegramWebhookInfo().catch(() => null);
      return NextResponse.json({ ok: res.ok, webhookUrl, description: res.description, info });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Quiz action failed' }, { status: 500 });
  }
}
