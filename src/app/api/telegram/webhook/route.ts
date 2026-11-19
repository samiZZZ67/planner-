import { NextResponse } from 'next/server';
import { configureTelegramMiniAppMenuButton, sendTelegramMiniAppLaunchMessage } from '@/lib/server/telegram';

export async function POST(request: Request) {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) {
      return NextResponse.json({ ok: true, handled: 'ignored', reason: 'Telegram webhook secret is not configured.' });
    }
    const headerSecret = request.headers.get('x-telegram-bot-api-secret-token');
    if (headerSecret !== secret) {
      return NextResponse.json({ error: 'Unauthorized secret token' }, { status: 401 });
    }

    const update = await request.json().catch(() => null);
    if (!update) {
      return NextResponse.json({ ok: false, error: 'Empty payload' }, { status: 400 });
    }

    const message = update.message;
    const command = typeof message?.text === 'string' ? message.text.trim() : '';
    if (message?.chat?.type === 'private' && /^\/(?:start|app|ai)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(command)) {
      try {
        await configureTelegramMiniAppMenuButton();
      } catch (error) {
        console.warn('[Telegram Mini App] Could not configure the menu button from /start:', error instanceof Error ? error.message : 'Telegram request failed');
      }
      await sendTelegramMiniAppLaunchMessage(message.chat.id);
      return NextResponse.json({ ok: true, handled: 'mini_app_launch' });
    }

    // Quiz callbacks, poll answers, and other bot updates remain intentionally unprocessed.
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
