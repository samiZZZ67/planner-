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
  const hasUnresolvedDelivery = Boolean(
    result.errors.length
    || result.bookJobs.failed
    || result.bookJobs.retried
    || result.scheduledMessages.failed
    || result.scheduledMessages.retried
    || result.briefs?.failed
    || result.unresolved.bookJobs
    || result.unresolved.scheduledMessages
    || result.unresolved.briefs
    || result.unresolved.telegramDeliveries
  );
  const skipped = Boolean(result.skipped);
  const ok = !skipped && !hasUnresolvedDelivery;

  return NextResponse.json({
    ok,
    skipped,
    errors: result.errors,
    unresolved: result.unresolved,
    automaticPreparation: result.automaticPreparation,
    claimed: result.bookJobs.claimed + result.scheduledMessages.claimed,
    bookJobs: result.bookJobs,
    scheduledMessages: result.scheduledMessages,
    briefs: result.briefs,
    durationMs: result.durationMs,
  }, { status: skipped ? 409 : ok ? 200 : 503 });
}
