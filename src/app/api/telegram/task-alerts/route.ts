import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import {
  sendTelegramTaskAlert,
  generateMorningBriefingText,
  generateEveningReviewText,
} from '@/lib/server/telegramTaskAlerts';
import { checkTelegramChannel } from '@/lib/server/telegram';

export async function GET(request: Request) {
  const session = await getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

  try {
    const [channelStatus, morningPreview, eveningPreview] = await Promise.all([
      checkTelegramChannel().catch(err => ({
        configured: false,
        connected: false,
        canPost: false,
        message: err?.message || 'Telegram not reachable',
      })),
      generateMorningBriefingText(date, session.userId),
      generateEveningReviewText(date, session.userId),
    ]);

    return NextResponse.json({
      ok: true,
      channelStatus,
      date,
      previews: {
        morning_briefing: morningPreview,
        evening_review: eveningPreview,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to generate task alert preview.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'morning_briefing';
    const date = body.date || new Date().toISOString().split('T')[0];
    const taskId = body.taskId;

    if (!['morning_briefing', 'evening_review', 'task_reminder', 'test_alert'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid alert action. Must be morning_briefing, evening_review, task_reminder, or test_alert.' },
        { status: 400 }
      );
    }

    const result = await sendTelegramTaskAlert(action, {
      date,
      taskId,
      userId: session.userId,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Failed to send alert to Telegram' }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Server error while sending Telegram task alert.' },
      { status: 500 }
    );
  }
}
