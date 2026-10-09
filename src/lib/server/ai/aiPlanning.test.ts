import { describe, it, expect } from 'vitest';
import { countWords } from '../../plan/weeklyPlanUtils';
import { validateAndCleanAIPlan } from './validator';
import { generateAlgorithmicDayPlan } from './prompts';
import { getAIProvidersStatus, executeAIRequestWithFallback, isValidApiKey } from './providers';
import type { Section, Task, WeeklyPlan, MonthlyPlan } from '../../../types';

describe('AI Planning & Hierarchy Test Suite', () => {
  describe('1. 100-Word Validation for Weekly Planning Prompt', () => {
    it('should correctly count words in a prompt', () => {
      const shortPrompt = 'This is a brief five words prompt.';
      expect(countWords(shortPrompt)).toBe(7);
      expect(countWords('')).toBe(0);
      expect(countWords('   ')).toBe(0);
    });

    it('should identify prompts meeting or failing the 100-word requirement', () => {
      const ninetyNineWords = Array(99).fill('goal').join(' ');
      const hundredWords = Array(100).fill('goal').join(' ');
      const hundredFiftyWords = Array(150).fill('commitment').join(' ');

      expect(countWords(ninetyNineWords)).toBe(99);
      expect(countWords(ninetyNineWords) >= 100).toBe(false);

      expect(countWords(hundredWords)).toBe(100);
      expect(countWords(hundredWords) >= 100).toBe(true);

      expect(countWords(hundredFiftyWords)).toBe(150);
      expect(countWords(hundredFiftyWords) >= 100).toBe(true);
    });
  });

  describe('2. AI Plan Validation & Overlap Prevention', () => {
    const dummySections: Section[] = [
      { id: 'sec-deep', name: 'Deep Work', color: '#f59e0b', icon: '⚡', order: 0, targetType: 'at least', updatedAt: 0, deleted: false, isSample: false },
      { id: 'sec-study', name: 'Learning', color: '#3b82f6', icon: '📚', order: 1, targetType: 'at least', updatedAt: 0, deleted: false, isSample: false },
    ];

    it('should parse valid AI schedule and calculate task durations', () => {
      const rawJson = JSON.stringify({
        rationale: 'Balanced day for lectures and coding.',
        recommendations: ['Take a 15m break between blocks.'],
        conflicts: [],
        proposedTasks: [
          {
            title: 'AASTU Embedded Systems Study',
            startTime: '09:00',
            endTime: '11:00',
            sectionId: 'sec-study',
            priority: 'High',
            mustDo: true,
          },
          {
            title: 'YouTube Video Timeline Cut',
            startTime: '13:00',
            endTime: '15:00',
            sectionId: 'sec-deep',
            priority: 'Medium',
            mustDo: false,
          },
        ],
      });

      const validated = validateAndCleanAIPlan(rawJson, 6, dummySections, []);
      expect(validated.proposedTasks).toHaveLength(2);
      expect(validated.proposedTasks[0].scheduledMinutes).toBe(120);
      expect(validated.proposedTasks[1].scheduledMinutes).toBe(120);
      expect(validated.rationale).toBe('Balanced day for lectures and coding.');
    });

    it('should clean markdown json code fences', () => {
      const fenced = "```json\n" + JSON.stringify({
        rationale: 'Fenced test',
        recommendations: [],
        conflicts: [],
        proposedTasks: [
          { title: 'Morning Sprint', startTime: '10:00', endTime: '11:00', sectionId: 'sec-deep' },
        ],
      }) + "\n```";

      const validated = validateAndCleanAIPlan(fenced, 4, dummySections, []);
      expect(validated.proposedTasks).toHaveLength(1);
      expect(validated.proposedTasks[0].title).toBe('Morning Sprint');
    });

    it('should enforce focus budget limit and prevent allocation beyond budget', () => {
      const rawJson = JSON.stringify({
        rationale: 'Heavy plan',
        recommendations: [],
        conflicts: [],
        proposedTasks: [
          { title: 'Task 1 (2 hours)', startTime: '09:00', endTime: '11:00', sectionId: 'sec-deep' },
          { title: 'Task 2 (2 hours)', startTime: '11:30', endTime: '13:30', sectionId: 'sec-deep' },
          { title: 'Task 3 (exceeds 3h budget)', startTime: '14:00', endTime: '16:00', sectionId: 'sec-deep' },
        ],
      });

      // Budget is 3 hours (180 mins)
      const validated = validateAndCleanAIPlan(rawJson, 3, dummySections, []);
      // Only first task (120 min) fits within 3h; adding task 2 (120m) would total 240m > 180m
      expect(validated.proposedTasks).toHaveLength(1);
      expect(validated.conflicts.some(c => c.includes('budget'))).toBe(true);
    });

    it('should detect and resolve overlapping time slots in proposed tasks', () => {
      const rawJson = JSON.stringify({
        rationale: 'Overlapping test',
        recommendations: [],
        conflicts: [],
        proposedTasks: [
          { title: 'Lecture Block', startTime: '09:00', endTime: '11:00', sectionId: 'sec-study' },
          { title: 'Overlapping Lab', startTime: '10:00', endTime: '12:00', sectionId: 'sec-study' }, // overlaps!
        ],
      });

      const validated = validateAndCleanAIPlan(rawJson, 8, dummySections, []);
      expect(validated.conflicts.some(c => c.includes('overlapped'))).toBe(true);
      // The second task should be automatically shifted after the first task
      expect(validated.proposedTasks[1].startTime).not.toBe('10:00');
    });
  });

  describe('3. Connected Hierarchy Algorithmic Day Plan Generation', () => {
    const dummySections: Section[] = [
      { id: 'sec-1', name: 'Deep Work', color: '#f59e0b', icon: '⚡', order: 0, targetType: 'at least', updatedAt: 0, deleted: false, isSample: false },
      { id: 'sec-2', name: 'Learning', color: '#3b82f6', icon: '📚', order: 1, targetType: 'at least', updatedAt: 0, deleted: false, isSample: false },
    ];

    it('should incorporate Weekly AASTU commitments and deep-work targets', () => {
      const weeklyPlan: WeeklyPlan = {
        id: 'week-test',
        startDate: '2026-10-05',
        endDate: '2026-10-11',
        monthId: '2026-10',
        prompt: Array(100).fill('planning').join(' '),
        wordCount: 100,
        goals: 'Complete week milestones',
        aastuCommitments: 'AASTU Computer Architecture Assignment 2 due Friday',
        deepWorkTargets: 'Edit Premiere Pro tutorial episode 4',
        constraints: 'Leave 2 hours for gym',
        outcomes: 'Submit assignment and export video',
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
      };

      const monthlyPlan: MonthlyPlan = {
        id: 'month-2026-10',
        month: '2026-10',
        title: 'October Master Plan',
        prompt: 'Month vision',
        academicPriorities: 'AASTU Semester 1 courses',
        editingTargets: '4 YouTube videos',
        commitments: 'Midterm exams',
        goals: [{ id: '1', text: 'Pass exams', completed: false }],
        completionPercentage: 0,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
      };

      const prevTasks: Task[] = [
        {
          id: 'prev-1',
          date: '2026-10-08',
          sectionId: 'sec-1',
          title: 'Finish lab draft',
          description: '',
          strategy: '',
          doneMeans: '',
          estimatedMinutes: 60,
          priority: 'High',
          mustDo: true,
          tags: [],
          icon: '🎯',
          isCompleted: false, // Incomplete!
          order: 0,
          createdAt: 0,
          updatedAt: 0,
          deleted: false,
          isSample: false,
        },
      ];

      const generated = generateAlgorithmicDayPlan({
        targetDate: '2026-10-09',
        focusBudgetHours: 6,
        monthlyPlan,
        weeklyPlan,
        previousDayTasks: prevTasks,
        existingDayTasks: [],
        sections: dummySections,
      });

      expect(generated.proposedTasks.length).toBeGreaterThanOrEqual(2);
      // Incomplete high-priority task carryover
      expect(generated.proposedTasks.some(t => t.title.includes('Finish lab draft'))).toBe(true);
      // AASTU commitment scheduled
      expect(generated.proposedTasks.some(t => t.title.includes('AASTU'))).toBe(true);
      // Deep work video editing scheduled
      expect(generated.proposedTasks.some(t => t.title.includes('Premiere') || t.title.includes('Video') || t.title.includes('Deep Work'))).toBe(true);

      // Check total duration does not exceed 6h (360m)
      const totalMins = generated.proposedTasks.reduce((acc, t) => acc + t.scheduledMinutes, 0);
      expect(totalMins).toBeLessThanOrEqual(360);
    });
  });

  describe('4. AI Providers Configuration & Fallback Detection', () => {
    it('should return safe provider status without exposing API keys', () => {
      const status = getAIProvidersStatus();
      expect(status).toHaveProperty('providers');
      expect(status.providers).toHaveLength(6); // Groq 1, Groq 2, Groq 3, Gemini 1, Gemini 2, Gemini 3

      for (const p of status.providers) {
        expect(p).toHaveProperty('configured');
        expect(p).toHaveProperty('model');
        // Ensure keys are NOT exposed
        expect((p as any).apiKey).toBeUndefined();
        expect((p as any).key).toBeUndefined();
      }
    });

    it('should throw NO_CONFIGURED_KEYS when no API keys are present in environment', async () => {
      const originalG1 = process.env.GEMINI_API_KEY_1;
      const originalG2 = process.env.GEMINI_API_KEY_2;
      const originalG3 = process.env.GEMINI_API_KEY_3;
      const originalG = process.env.GEMINI_API_KEY;
      const originalGroq1 = process.env.GROQ_API_KEY_1;
      const originalGroq2 = process.env.GROQ_API_KEY_2;
      const originalGroq3 = process.env.GROQ_API_KEY_3;
      const originalGroq = process.env.GROQ_API_KEY;

      try {
        delete process.env.GEMINI_API_KEY_1;
        delete process.env.GEMINI_API_KEY_2;
        delete process.env.GEMINI_API_KEY_3;
        delete process.env.GEMINI_API_KEY;
        delete process.env.GROQ_API_KEY_1;
        delete process.env.GROQ_API_KEY_2;
        delete process.env.GROQ_API_KEY_3;
        delete process.env.GROQ_API_KEY;

        await expect(executeAIRequestWithFallback('Hello')).rejects.toThrow('NO_CONFIGURED_KEYS');
      } finally {
        if (originalG1) process.env.GEMINI_API_KEY_1 = originalG1;
        if (originalG2) process.env.GEMINI_API_KEY_2 = originalG2;
        if (originalG3) process.env.GEMINI_API_KEY_3 = originalG3;
        if (originalG) process.env.GEMINI_API_KEY = originalG;
        if (originalGroq1) process.env.GROQ_API_KEY_1 = originalGroq1;
        if (originalGroq2) process.env.GROQ_API_KEY_2 = originalGroq2;
        if (originalGroq3) process.env.GROQ_API_KEY_3 = originalGroq3;
        if (originalGroq) process.env.GROQ_API_KEY = originalGroq;
      }
    });

    it('should validate API keys correctly and reject placeholders', () => {
      expect(isValidApiKey(undefined)).toBe(false);
      expect(isValidApiKey('')).toBe(false);
      expect(isValidApiKey('short')).toBe(false);
      expect(isValidApiKey('your-google-gemini-api-key-1')).toBe(false);
      expect(isValidApiKey('your-groq-api-key')).toBe(false);
      expect(isValidApiKey('your-groq-api-key-1')).toBe(false);
      expect(isValidApiKey('your-groq-api-key-2')).toBe(false);
      expect(isValidApiKey('your-groq-api-key-3')).toBe(false);
      expect(isValidApiKey('placeholder_key_here')).toBe(false);

      // Valid realistic keys
      expect(isValidApiKey('AIzaSyD-dummyValidLengthGeminiKey123456')).toBe(true);
      expect(isValidApiKey('gsk_umuDfLmXzAV39a0bpMPZW1234567890')).toBe(true);
    });

    it('should respect GEMINI_MODEL environment variable and support verified models', () => {
      const originalModel = process.env.GEMINI_MODEL;
      try {
        process.env.GEMINI_MODEL = 'gemini-3.8-flash';
        const status = getAIProvidersStatus();
        const gemini1 = status.providers.find(p => p.id === 'gemini-1');
        expect(gemini1).toBeDefined();
        expect(gemini1?.availableModels).toContain('gemini-3.8-flash');
        expect(gemini1?.availableModels).toContain('gemini-flash-latest');
        expect(gemini1?.availableModels).toContain('gemini-2.5-flash');

        // Test custom GEMINI_MODEL override
        process.env.GEMINI_MODEL = 'gemini-flash-latest';
        const statusCustom = getAIProvidersStatus();
        const geminiCustom = statusCustom.providers.find(p => p.id === 'gemini-1');
        expect(geminiCustom?.model).toBe('gemini-flash-latest');
      } finally {
        if (originalModel !== undefined) {
          process.env.GEMINI_MODEL = originalModel;
        } else {
          delete process.env.GEMINI_MODEL;
        }
      }
    });

    it('should treat placeholder keys as unconfigured without making failed network calls', async () => {
      const originalG1 = process.env.GEMINI_API_KEY_1;
      const originalGroq1 = process.env.GROQ_API_KEY_1;
      const originalGroq = process.env.GROQ_API_KEY;

      try {
        process.env.GEMINI_API_KEY_1 = 'your-google-gemini-api-key-1';
        process.env.GROQ_API_KEY_1 = 'your-groq-api-key-1';
        process.env.GROQ_API_KEY = 'your-groq-api-key';
        delete process.env.GEMINI_API_KEY_2;
        delete process.env.GEMINI_API_KEY_3;
        delete process.env.GEMINI_API_KEY;
        delete process.env.GROQ_API_KEY_2;
        delete process.env.GROQ_API_KEY_3;

        // Must reject placeholders and throw NO_CONFIGURED_KEYS instead of calling Google/Groq with invalid credentials
        await expect(executeAIRequestWithFallback('Hello')).rejects.toThrow('NO_CONFIGURED_KEYS');
      } finally {
        if (originalG1) process.env.GEMINI_API_KEY_1 = originalG1;
        else delete process.env.GEMINI_API_KEY_1;
        if (originalGroq1) process.env.GROQ_API_KEY_1 = originalGroq1;
        else delete process.env.GROQ_API_KEY_1;
        if (originalGroq) process.env.GROQ_API_KEY = originalGroq;
        else delete process.env.GROQ_API_KEY;
      }
    });

    it('should successfully execute live request with default verified model or auto-heal deprecated model', async () => {
      if (!isValidApiKey(process.env.GEMINI_API_KEY_1)) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const envPath = path.join(process.cwd(), '.env.local');
          if (fs.existsSync(envPath)) {
            const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
            for (const line of lines) {
              const match = line.match(/^([^=]+)=(.*)$/);
              if (match) {
                const k = match[1].trim();
                const v = match[2].trim().replace(/^["']|["']$/g, '');
                if (!process.env[k]) process.env[k] = v;
              }
            }
          }
        } catch {}
      }

      if (!isValidApiKey(process.env.GEMINI_API_KEY_1)) {
        return; // Skip if no real key in test environment
      }

      // Test 1: Default verified model
      const res = await executeAIRequestWithFallback('Respond with ONLY: OK', undefined, undefined, { jsonMode: false });
      expect(res.text).toBeDefined();
      expect(['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest']).toContain(res.model);

      // Test 2: Auto-healing when gemini-2.5-flash is passed
      process.env.GEMINI_MODEL = 'gemini-2.5-flash';
      const healedRes = await executeAIRequestWithFallback('Respond with ONLY: OK', undefined, undefined, { jsonMode: false });
      expect(healedRes.text).toBeDefined();
      // Auto-healed to verified model!
      expect(['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash']).toContain(healedRes.model);
    }, 30000);
  });
});
