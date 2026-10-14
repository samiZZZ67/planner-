import { NextResponse } from 'next/server';
import { runScheduledDeliveryCycle, getSchedulerStatus, initScheduler } from '@/lib/server/scheduler';

export async function GET(request: Request) {
  // Ensure scheduler is active
  initScheduler();
  const status = getSchedulerStatus();
  return NextResponse.json({
    ok: true,
    scheduler: status,
  });
}

export async function POST(request: Request) {
  // Ensure scheduler is running
  initScheduler();

  const secret = process.env.BOOKS_CRON_SECRET?.trim();
  // If a secret is configured, require authentication; otherwise allow manual trigger in dev/internal
  if (secret) {
    const authHeader = request.headers.get('authorization') || '';
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }
  }

  const now = Date.now();
  console.log(`[API /api/cron/books] Manual or external trigger received at ${new Date(now).toISOString()}`);
  const result = await runScheduledDeliveryCycle(now);

  return NextResponse.json({
    ok: true,
    automaticPreparation: result.automaticPreparation,
    claimed: result.bookJobs.claimed + result.scheduledMessages.claimed,
    bookJobs: result.bookJobs,
    scheduledMessages: result.scheduledMessages,
    durationMs: result.durationMs,
  });
}
