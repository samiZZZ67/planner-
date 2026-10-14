/**
 * Text processing and intelligent sentence-boundary chunker for Text-To-Speech synthesis.
 */

export function cleanMarkdownForSpeech(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';

  return rawText
    // Remove multi-line code blocks with clean audio omission marker
    .replace(/```[\s\S]*?```/g, ' [Code snippet omitted] ')
    // Replace inline code ticks with content
    .replace(/`([^`]+)`/g, '$1')
    // Remove Markdown headers (# Header)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove Markdown image tags ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    // Replace Markdown links [label](url) with just label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove raw URLs
    .replace(/https?:\/\/\S+/g, '')
    // Remove bold and italic markers
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Remove blockquote markers
    .replace(/^\s*>\s+/gm, '')
    // Clean bullet points
    .replace(/^\s*[-*+]\s+/gm, '')
    // Clean numbered list indicators
    .replace(/^\s*\d+\.\s+/gm, '')
    // Collapse redundant whitespace & newlines
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Splits text into sensible speech chunks without breaking sentences or words.
 *
 * @param text The cleaned text to split.
 * @param maxChunkSize Maximum character limit per chunk (defaults to 1,000 characters).
 */
export function splitTextIntoSpeechChunks(text: string, maxChunkSize = 1000): string[] {
  const cleaned = cleanMarkdownForSpeech(text);
  if (!cleaned) return [];

  if (cleaned.length <= maxChunkSize) {
    return [cleaned];
  }

  // Split into paragraphs first
  const paragraphs = cleaned.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    // If paragraph fits into current chunk, append it
    if ((currentChunk + (currentChunk ? '\n\n' : '') + trimmedPara).length <= maxChunkSize) {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedPara;
      continue;
    }

    // If paragraph by itself is small enough, flush current and start with this paragraph
    if (trimmedPara.length <= maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = trimmedPara;
      continue;
    }

    // Paragraph is longer than maxChunkSize, split into sentences
    // Matches sentences ending with . ! ? followed by space or end of string
    const sentences = trimmedPara.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [trimmedPara];

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) continue;

      if ((currentChunk + (currentChunk ? ' ' : '') + trimmedSentence).length <= maxChunkSize) {
        currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());

        if (trimmedSentence.length <= maxChunkSize) {
          currentChunk = trimmedSentence;
        } else {
          // Sentence itself exceeds maxChunkSize: split on commas or spaces
          const words = trimmedSentence.split(/\s+/);
          let subChunk = '';
          for (const word of words) {
            if ((subChunk + (subChunk ? ' ' : '') + word).length <= maxChunkSize) {
              subChunk += (subChunk ? ' ' : '') + word;
            } else {
              if (subChunk) chunks.push(subChunk.trim());
              subChunk = word;
            }
          }
          currentChunk = subChunk;
        }
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
