import { describe, it, expect } from 'vitest';
import {
  parseWakeWordAndCommand,
  DEFAULT_WAKE_WORDS,
  normalizeWakeText,
  cleanCommandPrefix,
  getRandomGreeting,
  WAKE_GREETINGS,
} from './wakeWordMatcher';

describe('Wake-Word Matcher & Utterance Extractor', () => {
  it('should normalize text for phonetic and case-insensitive matching', () => {
    expect(normalizeWakeText('Hey, Sami!   What is up?')).toBe('hey sami what is up');
  });

  it('should detect exact wake words without trailing command', () => {
    const res1 = parseWakeWordAndCommand('Wake up');
    expect(res1.detected).toBe(true);
    expect(res1.matchedWakeWord).toBe('wake up');
    expect(res1.commandText).toBe('');
    expect(res1.hasImmediateCommand).toBe(false);

    const res2 = parseWakeWordAndCommand('Sami');
    expect(res2.detected).toBe(true);
    expect(res2.matchedWakeWord).toBe('sami');
    expect(res2.commandText).toBe('');

    const res3 = parseWakeWordAndCommand('Hey AI');
    expect(res3.detected).toBe(true);
    expect(res3.matchedWakeWord).toBe('hey ai');
  });

  it('should prioritize multi-word aliases over single words', () => {
    // "hey sami" should match "hey sami", not just "sami"
    const res = parseWakeWordAndCommand('hey sami give me my brief');
    expect(res.detected).toBe(true);
    expect(res.matchedWakeWord).toBe('hey sami');
    expect(res.commandText).toBe('give me my brief');
    expect(res.hasImmediateCommand).toBe(true);
  });

  it('should capture immediate commands spoken in the same breath', () => {
    const res = parseWakeWordAndCommand('Sami, what do I have left to finish today?');
    expect(res.detected).toBe(true);
    expect(res.matchedWakeWord).toBe('sami');
    expect(res.commandText).toBe('what do I have left to finish today');
    expect(res.hasImmediateCommand).toBe(true);
  });

  it('should clean polite filler words and conjunctions from command start', () => {
    expect(cleanCommandPrefix('please create a task called study')).toBe('create a task called study');
    expect(cleanCommandPrefix('can you delete that task')).toBe('delete that task');
    expect(cleanCommandPrefix('and post to telegram')).toBe('post to telegram');
  });

  it('should support custom user-configured wake words', () => {
    const customWords = ['computer', 'jarvis'];
    const res1 = parseWakeWordAndCommand('computer turn on deep work', customWords);
    expect(res1.detected).toBe(true);
    expect(res1.matchedWakeWord).toBe('computer');
    expect(res1.commandText).toBe('turn on deep work');

    const res2 = parseWakeWordAndCommand('sami turn on deep work', customWords);
    expect(res2.detected).toBe(false);
  });

  it('should not false-positive on words containing the wake word as a substring', () => {
    // "air" or "mail" should not trigger "ai"
    const res1 = parseWakeWordAndCommand('open the airplane settings');
    expect(res1.detected).toBe(false);

    const res2 = parseWakeWordAndCommand('check my email inbox');
    expect(res2.detected).toBe(false);
  });

  it('should return natural varied greetings', () => {
    const greeting = getRandomGreeting();
    expect(WAKE_GREETINGS).toContain(greeting);

    const contextual = getRandomGreeting('You have 2 tasks remaining');
    expect(contextual.length).toBeGreaterThan(5);
  });
});
