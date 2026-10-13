import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getPublishingPaused, listBookPublishJobs, setPublishingPaused } from '@/lib/server/bookScheduler';

export async function GET(request: Request) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to view publishing automation.' }, { status: 401 });
  const [paused, jobs] = await Promise.all([getPublishingPaused(session.userId), listBookPublishJobs(session.userId)]);
  return NextResponse.json({ paused, jobs });
}

export async function POST(request: Request) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to update publishing automation.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.paused !== 'boolean') return NextResponse.json({ error: 'Provide paused as true or false.' }, { status: 400 });
  const setting = await setPublishingPaused(session.userId, body.paused);
  return NextResponse.json({ paused: setting.paused, updatedAt: setting.updatedAt });
}
