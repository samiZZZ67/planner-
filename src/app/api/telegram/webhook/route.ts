import { NextResponse } from 'next/server';
import { handleQuizCallback, handlePollAnswer } from '@/lib/server/books/bookQuiz';

export async function POST(request: Request) {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const headerSecret = request.headers.get('x-telegram-bot-api-secret-token');
      if (headerSecret !== secret) {
        return NextResponse.json({ error: 'Unauthorized secret token' }, { status: 401 });
      }
    }

    const update = await request.json().catch(() => null);
    if (!update) {
      return NextResponse.json({ ok: false, error: 'Empty payload' }, { status: 400 });
    }

    // 1. Handle Inline Button Callback Queries (Next Question, Repeat Explanation, Next Section, Finish)
    if (update.callback_query && update.callback_query.data) {
      await handleQuizCallback(
        update.callback_query.id,
        update.callback_query.data,
        update.callback_query.from
      );
      return NextResponse.json({ ok: true, handled: 'callback_query' });
    }

    // 2. Handle Native Telegram Quiz Poll Answers
    if (update.poll_answer) {
      await handlePollAnswer({
        poll_id: update.poll_answer.poll_id,
        user: update.poll_answer.user,
        option_ids: update.poll_answer.option_ids || [],
      });
      return NextResponse.json({ ok: true, handled: 'poll_answer' });
    }

    return NextResponse.json({ ok: true, handled: 'ignored' });
  } catch (err: any) {
    console.error('[Telegram Webhook] Error processing update:', err);
    // Return 200 to acknowledge receipt and avoid Telegram spamming retries for application errors
    return NextResponse.json({ ok: true, error: err?.message });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'NightPlanner Telegram Webhook',
    timestamp: new Date().toISOString(),
  });
}
