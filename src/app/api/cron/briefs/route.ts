import { NextResponse } from 'next/server';
import { runScheduledDeliveryCycle, getSchedulerStatus, initScheduler } from '@/lib/server/scheduler';

export async function GET(request: Request) {
  initScheduler();
  const status = getSchedulerStatus();
  return NextResponse.json({
    ok: true,
    scheduler: status,
  });
}

export async function POST(request: Request) {
  initScheduler();

  const secret = process.env.BOOKS_CRON_SECRET?.trim() || process.env.BRIEFS_CRON_SECRET?.trim();
  if (secret) {
    const authHeader = request.headers.get('authorization') || '';
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }
  }

  const now = Date.now();
  console.log(`[API /api/cron/briefs] Manual or external cron trigger received at ${new Date(now).toISOString()}`);
  const result = await runScheduledDeliveryCycle(now);

  return NextResponse.json({
    ok: true,
    briefs: result.briefs,
    bookJobs: result.bookJobs,
    scheduledMessages: result.scheduledMessages,
    durationMs: result.durationMs,
  });
}
