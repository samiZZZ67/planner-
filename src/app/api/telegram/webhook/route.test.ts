import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configureMenu: vi.fn(async () => undefined),
  launchMiniApp: vi.fn(async () => ({ message_id: 1 })),
  sendText: vi.fn(async () => ({ message_id: 2 })),
  sendKeyboard: vi.fn(async () => ({ message_id: 3 })),
  answerCallback: vi.fn(async () => true),
  handleText: vi.fn(async () => undefined),
  handleCallback: vi.fn(async () => undefined),
}));

vi.mock('@/lib/server/telegram', () => ({
  answerTelegramCallback: mocks.answerCallback,
  configureTelegramMiniAppMenuButton: mocks.configureMenu,
  sendTelegramMessageWithFallback: mocks.sendText,
  sendTelegramMessageWithKeyboard: mocks.sendKeyboard,
  sendTelegramMiniAppLaunchMessage: mocks.launchMiniApp,
}));
vi.mock('@/lib/server/telegramFormatter', () => ({ escapeTelegramHtml: (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }));
vi.mock('@/lib/server/telegramWebAppAuth', () => ({
  getAllowedTelegramUserIds: () => ({ ids: new Set(['111']), configured: true }),
}));
vi.mock('@/lib/server/telegramAiChat', () => ({
  handleTelegramAiCallback: mocks.handleCallback,
  handleTelegramAiText: mocks.handleText,
  withTelegramAiUserLock: async (_telegramUserId: string, action: () => Promise<unknown>) => action(),
}));

import { POST } from './route';

function webhookRequest(update: unknown): Request {
  return new Request('https://planner.example/api/telegram/webhook', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': 'test-secret', 'content-type': 'application/json' },
    body: JSON.stringify(update),
  });
}

describe('Telegram webhook direct chat integration', () => {
  beforeEach(() => {
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('starts direct chat while keeping the existing Mini App launch button', async () => {
    const response = await POST(webhookRequest({
      message: { chat: { id: 111, type: 'private' }, from: { id: 111, first_name: 'Planner user' }, text: '/start' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ handled: 'command_start' });
    expect(mocks.sendKeyboard).toHaveBeenCalledWith(
      '111',
      expect.stringContaining('Chat with Moon here'),
      expect.arrayContaining([expect.arrayContaining([expect.objectContaining({ callback_data: 'tgai:models:0' })])]),
    );
    expect(mocks.launchMiniApp).toHaveBeenCalledWith(111);
  });

  it('routes authorized text and blocks unlisted users before AI processing', async () => {
    const authorized = await POST(webhookRequest({
      message: { chat: { id: 111, type: 'private' }, from: { id: 111 }, text: 'Hello Moon' },
    }));
    const unauthorized = await POST(webhookRequest({
      message: { chat: { id: 222, type: 'private' }, from: { id: 222 }, text: 'Do not process this' },
    }));

    expect(await authorized.json()).toMatchObject({ handled: 'ai_chat' });
    expect(mocks.handleText).toHaveBeenCalledWith(111, '111', 'Hello Moon');
    expect(await unauthorized.json()).toMatchObject({ handled: 'unauthorized_user' });
    expect(mocks.handleText).toHaveBeenCalledTimes(1);
  });
});
