/**
 * NightPlanner Wake-Word Matcher & Utterance Extractor
 *
 * Provides lightweight local wake-word phrase detection, command splitting,
 * and varied natural greetings without sending raw audio to paid remote models.
 */

export const DEFAULT_WAKE_WORDS: string[] = [
  'wake up',
  'sami',
  'hey sami',
  'ai',
  'hey ai',
  'moon',
  'hey moon',
];

export const STORAGE_KEY_WAKE_WORDS = 'np_voice_wake_words';
export const STORAGE_KEY_WAKE_ENABLED = 'np_voice_wake_enabled';
export const STORAGE_KEY_VOICE_REPLIES = 'np_voice_replies_enabled';
export const STORAGE_KEY_WAKE_CHIME = 'np_voice_wake_chime_enabled';

/**
 * Normalizes text for reliable phonetic and case-insensitive phrase matching.
 */
export function normalizeWakeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface WakeDetectionResult {
  detected: boolean;
  matchedWakeWord?: string;
  commandText: string;
  hasImmediateCommand: boolean;
}

/**
 * Checks a transcript against configured wake words.
 * If detected, separates the wake word from any trailing command spoken in the same breath.
 * Example: "Hey Sami, what do I have left today?"
 *   -> detected: true, matchedWakeWord: "hey sami", commandText: "what do I have left today?"
 */
export function parseWakeWordAndCommand(
  rawTranscript: string,
  configuredWakeWords: string[] = DEFAULT_WAKE_WORDS
): WakeDetectionResult {
  if (!rawTranscript || typeof rawTranscript !== 'string') {
    return { detected: false, commandText: '', hasImmediateCommand: false };
  }

  const normalized = normalizeWakeText(rawTranscript);
  if (!normalized) {
    return { detected: false, commandText: '', hasImmediateCommand: false };
  }

  // Sort wake words by length descending so multi-word aliases ("hey sami") match before "sami"
  const sortedWords = [...configuredWakeWords]
    .map(w => w.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const word of sortedWords) {
    // Match wake word at word boundaries (case-insensitive) on raw transcript to preserve original capitalization
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    const match = regex.exec(rawTranscript);

    if (match) {
      const matchEnd = match.index + match[0].length;
      const afterMatch = rawTranscript.slice(matchEnd).trim();
      const commandText = cleanCommandPrefix(afterMatch);

      return {
        detected: true,
        matchedWakeWord: word.toLowerCase(),
        commandText,
        hasImmediateCommand: commandText.length > 0,
      };
    }
  }

  return { detected: false, commandText: '', hasImmediateCommand: false };
}

/**
 * Cleans command text by removing leading filler words, commas, or conjunctions.
 */
export function cleanCommandPrefix(text: string): string {
  let cleaned = text.trim();
  // Strip leading punctuation and conjunctions
  cleaned = cleaned.replace(/^[\s,.\-!?:;]+/, '');
  cleaned = cleaned.replace(/^(?:please|can you|could you|would you|and|then)\s+/i, '');
  // Strip trailing punctuation
  cleaned = cleaned.replace(/[\s,.\-!?:;]+$/, '');
  return cleaned.trim();
}

/**
 * Natural varied greetings when wake word is detected
 */
export const WAKE_GREETINGS = [
  'Hi, Sam! What would you like me to do?',
  "I'm here. What's the plan?",
  "Morning! Your assistant is ready. What's next?",
  'Hey! What should I take care of?',
  'Ready when you are. Give me your command.',
  'Standing by, Sam. What do you need?',
  "I'm listening. How can I help with your schedule?",
];

/**
 * Selects a natural greeting, optionally incorporating quick context (e.g. pending tasks count).
 */
export function getRandomGreeting(contextSnippet?: string): string {
  if (contextSnippet && Math.random() < 0.4) {
    return `${contextSnippet}. What would you like to do?`;
  }
  const index = Math.floor(Math.random() * WAKE_GREETINGS.length);
  return WAKE_GREETINGS[index];
}

/**
 * Load configured wake words from localStorage with fallback to defaults.
 */
export function loadSavedWakeWords(): string[] {
  if (typeof window === 'undefined') return DEFAULT_WAKE_WORDS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WAKE_WORDS);
    if (!raw) return DEFAULT_WAKE_WORDS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map(w => String(w).trim().toLowerCase()).filter(Boolean);
    }
  } catch {}
  return DEFAULT_WAKE_WORDS;
}

/**
 * Save configured wake words to localStorage.
 */
export function saveWakeWords(words: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    const cleaned = words.map(w => w.trim().toLowerCase()).filter(Boolean);
    localStorage.setItem(STORAGE_KEY_WAKE_WORDS, JSON.stringify(cleaned));
  } catch {}
}
