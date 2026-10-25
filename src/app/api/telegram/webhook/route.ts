import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const headerSecret = request.headers.get('x-telegram-bot-api-secret-token');
      if (headerSecret !== secret) {
        return NextResponse.json({ error: 'Unauthorized secret token' }, { status: 401 });
      }
    }

    const update = await request.json().catch(() => null);
    if (!update) {
      return NextResponse.json({ ok: false, error: 'Empty payload' }, { status: 400 });
    }

    // Quiz callbacks and poll answers are intentionally not processed here.
    return NextResponse.json({ ok: true, handled: 'ignored' });
  } catch (err: any) {
    console.error('[Telegram Webhook] Error processing update:', err);
    // Return 200 to acknowledge receipt and avoid Telegram spamming retries for application errors
    return NextResponse.json({ ok: true, error: err?.message });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'NightPlanner Telegram Webhook',
    timestamp: new Date().toISOString(),
  });
}
