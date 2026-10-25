/**
 * Unbiased Quiz Option Shuffling and Balanced Answer Key Distribution
 */

/**
 * Perform a true Fisher-Yates shuffle on options while keeping the correct answer index synchronized.
 */
export function shuffleOptionsWithKey<T extends string>(
  options: T[],
  correctIndex: number
): { options: T[]; correctIndex: number } {
  if (!options || options.length === 0) {
    return { options: [], correctIndex: 0 };
  }

  const safeCorrectIndex = Math.max(0, Math.min(correctIndex, options.length - 1));
  const indexed = options.map((opt, idx) => ({ opt, isCorrect: idx === safeCorrectIndex }));

  // Fisher-Yates unbiased shuffle
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = indexed[i];
    indexed[i] = indexed[j];
    indexed[j] = temp;
  }

  const newCorrectIndex = indexed.findIndex(item => item.isCorrect);
  return {
    options: indexed.map(item => item.opt),
    correctIndex: newCorrectIndex >= 0 ? newCorrectIndex : 0,
  };
}

/**
 * Randomize the answer slot independently for each question and shuffle its distractors.
 * targetPosition is retained for call compatibility, but never controls a predictable cycle.
 */
export function distributeOptionsBalanced<T extends string>(
  correctOption: T,
  distractors: T[],
  targetPosition?: number
): { options: T[]; correctIndex: number } {
  void targetPosition;
  const filteredDistractors = [...new Set(distractors.filter(d => Boolean(d) && d !== correctOption))];
  const fallbackDistractors = [
    'A conclusion that is not supported by the assigned passage',
    'An unrelated interpretation of the topic',
    'A claim that reverses the author’s stated point',
  ].filter(option => option !== correctOption && !new Set<string>(filteredDistractors).has(option)) as T[];

  // Shuffle distractors with Fisher-Yates
  const shuffledDistractors = [...filteredDistractors, ...fallbackDistractors].slice(0, 3);
  for (let i = shuffledDistractors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffledDistractors[i];
    shuffledDistractors[i] = shuffledDistractors[j];
    shuffledDistractors[j] = temp;
  }

  const totalSlots = 4;
  const pos = Math.floor(Math.random() * totalSlots);

  const options: T[] = [];
  let distractorIdx = 0;
  for (let i = 0; i < totalSlots; i++) {
    if (i === pos) {
      options.push(correctOption);
    } else {
      options.push(shuffledDistractors[distractorIdx++]);
    }
  }

  return {
    options,
    correctIndex: pos,
  };
}
