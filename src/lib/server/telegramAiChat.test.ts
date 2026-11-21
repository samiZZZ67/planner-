import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  states: new Map<string, unknown>(),
  sentText: [] as string[],
  sentKeyboards: [] as Array<{ chatId: string; text: string; keyboard: unknown }>,
  response: 'AI reply',
  lastCompletion: null as null | { messages: unknown[]; model: string },
}));

vi.mock('./neon', () => ({ getDb: () => null }));
vi.mock('./localDb', () => ({
  getTelegramAiChatLocal: (id: string) => testState.states.get(id) || null,
  saveTelegramAiChatLocal: (state: { telegramUserId: string }) => {
    testState.states.set(state.telegramUserId, state);
    return state;
  },
}));
vi.mock('./telegram', async importOriginal => {
  const actual = await importOriginal<typeof import('./telegram')>();
  return {
    ...actual,
    answerTelegramCallback: vi.fn(async () => true),
    sendTelegramPlainText: vi.fn(async (_chatId: string | number, text: string) => {
      testState.sentText.push(text);
      return { message_id: testState.sentText.length };
    }),
    sendTelegramMessageWithFallback: vi.fn(async (_chatId: string, text: string) => {
      testState.sentText.push(text);
      return { message_id: testState.sentText.length };
    }),
    sendTelegramMessageWithKeyboard: vi.fn(async (chatId: string, text: string, keyboard: unknown) => {
      testState.sentKeyboards.push({ chatId, text, keyboard });
      return { message_id: testState.sentKeyboards.length };
    }),
  };
});
vi.mock('./freellm/gateway', () => ({
  checkGatewayStatus: vi.fn(async () => ({
    online: true,
    catalog: [
      { id: 'auto', name: 'Auto', provider: 'Router', capabilities: ['text'], contextWindow: 1000, description: '' },
      { id: 'test/fast-model', name: 'Fast model', provider: 'Test', capabilities: ['text'], contextWindow: 1000, description: '' },
    ],
  })),
  sendChatCompletionWithFallback: vi.fn(async ({ messages, model }: { messages: unknown[]; model: string }) => {
    testState.lastCompletion = { messages, model };
    return { content: testState.response, model, providerUsed: 'test' };
  }),
}));
vi.mock('./moonBookTools', () => ({ getMoonApplicationContext: vi.fn(async () => 'Planner context') }));

import {
  getTelegramAiChatState,
  handleTelegramAiCallback,
  handleTelegramAiText,
} from './telegramAiChat';

describe('Telegram direct AI chat', () => {
  beforeEach(() => {
    testState.states.clear();
    testState.sentText.length = 0;
    testState.sentKeyboards.length = 0;
    testState.response = 'AI reply';
    testState.lastCompletion = null;
  });

  afterEach(() => vi.clearAllMocks());

  it('keeps conversations isolated by Telegram user and persists the selected model and context', async () => {
    const firstUser = await getTelegramAiChatState('101');
    const secondUser = await getTelegramAiChatState('202');
    expect(firstUser.activeConversationId).not.toBe(secondUser.activeConversationId);

    await handleTelegramAiCallback('101', '101', 'callback-1', 'tgai:model:test/fast-model');
    await handleTelegramAiText('101', '101', 'Remember this detail.');

    const savedFirstUser = await getTelegramAiChatState('101');
    const savedSecondUser = await getTelegramAiChatState('202');
    const firstConversation = savedFirstUser.conversations.find(item => item.id === savedFirstUser.activeConversationId)!;
    const secondConversation = savedSecondUser.conversations.find(item => item.id === savedSecondUser.activeConversationId)!;

    expect(savedFirstUser.selectedModel).toBe('test/fast-model');
    expect(firstConversation.messages.map(message => message.content)).toEqual(['Remember this detail.', 'AI reply']);
    expect(secondConversation.messages).toEqual([]);
    expect(testState.lastCompletion?.model).toBe('test/fast-model');
    expect(testState.lastCompletion?.messages.at(-1)).toMatchObject({ role: 'user', content: 'Remember this detail.' });
  });

  it('shows saved chats and splits long AI responses into Telegram-sized text messages', async () => {
    testState.response = 'A'.repeat(7500);
    await handleTelegramAiText('303', '303', 'Explain this at length.');
    await handleTelegramAiText('303', '303', '/history');

    expect(testState.sentKeyboards.some(item => item.text.includes('Saved chats'))).toBe(true);
    const responseParts = testState.sentText.filter(text => text.includes('Moon · auto') || text.startsWith('A'));
    expect(responseParts.length).toBeGreaterThan(1);
    expect(responseParts.every(text => text.length <= 4096)).toBe(true);
  });
});
