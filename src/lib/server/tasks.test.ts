import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Load .env.local if present so tests can test full integration with database
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

import { createTaskInDb, getTasksFromDb, getSectionsFromDb, updateTaskInDb, deleteTaskInDb } from './tasks';
import { extractActionsAndCleanText } from './ai/copilot';

describe('Authoritative Task Service & Action Execution', () => {
  it('1. should validate required title', async () => {
    const res = await createTaskInDb({
      title: '',
      date: '2026-10-10',
      category: 'Deep Work',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Task title is required/i);
    expect(res.task).toBeUndefined();
  });

  it('2. should validate date format', async () => {
    const res = await createTaskInDb({
      title: 'Invalid Date Task',
      date: 'invalid-date',
      category: 'Deep Work',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Invalid date format/i);
  });

  it('3. should validate priority level', async () => {
    const res = await createTaskInDb({
      title: 'Invalid Priority Task',
      date: '2026-10-10',
      priority: 'UltraHigh',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Invalid priority/i);
  });

  it('4. should reject unknown/non-existent category when explicitly provided', async () => {
    const res = await createTaskInDb({
      title: 'Unknown Category Task',
      date: '2026-10-10',
      category: 'NonExistentCategory12345',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/does not exist/i);
  });

  it('5. should successfully create a valid task in the database with real database ID', async () => {
    const uniqueTitle = `Test Execution Task ${Date.now()}`;
    const res = await createTaskInDb({
      title: uniqueTitle,
      category: 'Deep Work',
      date: '2026-10-10',
      startTime: '08:00',
      endTime: '09:30',
      scheduledMinutes: 90,
      priority: 'High',
      mustDo: true,
      description: 'Comprehensive test task',
    });

    expect(res.ok).toBe(true);
    expect(res.task).toBeDefined();
    expect(res.task?.id).toBeTruthy();
    expect(res.task?.title).toBe(uniqueTitle);
    expect(res.task?.sectionId).toBe('default-sec-2');
    expect(res.task?.scheduledMinutes).toBe(90);
    expect(res.task?.priority).toBe('High');
    expect(res.task?.mustDo).toBe(true);

    // Verify task is retrieved from getTasksFromDb
    const allTasks = await getTasksFromDb('2026-10-10');
    const found = allTasks.find(t => t.id === res.task?.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe(uniqueTitle);

    // Clean up temporary test task
    if (res.task?.id) {
      await deleteTaskInDb(res.task.id);
    }
  });

  it('6. should safely prevent duplicate creation on retry (idempotent)', async () => {
    const idempotencyTitle = `Idempotent Test Task ${Date.now()}`;
    const firstCall = await createTaskInDb({
      title: idempotencyTitle,
      category: 'Deep Work',
      date: '2026-10-10',
      scheduledMinutes: 60,
      priority: 'Medium',
    });

    expect(firstCall.ok).toBe(true);
    expect(firstCall.task).toBeDefined();
    expect(firstCall.duplicatePrevented).toBeFalsy();

    // Second call with same title and category on the same date
    const secondCall = await createTaskInDb({
      title: idempotencyTitle,
      category: 'Deep Work',
      date: '2026-10-10',
      scheduledMinutes: 60,
      priority: 'Medium',
    });

    expect(secondCall.ok).toBe(true);
    expect(secondCall.task).toBeDefined();
    expect(secondCall.task?.id).toBe(firstCall.task?.id);
    expect(secondCall.duplicatePrevented).toBe(true);

    // Clean up temporary test task
    if (firstCall.task?.id) {
      await deleteTaskInDb(firstCall.task.id);
    }
  });

  it('7. should extract ACTIONS block correctly across markdown formats', () => {
    // Markdown fenced format
    const fencedAiOutput = `Certainly, I will schedule that for you.\n\nACTIONS:\n\`\`\`json\n[\n  {\n    "action": "create_task",\n    "params": {\n      "title": "learning algorithm",\n      "section": "Deep Work",\n      "date": "2026-10-10",\n      "startTime": "06:00",\n      "endTime": "00:00",\n      "scheduledMinutes": 1080,\n      "priority": "Medium"\n    }\n  }\n]\n\`\`\``;

    const parsedFenced = extractActionsAndCleanText(fencedAiOutput);
    expect(parsedFenced.actions.length).toBe(1);
    expect(parsedFenced.actions[0].type).toBe('create_task');
    expect(parsedFenced.actions[0].params.title).toBe('learning algorithm');
    expect(parsedFenced.actions[0].params.scheduledMinutes).toBe(1080);
    // Raw JSON stripped from user-facing text
    expect(parsedFenced.cleanText).not.toContain('```json');
    expect(parsedFenced.cleanText).not.toContain('"create_task"');

    // Plain JSON array format
    const plainAiOutput = `Done!\nACTIONS: [{"action": "create_task", "params": {"title": "Quick Task", "date": "2026-10-10"}}]`;
    const parsedPlain = extractActionsAndCleanText(plainAiOutput);
    expect(parsedPlain.actions.length).toBe(1);
    expect(parsedPlain.actions[0].params.title).toBe('Quick Task');
    expect(parsedPlain.cleanText).toBe('Done!');
  });

  it('8. should fulfill Requirement 6: create "learning algorithm" with exact properties and preserve "phone checking"', async () => {
    // Check if phone checking exists in any store, ensure it is untouched
    const initialTasks = await getTasksFromDb();
    const phoneCheckingInitial = initialTasks.find(t => t.title.toLowerCase() === 'phone checking');

    // Create learning algorithm as requested in Requirement 6
    const res = await createTaskInDb({
      title: 'learning algorithm',
      category: 'Deep Work',
      date: '2026-10-10',
      startTime: '06:00',
      endTime: '00:00',
      scheduledMinutes: 1080,
      priority: 'Medium',
      mustDo: false,
      deadline: 'None',
    });

    expect(res.ok).toBe(true);
    expect(res.task).toBeDefined();
    const task = res.task!;

    expect(task.title).toBe('learning algorithm');
    expect(task.sectionId).toBe('default-sec-2'); // Deep Work section ID
    expect(task.date).toBe('2026-10-10');
    expect(task.startTime).toBe('06:00');
    expect(task.endTime).toBe('00:00');
    expect(task.scheduledMinutes).toBe(1080);
    expect(task.priority).toBe('Medium');
    expect(task.mustDo).toBe(false);
    expect(task.deadline).toBeUndefined(); // 'None' converted to undefined

    // Verify task is persisted in the database
    const dayTasks = await getTasksFromDb('2026-10-10');
    const persistedTask = dayTasks.find(t => t.title === 'learning algorithm');
    expect(persistedTask).toBeDefined();
    expect(persistedTask?.id).toBe(task.id);
    expect(persistedTask?.scheduledMinutes).toBe(1080);
    expect(persistedTask?.sectionId).toBe('default-sec-2');

    // Verify phone checking task remains intact / unimpacted
    const afterTasks = await getTasksFromDb();
    const phoneCheckingAfter = afterTasks.find(t => t.title.toLowerCase() === 'phone checking');
    if (phoneCheckingInitial) {
      expect(phoneCheckingAfter).toBeDefined();
      expect(phoneCheckingAfter?.id).toBe(phoneCheckingInitial.id);
      expect(phoneCheckingAfter?.deleted).toBe(phoneCheckingInitial.deleted);
    }
  });
});
