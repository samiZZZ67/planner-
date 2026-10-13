import { describe, expect, it } from 'vitest';
import { detectMoonBookIntent } from './moonBookTools';

describe('Moon book operation intent detection', () => {
  it.each([
    ['Connect my Telegram channel.', 'connect_telegram'],
    ['Check whether my bot can publish to the channel.', 'connect_telegram'],
    ['give moon full grant access for telegram bot connection', 'connect_telegram'],
    ['telegram bot access', 'connect_telegram'],
    ['send extracted pages based on the load plan', 'send_load_plan'],
    ['send based on load plan', 'send_load_plan'],
    ['send Day 1 to telegram', 'send_load_plan'],
    ['send Day 2 to the bot', 'send_load_plan'],
    ['post extracted pages based on the load plan', 'send_load_plan'],
    ["Prepare tomorrow's reading assignment.", 'prepare'],
    ["Show me today's assigned book section.", 'today'],
    ["Publish today's approved reading assignment.", 'publish'],
    ['Pause automatic publishing.', 'pause'],
    ['Reschedule tomorrow’s post to 09:30.', 'reschedule'],
    ['Show me which Telegram posts failed.', 'failed_posts'],
    ['Extract this PDF book.', 'extract'],
    ['Generate a concept reading plan.', 'plan'],
    ['Approve the assignment.', 'approve'],
    ['Show my reading schedule.', 'schedule'],
  ] as const)('routes the explicit request %s', (text, expected) => {
    expect(detectMoonBookIntent(text)).toBe(expected);
  });

  it('does not turn ordinary book discussion into a state-changing tool call', () => {
    expect(detectMoonBookIntent('Why do readers enjoy books about history?')).toBeNull();
    expect(detectMoonBookIntent('Tell me about concept learning.')).toBeNull();
  });
});
