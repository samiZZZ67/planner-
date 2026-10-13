import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { checkTelegramChannel } from '@/lib/server/telegram';

export async function GET(request: Request) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to check Telegram settings.' }, { status: 401 });
  try {
    return NextResponse.json(await checkTelegramChannel());
  } catch (error) {
    return NextResponse.json({ configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID), connected: false, canPost: false, error: error instanceof Error ? error.message : 'Telegram status check failed.' }, { status: 503 });
  }
}
