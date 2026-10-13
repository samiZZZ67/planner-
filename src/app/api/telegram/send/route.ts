import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { sendTelegramTextToChannel } from '@/lib/server/telegram';

export async function POST(request: Request) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in before sending a Telegram message.' }, { status: 401 });
  try {
    const body = await request.json();
    const text = typeof body.text === 'string' ? body.text : '';
    const result = await sendTelegramTextToChannel(text);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Telegram could not send this message.' }, { status: 422 });
  }
}
