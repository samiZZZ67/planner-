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

  const skipped = Boolean(result.skipped);
  // Actual failures that occurred during THIS execution cycle
  const hasExecutionFailure = Boolean(
    result.errors.length > 0
    || result.bookJobs.failed > 0
    || result.scheduledMessages.failed > 0
    || (result.briefs && result.briefs.failed > 0)
  );

  // ok is true if the cycle completed without fatal errors (or was safely skipped by mutex)
  const ok = !hasExecutionFailure;

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
  }, { status: ok ? 200 : 503 });
}
