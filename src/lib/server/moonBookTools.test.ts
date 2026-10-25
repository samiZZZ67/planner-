import { describe, expect, it } from 'vitest';
import {
  detectMoonBookIntent,
  isReferentialTelegramSend,
  findPreviousAssistantContent,
  detectGenerateAndSendTelegramIntent,
} from './moonBookTools';

describe('Moon book operation intent detection', () => {
  it.each([
    ['Connect my Telegram channel.', 'connect_telegram'],
    ['Check whether my bot can publish to the channel.', 'connect_telegram'],
    ['give moon full grant access for telegram bot connection', 'connect_telegram'],
    ['telegram bot access', 'connect_telegram'],
    ['I already set that', 'connect_telegram'],
    ['is telegram configured', 'connect_telegram'],
    ['is telegram connected', 'connect_telegram'],
    ['Post to telegram : this Is moon ai', 'send_telegram'],
    ['Post to telegram: hello world', 'send_telegram'],
    ['Telegram: hello from moon', 'send_telegram'],
    ['Send to bot: test message', 'send_telegram'],
    ['Post to telegram :/the above explainstion', 'send_telegram'],
    ['send the above explanation to the bot', 'send_telegram'],
    ['post the above message to telegram', 'send_telegram'],
    ['send extracted pages based on the load plan', 'send_load_plan'],
    ['send based on load plan', 'send_load_plan'],
    ['send Day 1 to telegram', 'send_load_plan'],
    ['send Day 2 to the bot', 'send_load_plan'],
    ['send extracted page daily', 'send_load_plan'],
    ['send specified day to the bot', 'send_load_plan'],
    ['post extracted pages based on the load plan', 'send_load_plan'],
    ['8316651482:AAGtILkTPiozkOmokFAJ-yUNUWFXI45C7kc', 'configure_telegram'],
    ['configure telegram bot token: 8316651482:AAGtILkTPiozkOmokFAJ-yUNUWFXI45C7kc', 'configure_telegram'],
    ["Prepare tomorrow's reading assignment.", 'prepare'],
    ["Show me today's assigned book section.", 'today'],
    ["Publish today's approved reading assignment.", 'publish'],
    ['Pause automatic publishing.', 'pause'],
    ['Reschedule tomorrow’s post to 09:30.', 'reschedule'],
    ['set a time for Day 1 to be sent on telegram at 14:00', 'reschedule'],
    ['schedule Day 1 at 2:00 pm', 'reschedule'],
    ['set posting time for day 1 to 08:30', 'reschedule'],
    ['schedule extracted page to be sent at 10:00', 'reschedule'],
    ['Show me which Telegram posts failed.', 'failed_posts'],
    ['Extract this PDF book.', 'extract'],
    ['Generate a concept reading plan.', 'plan'],
    ['Approve the assignment.', 'approve'],
    ['Show my reading schedule.', 'schedule'],
  ] as const)('routes the explicit request %s', (text, expected) => {
    expect(detectMoonBookIntent(text)).toBe(expected);
  });

  it('does not dispatch a referential response without an explicit destination', () => {
    expect(detectMoonBookIntent('the above explanation')).toBeNull();
  });

  it('does not turn ordinary book discussion into a state-changing tool call', () => {
    expect(detectMoonBookIntent('Why do readers enjoy books about history?')).toBeNull();
    expect(detectMoonBookIntent('Tell me about concept learning.')).toBeNull();
  });

  describe('Referential Telegram sends and message history lookup', () => {
    it('detects referential phrases', () => {
      expect(isReferentialTelegramSend('/the above explainstion')).toBe(true);
      expect(isReferentialTelegramSend('the above explanation')).toBe(true);
      expect(isReferentialTelegramSend('send the above explanation to the bot')).toBe(true);
      expect(isReferentialTelegramSend('the last response')).toBe(true);
      expect(isReferentialTelegramSend('hello world')).toBe(false);
    });

    it('extracts previous assistant content from conversation history', () => {
      const messages = [
        { role: 'user', content: 'Explain human vs AI intelligence.' },
        { role: 'assistant', content: 'Human intelligence is adaptive and emotional, whereas AI is computational.' },
        { role: 'user', content: 'send the above explanation to the bot' },
      ];
      expect(findPreviousAssistantContent(messages)).toBe(
        'Human intelligence is adaptive and emotional, whereas AI is computational.'
      );
    });

    it('ignores delivery receipt messages when looking up previous explanation', () => {
      const messages = [
        { role: 'user', content: 'Explain quantum physics.' },
        { role: 'assistant', content: 'Quantum physics studies matter at the subatomic scale.' },
        { role: 'user', content: 'Post to telegram: hi' },
        { role: 'assistant', content: '🚀 Telegram Message Delivered Successfully!\n\n• Message: "hi"' },
        { role: 'user', content: 'the above explanation' },
      ];
      expect(findPreviousAssistantContent(messages)).toBe(
        'Quantum physics studies matter at the subatomic scale.'
      );
    });
  });

  describe('Generate-And-Send Telegram Intent Detection', () => {
    it('detects composite generation and dispatch requests', () => {
      const result1 = detectGenerateAndSendTelegramIntent(
        'explain about human or ai which is intelligent and send it to telegram'
      );
      expect(result1.isGenerateAndSend).toBe(true);
      expect(result1.promptToGenerate).toBe('explain about human or ai which is intelligent');

      const result2 = detectGenerateAndSendTelegramIntent(
        'write a summary of machine learning and send to the bot'
      );
      expect(result2.isGenerateAndSend).toBe(true);
      expect(result2.promptToGenerate).toBe('write a summary of machine learning');

      const result3 = detectGenerateAndSendTelegramIntent(
        'send an explanation about quantum physics to telegram'
      );
      expect(result3.isGenerateAndSend).toBe(true);
      expect(result3.promptToGenerate).toContain('quantum physics');

      const regular = detectGenerateAndSendTelegramIntent('What is the weather today?');
      expect(regular.isGenerateAndSend).toBe(false);
    });
  });

  describe('Website-only quiz handling', () => {
    it('does not route quiz requests into Telegram delivery', () => {
      expect(detectMoonBookIntent('quiz me on today reading')).toBeNull();
      expect(detectMoonBookIntent('start interactive quiz for day 1')).toBeNull();
      expect(detectMoonBookIntent('test my recall on deep work')).toBeNull();
      expect(detectMoonBookIntent('send comprehension questions to telegram')).toBeNull();
    });
  });
});
