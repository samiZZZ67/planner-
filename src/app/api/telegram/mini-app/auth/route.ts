import { NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/server/auth';
import { getTelegramBotToken } from '@/lib/server/telegram';
import { validateTelegramWebAppInitData } from '@/lib/server/telegramWebAppAuth';

const MINI_APP_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function getAllowedTelegramUserIds(): { ids: Set<string>; configured: boolean } {
  const pluralValue = process.env.TELEGRAM_MINI_APP_ALLOWED_USER_IDS?.trim();
  const singularValue = process.env.TELEGRAM_MINI_APP_ALLOWED_USER_ID?.trim();
  const value = pluralValue || singularValue || '';
  let candidates: string[];

  try {
    const parsed = value.startsWith('[') ? JSON.parse(value) : null;
    candidates = Array.isArray(parsed)
      ? parsed.map(id => String(id))
      : value.split(/[,;\s]+/);
  } catch {
    candidates = value.split(/[,;\s]+/);
  }

  const ids = new Set(
    candidates
      .map(id => id.trim().replace(/^['"]|['"]$/g, ''))
      .filter(id => /^\d+$/.test(id)),
  );
  return { ids, configured: Boolean(value) };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const initData = typeof body?.initData === 'string' ? body.initData : '';
    if (!initData) {
      return NextResponse.json({ ok: false, error: 'Telegram launch data is missing.', code: 'INIT_DATA_REQUIRED' }, { status: 400 });
    }

    const botToken = await getTelegramBotToken();
    const verified = validateTelegramWebAppInitData(initData, botToken);
    if (!verified) {
      return NextResponse.json({ ok: false, error: 'Telegram launch data is invalid or expired. Close and reopen the Mini App from the Planner bot.', code: 'INVALID_INIT_DATA' }, { status: 401 });
    }

    const telegramUserId = String(verified.user.id);
    const allowlist = getAllowedTelegramUserIds();
    if (allowlist.ids.size === 0) {
      const reason = allowlist.configured
        ? 'The server received the allowlist setting but could not parse a numeric Telegram ID from it.'
        : 'The server is not receiving the Mini App allowlist setting.';
      return NextResponse.json({
        ok: false,
        error: `${reason} Set TELEGRAM_MINI_APP_ALLOWED_USER_IDS=${telegramUserId} on the Render web service, then redeploy.`,
        code: 'MINI_APP_NOT_CONFIGURED',
        telegramUserId,
        allowlistConfigured: allowlist.configured,
      }, { status: 503 });
    }

    if (!allowlist.ids.has(telegramUserId)) {
      return NextResponse.json({
        ok: false,
        error: `This Telegram account is not authorized for the Planner Mini App. Telegram user ID: ${telegramUserId}.`,
        code: 'TELEGRAM_USER_NOT_ALLOWED',
        telegramUserId,
      }, { status: 403 });
    }

    // The planner and FreeLLM history currently use the existing single-owner account.
    // The allowlist ensures only approved Telegram accounts receive that session.
    const token = await createSessionToken('owner', MINI_APP_SESSION_TTL_MS);
    const response = NextResponse.json({ ok: true, token, expiresInSeconds: MINI_APP_SESSION_TTL_MS / 1000 });
    response.headers.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
    const isCrossDomain = Boolean(process.env.CLIENT_URL);
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || isCrossDomain,
      sameSite: isCrossDomain ? 'none' : 'lax',
      path: '/',
      maxAge: MINI_APP_SESSION_TTL_MS / 1000,
    });

    return response;
  } catch (error) {
    console.error('[Telegram Mini App] Authentication failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ ok: false, error: 'Could not authenticate this Telegram session.' }, { status: 500 });
  }
}
