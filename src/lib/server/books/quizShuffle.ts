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
 * Distribute the correct answer across option slots (A, B, C, D) using a balanced position
 * and shuffle distractors across the remaining slots.
 *
 * When targetPosition is specified (e.g., questionIndex), correct answers cycle evenly
 * across 0 (A), 1 (B), 2 (C), and 3 (D).
 */
export function distributeOptionsBalanced<T extends string>(
  correctOption: T,
  distractors: T[],
  targetPosition?: number
): { options: T[]; correctIndex: number } {
  const filteredDistractors = distractors.filter(d => Boolean(d) && d !== correctOption);

  // Shuffle distractors with Fisher-Yates
  const shuffledDistractors = [...filteredDistractors];
  for (let i = shuffledDistractors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffledDistractors[i];
    shuffledDistractors[i] = shuffledDistractors[j];
    shuffledDistractors[j] = temp;
  }

  const totalSlots = Math.min(4, shuffledDistractors.length + 1);
  const pos = targetPosition !== undefined
    ? Math.abs(targetPosition) % totalSlots
    : Math.floor(Math.random() * totalSlots);

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
