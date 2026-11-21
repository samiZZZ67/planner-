import { NextResponse } from 'next/server';
import {
  answerTelegramCallback,
  configureTelegramMiniAppMenuButton,
  sendTelegramMessageWithFallback,
  sendTelegramMessageWithKeyboard,
  sendTelegramMiniAppLaunchMessage,
} from '@/lib/server/telegram';
import { escapeTelegramHtml } from '@/lib/server/telegramFormatter';
import { getAllowedTelegramUserIds } from '@/lib/server/telegramWebAppAuth';
import {
  handleTelegramAiCallback,
  handleTelegramAiText,
  withTelegramAiUserLock,
} from '@/lib/server/telegramAiChat';

function getCommand(text: string): string | null {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i);
  return match?.[1]?.toLowerCase() || null;
}

async function sendStartExperience(chatId: string | number, firstName?: string): Promise<void> {
  try {
    await configureTelegramMiniAppMenuButton();
  } catch (error) {
    console.warn('[Telegram Mini App] Could not configure the menu button from /start:', error instanceof Error ? error.message : 'Telegram request failed');
  }
  const greeting = firstName ? ` ${escapeTelegramHtml(firstName)}` : '';
  await sendTelegramMessageWithKeyboard(
    String(chatId),
    `<b>Welcome${greeting}!</b>\nChat with Moon here, or choose a model. Your conversations are saved privately to your Telegram account.\n\nSend any message to begin. Use /help to see commands.`,
    [
      [{ text: 'Choose AI model', callback_data: 'tgai:models:0' }],
      [{ text: 'New chat', callback_data: 'tgai:new' }, { text: 'Chat help', callback_data: 'tgai:help' }],
    ],
  );
  // Keep the existing Mini App launch button alongside direct bot chat.
  await sendTelegramMiniAppLaunchMessage(chatId);
}

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

    const allowlist = getAllowedTelegramUserIds();
    const message = update.message;
    const callback = update.callback_query;

    if (message?.chat?.type === 'private' && message.from && !message.from.is_bot) {
      if (!Number.isSafeInteger(message.from.id) || message.from.id <= 0 || String(message.chat.id) !== String(message.from.id)) {
        return NextResponse.json({ ok: true, handled: 'ignored' });
      }
      const telegramUserId = String(message.from.id);
      if (!allowlist.ids.has(telegramUserId)) {
        await sendTelegramMessageWithFallback(String(message.chat.id), 'This Telegram account is not authorized to use Planner AI.');
        return NextResponse.json({ ok: true, handled: 'unauthorized_user' });
      }
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      const command = getCommand(text);
      await withTelegramAiUserLock(telegramUserId, async () => {
        if (command === 'start') {
          await sendStartExperience(message.chat.id, message.from?.first_name);
          return;
        }
        if (command === 'app' || command === 'ai') {
          try {
            await configureTelegramMiniAppMenuButton();
          } catch (error) {
            console.warn('[Telegram Mini App] Could not configure the menu button:', error instanceof Error ? error.message : 'Telegram request failed');
          }
          await sendTelegramMiniAppLaunchMessage(message.chat.id);
          return;
        }
        if (text) {
          await handleTelegramAiText(message.chat.id, telegramUserId, text);
        }
      });
      return NextResponse.json({ ok: true, handled: command ? `command_${command}` : 'ai_chat' });
    }

    if (callback?.message?.chat?.type === 'private' && callback.from && typeof callback.data === 'string') {
      if (!Number.isSafeInteger(callback.from.id) || callback.from.id <= 0 || String(callback.message.chat.id) !== String(callback.from.id)) {
        await answerTelegramCallback(callback.id, 'That button is not valid for this chat.');
        return NextResponse.json({ ok: true, handled: 'invalid_callback' });
      }
      const telegramUserId = String(callback.from.id);
      if (!allowlist.ids.has(telegramUserId)) {
        await answerTelegramCallback(callback.id, 'This Telegram account is not authorized.');
        return NextResponse.json({ ok: true, handled: 'unauthorized_callback' });
      }
      await withTelegramAiUserLock(telegramUserId, async () => {
        await handleTelegramAiCallback(callback.message.chat.id, telegramUserId, callback.id, callback.data);
      });
      return NextResponse.json({ ok: true, handled: 'ai_callback' });
    }

    // Channel posts, group messages, poll answers, and unrelated bot updates remain unprocessed.
    return NextResponse.json({ ok: true, handled: 'ignored' });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown webhook error';
    console.error('[Telegram Webhook] Error processing update:', errorMessage);
    // Return 200 to acknowledge receipt and avoid Telegram spamming retries for application errors
    return NextResponse.json({ ok: true, error: errorMessage });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'NightPlanner Telegram Webhook',
    timestamp: new Date().toISOString(),
  });
}
