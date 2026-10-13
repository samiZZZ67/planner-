import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { listTelegramDeliveries } from '@/lib/server/telegram';

export async function GET(request: Request) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to view Telegram delivery history.' }, { status: 401 });
  return NextResponse.json({ deliveries: await listTelegramDeliveries(session.userId) });
}
