import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { checkTelegramChannel, isTelegramConfigured, loadTelegramConfigFromDb, setTelegramRuntimeConfig } from '@/lib/server/telegram';

export async function GET(request: Request) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to check Telegram settings.' }, { status: 401 });
  try {
    await loadTelegramConfigFromDb();
    return NextResponse.json(await checkTelegramChannel());
  } catch (error) {
    return NextResponse.json({
      configured: isTelegramConfigured(),
      connected: false,
      canPost: false,
      error: error instanceof Error ? error.message : 'Telegram status check failed.'
    }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to update Telegram settings.' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const { botToken, chatId } = body;
    await setTelegramRuntimeConfig({ botToken, chatId });
    const status = await checkTelegramChannel();
    return NextResponse.json({ ok: true, ...status });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to update Telegram settings.'
    }, { status: 422 });
  }
}
