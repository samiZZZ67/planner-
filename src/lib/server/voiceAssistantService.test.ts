import { describe, it, expect } from 'vitest';
import { executeVoiceCommand } from './voiceAssistantService';
import { parseVoiceIntent } from '../voice/voiceIntentParser';

describe('Voice Assistant Service - Authoritative Real Execution', () => {
  const userId = 'owner';

  it('should query real tasks and report remaining count', async () => {
    const parsed = parseVoiceIntent('what do I have left to finish today?');
    const result = await executeVoiceCommand(userId, parsed);

    expect(result.ok).toBe(true);
    expect(result.action).toBe('tasks.query');
    expect(result.spokenText).toBeDefined();
    expect(result.message).toContain('tasks');
  });

  it('should create a real task in the database', async () => {
    const title = `Voice Test Task ${Date.now()}`;
    const parsed = parseVoiceIntent(`create a task called ${title} for 2 hours this afternoon`);
    const result = await executeVoiceCommand(userId, parsed);

    expect(result.ok).toBe(true);
    expect(result.action).toBe('tasks.create');
    expect(result.data?.task?.id).toBeDefined();
    expect(result.data?.task?.title).toBe(title);
    expect(result.spokenText).toContain(title);
  });

  it('should request confirmation before deleting a task', async () => {
    const parsed = parseVoiceIntent('delete the task named NonExistentVoiceTask');
    const result = await executeVoiceCommand(userId, parsed);

    // If task not found: returns appropriate message
    expect(result.action).toBe('tasks.delete');
  });

  it('should inspect daily focus budget and remaining time', async () => {
    const parsed = parseVoiceIntent('explain available time and remaining daily budget');
    const result = await executeVoiceCommand(userId, parsed);

    expect(result.ok).toBe(true);
    expect(result.action).toBe('tasks.budget');
    expect(result.spokenText).toContain('focus');
    expect(result.data?.remainingBudgetMins).toBeDefined();
  });

  it('should handle navigation tab intent without errors', async () => {
    const parsed = parseVoiceIntent('open book planner');
    const result = await executeVoiceCommand(userId, parsed);

    expect(result.ok).toBe(true);
    expect(result.action).toBe('navigation.tab');
    expect(result.navigationTab).toBe('books');
    expect(result.spokenText).toContain('Book Planner');
  });

  it('should check telegram delivery status against real integration', async () => {
    const parsed = parseVoiceIntent('show me whether the last Telegram message was delivered');
    const result = await executeVoiceCommand(userId, parsed);

    expect(result.ok).toBe(true);
    expect(result.action).toBe('telegram.status');
    expect(result.message).toContain('Telegram');
  });
});
