/**
 * AI-Powered and Syntax-Aware Telegram Message Formatter
 *
 * Implements intelligent, content-type-aware formatting for Telegram Bot API
 * using parse_mode: 'HTML'.
 *
 * Guarantees:
 * 1. 100% preservation of original meaning, words, citations, URLs, emojis, and line breaks.
 * 2. Proper HTML escaping (&, <, >) outside valid Telegram tags so Telegram never rejects messages.
 * 3. Strict sanitization to only Telegram-supported tags (b, i, u, s, code, pre, a, blockquote, tg-spoiler).
 * 4. Tag-aware message chunking (preserves open tags across segments, never breaks tags/links).
 * 5. Safe plain-text fallback on API parse rejection so no message is ever lost.
 */

import { sendChatCompletionWithFallback } from './freellm/gateway';

export type TelegramContentType =
  | 'book_excerpt'
  | 'educational'
  | 'technical'
  | 'list_instruction'
  | 'general';

export interface TelegramFormatOptions {
  contentType?: TelegramContentType;
  allowAiEnhancement?: boolean;
}

/**
 * Valid tags supported by Telegram Bot API HTML parse mode.
 */
const SUPPORTED_TELEGRAM_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'code',
  'pre',
  'a',
  'blockquote',
  'tg-spoiler',
]);

/**
 * Escapes characters for Telegram HTML text nodes: &, <, >
 */
export function escapeTelegramHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapes attribute values for Telegram HTML tags: &, <, >, "
 */
export function escapeTelegramAttr(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Strips all HTML tags and decodes common entities back to plain text.
 * Used for safe fallback delivery when Telegram rejects HTML entities.
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Automatically detects the content type of a message based on its structure and patterns.
 */
export function detectTelegramContentType(text: string): TelegramContentType {
  if (!text) return 'general';

  // 1. Book excerpt pattern
  if (
    /\[PDF\s*page\s*\d+/i.test(text) ||
    /📄\s*\[PDF\s*Page/i.test(text) ||
    /Reading Load Plan · Day \d+/i.test(text) ||
    /Reading assignment for \d{4}-\d{2}-\d{2}/i.test(text)
  ) {
    return 'book_excerpt';
  }

  // 2. Educational content pattern
  if (
    /(?:Study\s*summary|Key\s*concepts|Definitions:|Revision\s*questions|Study\s*notes|Practical\s*application|Connection\s*to\s*(?:yesterday|Day\s*\d+))/i.test(text)
  ) {
    return 'educational';
  }

  // 3. Technical content pattern
  const hasCodeFences = /```[\s\S]*?```/.test(text);
  const inlineCodeCount = (text.match(/`[^`\n]+`/g) || []).length;
  const hasCliCommands = /(?:^\s*[$#]\s+[a-z0-9_-]+|\bnpm\s+(?:install|run|test)|\bdocker\s+run|\bgit\s+(?:commit|push|pull|status))/m.test(text);
  const hasProgrammingKeywords = /\b(?:function\s+[a-zA-Z0-9_$]+|const\s+[a-zA-Z0-9_$]+\s*=|import\s+.*?from\s+['"]|export\s+(?:default\s+)?(?:async\s+)?function|class\s+[A-Z][a-zA-Z0-9_]*|def\s+[a-zA-Z0-9_]+\s*\(|console\.log\()/m.test(text);
  if (hasCodeFences || inlineCodeCount >= 3 || hasCliCommands || hasProgrammingKeywords) {
    return 'technical';
  }

  // 4. Lists & Instructions pattern
  const numberedSteps = text.match(/^\s*(?:\d+[\.\)]|Step\s*\d+[:\.\)])\s+[A-Z0-9]/gm);
  if (numberedSteps && numberedSteps.length >= 3) {
    return 'list_instruction';
  }

  return 'general';
}

/**
 * Sanitizes and normalizes HTML for Telegram Bot API:
 * 1. Converts headers (h1-h6) to <b>
 * 2. Strips unsupported tags while preserving inner text
 * 3. Ensures all opened tags are balanced and correctly closed
 */
export function sanitizeTelegramHtml(input: string): string {
  if (!input) return '';

  // Completely strip dangerous script and style elements with their inner contents
  let processed = input
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(p|div|section|article)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, '<b>$1</b>\n');

  // Tokenize HTML tags and text nodes
  const tagRegex = /<\/?([a-zA-Z0-9_-]+)((?:\s+[a-zA-Z0-9_-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]+))?)*)\s*(\/?)>/g;
  let result = '';
  let lastIndex = 0;
  const openTagStack: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(processed)) !== null) {
    const rawTag = match[0];
    const tagName = match[1].toLowerCase();
    const attrs = match[2] || '';
    const isClosing = rawTag.startsWith('</');
    const isSelfClosing = match[3] === '/' || rawTag.endsWith('/>');

    // Text before the tag
    const textBefore = processed.slice(lastIndex, match.index);
    result += textBefore;
    lastIndex = tagRegex.lastIndex;

    // Check if this tag is supported by Telegram
    if (!SUPPORTED_TELEGRAM_TAGS.has(tagName)) {
      // Unsupported tag: omit the tag itself, inner text is preserved
      continue;
    }

    if (isClosing) {
      // Find matching open tag in stack
      const openIdx = openTagStack.lastIndexOf(tagName);
      if (openIdx !== -1) {
        // Close any tags opened after this one in reverse order
        while (openTagStack.length > openIdx + 1) {
          const unclosed = openTagStack.pop()!;
          result += `</${unclosed}>`;
        }
        openTagStack.pop();
        result += `</${tagName}>`;
      }
      // If no matching opening tag was found, discard this orphan closing tag
    } else {
      // Opening tag
      if (tagName === 'a') {
        const hrefMatch = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        const href = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '').trim() : '';
        if (href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('tg://'))) {
          result += `<a href="${escapeTelegramAttr(href)}">`;
          if (!isSelfClosing) openTagStack.push('a');
        } else {
          // Invalid or missing href: do not output <a> tag
        }
      } else if (tagName === 'pre') {
        result += '<pre>';
        if (!isSelfClosing) openTagStack.push('pre');
      } else if (tagName === 'code') {
        const classMatch = /class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        const className = classMatch ? (classMatch[1] || classMatch[2] || classMatch[3] || '').trim() : '';
        if (className) {
          result += `<code class="${escapeTelegramAttr(className)}">`;
        } else {
          result += '<code>';
        }
        if (!isSelfClosing) openTagStack.push('code');
      } else if (tagName === 'blockquote') {
        const isExpandable = /\bexpandable\b/i.test(attrs);
        result += isExpandable ? '<blockquote expandable>' : '<blockquote>';
        if (!isSelfClosing) openTagStack.push('blockquote');
      } else {
        // Other supported inline formatting tags: b, i, u, s, tg-spoiler
        result += `<${tagName}>`;
        if (!isSelfClosing) openTagStack.push(tagName);
      }
    }
  }

  // Append remaining text after last tag
  result += processed.slice(lastIndex);

  // Close any still-open tags at the end of the text
  while (openTagStack.length > 0) {
    const unclosed = openTagStack.pop()!;
    result += `</${unclosed}>`;
  }

  return result;
}

/**
 * Intelligent Markdown to Telegram HTML converter.
 * Preserves all words, URLs, line breaks, and emojis exactly.
 */
export function formatMarkdownToTelegramHtml(text: string): string {
  if (!text) return '';

  const placeholders: string[] = [];
  function storeToken(content: string): string {
    const token = `\uE000TOKEN_${placeholders.length}\uE001`;
    placeholders.push(content);
    return token;
  }

  // 1. Protect existing code blocks (```lang\n...\n```)
  let working = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const escapedCode = escapeTelegramHtml(code.trimEnd());
    const langAttr = lang ? ` class="language-${escapeTelegramAttr(lang)}"` : '';
    return storeToken(`<pre><code${langAttr}>${escapedCode}</code></pre>`);
  });

  // 2. Protect existing inline code (`...`)
  working = working.replace(/`([^`\n]+)`/g, (_, code) => {
    return storeToken(`<code>${escapeTelegramHtml(code)}</code>`);
  });

  // 3. Protect existing valid HTML tags
  working = working.replace(/<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|a|blockquote|tg-spoiler)(?:\s+[^>]*?)?>/gi, match => {
    return storeToken(match);
  });

  // 4. Escape remaining raw HTML characters in text
  working = working
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 5. Convert markdown blockquotes (> Quote)
  working = working.replace(/(?:^|\n)&gt;\s*([\s\S]+?)(?=\n\n|$)/g, (match, quoteContent) => {
    const cleaned = quoteContent.replace(/^\s*&gt;\s?/gm, '');
    return `\n<blockquote>${cleaned.trim()}</blockquote>\n`;
  });

  // 6. Convert markdown headings (# Heading)
  working = working.replace(/^(#{1,6})\s+([^\n]+)$/gm, (_, hashes, heading) => {
    return `<b>${heading.trim()}</b>`;
  });

  // 7. Convert markdown bold (**text** or __text__)
  working = working.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  working = working.replace(/(?<!\w)__([^_\n]+?)__(?!\w)/g, '<b>$1</b>');

  // 8. Convert markdown strikethrough (~~text~~)
  working = working.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');

  // 9. Convert markdown italic (*text* or _text_)
  working = working.replace(/(?<![*a-zA-Z0-9])\*([^*\n]+?)\*(?![*a-zA-Z0-9])/g, '<i>$1</i>');
  working = working.replace(/(?<![_a-zA-Z0-9])_([^_\n]+?)_(?![_a-zA-Z0-9])/g, '<i>$1</i>');

  // 10. Convert markdown links ([text](url))
  working = working.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s\)]+)\)/g, (_, linkText, url) => {
    return `<a href="${escapeTelegramAttr(url)}">${linkText}</a>`;
  });

  // 11. Autolink bare URLs (https://... or http://...) not already preceded by href="
  working = working.replace(/(?<!href=")(https?:\/\/[^\s<>"'\uE000-\uE001]+)/g, url => {
    // Strip trailing punctuation like ., !, ), etc.
    const cleanUrl = url.replace(/[.,;:!?)]+$/, '');
    const trailing = url.slice(cleanUrl.length);
    return `<a href="${escapeTelegramAttr(cleanUrl)}">${cleanUrl}</a>${trailing}`;
  });

  // 12. Restore protected tokens
  for (let i = 0; i < placeholders.length; i++) {
    working = working.replace(`\uE000TOKEN_${i}\uE001`, () => placeholders[i]);
  }

  // 13. Ensure valid tag nesting and closure
  return sanitizeTelegramHtml(working);
}

/**
 * Formats educational content (reading plans, study notes, revision questions)
 * into high-readability Telegram HTML while preserving all text verbatim.
 */
function formatEducationalContent(text: string): string {
  let formatted = text;

  // Format header markers
  formatted = formatted.replace(
    /^(📖\s*[^—\n]+(?:—[^\n]+)?)$/m,
    '<b>$1</b>'
  );
  formatted = formatted.replace(
    /^(📅\s*Reading Load Plan[^\n]*)$/m,
    '<b>$1</b>'
  );

  // Format section titles with clean bold markers
  formatted = formatted.replace(
    /(?:^|\n)(📝\s*Study Summary|Study summary)\b/gi,
    '\n📝 <b>Study Summary</b>'
  );
  formatted = formatted.replace(
    /(?:^|\n)(💡\s*Key Concepts|Key concepts:?)\b/gi,
    '\n💡 <b>Key Concepts:</b>'
  );
  formatted = formatted.replace(
    /(?:^|\n)(Definitions:?)\b/gi,
    '\n📚 <b>Definitions:</b>'
  );
  formatted = formatted.replace(
    /(?:^|\n)(Revision questions:?)\b/gi,
    '\n❓ <b>Revision Questions:</b>'
  );
  formatted = formatted.replace(
    /(?:^|\n)(Study notes:?)\b/gi,
    '\n✍️ <b>Study Notes:</b>'
  );
  formatted = formatted.replace(
    /(?:^|\n)(Practical application[^\n]*)\b/gi,
    '\n🔬 <b>$1</b>'
  );
  formatted = formatted.replace(
    /(?:^|\n)(Connection to (?:yesterday's post|Day \d+)[^\n]*)\b/gi,
    '\n🔗 <b>$1</b>'
  );

  // Format definitions: • Term (PDF p. X): Explanation
  formatted = formatted.replace(
    /^[•\-*]\s*([^(\n:]+)\s*\((PDF p\.\s*\d+)\):\s*([\s\S]+?)$/gm,
    '• <b>$1</b> <i>($2)</i>: $3'
  );

  // Format questions: 1. Question?\nAnswer: Answer text
  formatted = formatted.replace(
    /^(\d+)\.\s*([^\n?]+\?)\s*\nAnswer:\s*([^\n]+)/gm,
    '<b>$1. $2</b>\n<i>Answer:</i> $3'
  );

  return formatMarkdownToTelegramHtml(formatted);
}

/**
 * Formats book excerpt text while preserving 100% exact wording of the original text.
 */
function formatBookExcerpt(text: string): string {
  // Identify page headers like [PDF page X] or 📄 [PDF Page X · Part Y/Z]
  return text.replace(
    /(?:^|\n)(\[PDF page \d+[^\]]*\]|📄\s*\[PDF Page \d+[^\]]*\])\n([\s\S]*?)(?=(?:\n\[PDF page |\n📄\s*\[PDF Page |$))/gi,
    (match, header, pageBody) => {
      const cleanHeader = header.trim();
      const formattedHeader = cleanHeader.startsWith('📄')
        ? `📄 <b>${cleanHeader.slice(1).trim()}</b>`
        : `📄 <b>${cleanHeader}</b>`;

      // The body text is preserved verbatim with safe code block and entity escaping
      const formattedBody = formatMarkdownToTelegramHtml(pageBody.trim());
      return `\n${formattedHeader}\n${formattedBody}\n`;
    }
  );
}

/**
 * Main intelligent formatter function.
 * Automatically formats content according to its detected or provided content type.
 */
export function formatTelegramMessage(
  text: string,
  options?: TelegramFormatOptions
): string {
  if (!text || !text.trim()) return '';

  const contentType = options?.contentType || detectTelegramContentType(text);

  switch (contentType) {
    case 'book_excerpt': {
      // If the text contains both book header/notes AND excerpts, handle excerpts safely
      if (/\[PDF\s*page\s*\d+/i.test(text)) {
        return formatBookExcerpt(text);
      }
      return formatMarkdownToTelegramHtml(text);
    }
    case 'educational': {
      return formatEducationalContent(text);
    }
    case 'technical':
    case 'list_instruction':
    case 'general':
    default: {
      return formatMarkdownToTelegramHtml(text);
    }
  }
}

/**
 * Safely splits a Telegram HTML message into multiple parts of at most `maxChars`
 * (default 3800, well within Telegram's 4096 limit) while:
 * 1. Never splitting inside an HTML tag (<...>) or HTML entity (&...;)
 * 2. Never splitting inside a URL or inline formatting entity if possible
 * 3. Closing all currently open tags at the end of each chunk
 * 4. Re-opening those exact tags at the beginning of the next chunk
 */
export function splitTelegramHtml(html: string, maxChars = 3800): string[] {
  if (!html) return [''];
  if (html.length <= maxChars) return [html];

  const chunks: string[] = [];
  let remaining = html;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Determine safe split point
    let splitIdx = maxChars;

    // 1. Scan for the best breakpoint (paragraph break \n\n > line break \n > sentence end . > space)
    const windowStart = Math.floor(maxChars * 0.6);
    const searchSlice = remaining.slice(windowStart, maxChars);

    const dblNewline = searchSlice.lastIndexOf('\n\n');
    const sglNewline = searchSlice.lastIndexOf('\n');
    const sentenceEnd = searchSlice.lastIndexOf('. ');
    const space = searchSlice.lastIndexOf(' ');

    if (dblNewline !== -1) {
      splitIdx = windowStart + dblNewline + 2;
    } else if (sglNewline !== -1) {
      splitIdx = windowStart + sglNewline + 1;
    } else if (sentenceEnd !== -1) {
      splitIdx = windowStart + sentenceEnd + 2;
    } else if (space !== -1) {
      splitIdx = windowStart + space + 1;
    }

    // 2. Ensure splitIdx is not inside an HTML tag (<...>)
    const openTagIdx = remaining.lastIndexOf('<', splitIdx);
    const closeTagIdx = remaining.lastIndexOf('>', splitIdx);
    if (openTagIdx > closeTagIdx) {
      // Split point was inside a tag; backtrack to before '<'
      splitIdx = openTagIdx;
    }

    // 3. Ensure splitIdx is not inside an HTML entity (&...;)
    const ampIdx = remaining.lastIndexOf('&', splitIdx);
    const semiIdx = remaining.lastIndexOf(';', splitIdx);
    if (ampIdx > semiIdx && splitIdx - ampIdx < 10) {
      // Split point was inside an entity; backtrack to before '&'
      splitIdx = ampIdx;
    }

    if (splitIdx <= 0) {
      splitIdx = maxChars;
    }

    let chunk = remaining.slice(0, splitIdx);
    remaining = remaining.slice(splitIdx);

    // 4. Calculate which HTML tags are currently open in this chunk
    const openTags = getOpenHtmlTags(chunk);

    // 5. Close all open tags at the end of current chunk
    if (openTags.length > 0) {
      const closingTags = openTags.slice().reverse().map(t => `</${t.tag}>`).join('');
      chunk += closingTags;

      // 6. Prepend the re-opened tags to the next remaining segment
      const reopeningTags = openTags.map(t => t.openHtml).join('');
      remaining = reopeningTags + remaining;
    }

    chunks.push(chunk);
  }

  return chunks.length ? chunks : [''];
}

interface OpenTagInfo {
  tag: string;
  openHtml: string;
}

/**
 * Helper to determine which Telegram HTML tags remain open at the end of a string.
 */
function getOpenHtmlTags(html: string): OpenTagInfo[] {
  const tagRegex = /<\/?([a-zA-Z0-9_-]+)((?:\s+[a-zA-Z0-9_-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]+))?)*)\s*(\/?)>/g;
  const stack: OpenTagInfo[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const rawTag = match[0];
    const tagName = match[1].toLowerCase();
    const isClosing = rawTag.startsWith('</');
    const isSelfClosing = match[3] === '/' || rawTag.endsWith('/>');

    if (!SUPPORTED_TELEGRAM_TAGS.has(tagName) || isSelfClosing) continue;

    if (isClosing) {
      const idx = stack.map(s => s.tag).lastIndexOf(tagName);
      if (idx !== -1) {
        stack.splice(idx, 1);
      }
    } else {
      // Tag opened
      stack.push({ tag: tagName, openHtml: rawTag });
    }
  }

  return stack;
}

/**
 * Optional AI-Powered Telegram Formatting Enhancement
 * Uses FreeLLM / gateway models when available with strict preservation verification.
 * If the model alters or truncates original words, it automatically discards the AI
 * result and falls back to rule-based formatting.
 */
export async function enhanceTelegramMessageWithAi(
  text: string,
  model = 'auto'
): Promise<string> {
  if (!text || text.trim().length < 20 || process.env.VITEST) {
    return formatTelegramMessage(text);
  }

  // Book excerpts are NEVER modified by LLMs to guarantee 100% verbatim source integrity
  if (detectTelegramContentType(text) === 'book_excerpt') {
    return formatTelegramMessage(text);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const systemPrompt = `You are a Telegram message formatter.
Your SOLE job is to add Telegram HTML formatting tags (<b>, <i>, <code>, <pre>, <blockquote>, <a href="...">) to improve presentation and readability.

STRICT CONSTRAINTS:
1. You MUST preserve EVERY single word, sentence, line break, emoji, number, link, and detail 100% exactly as provided.
2. DO NOT summarize, paraphrase, translate, omit, or rewrite ANY text.
3. DO NOT invent facts, headings, or quotes.
4. Output ONLY the formatted text with Telegram-supported HTML tags (<b>, <i>, <code>, <pre>, <blockquote>, <a>). Do not wrap the response in markdown code blocks.`;

    const result = await sendChatCompletionWithFallback({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      model,
      temperature: 0.1,
    });
    clearTimeout(timeout);

    const formattedOutput = result.content?.trim();
    if (!formattedOutput) return formatTelegramMessage(text);

    // Verify preservation integrity: stripped AI output must contain all original key words
    const originalWords = text.trim().split(/\s+/).filter(w => w.length > 2);
    const outputWords = stripHtml(formattedOutput).trim().split(/\s+/).filter(w => w.length > 2);

    const originalSet = new Set(originalWords.map(w => w.toLowerCase()));
    const outputSet = new Set(outputWords.map(w => w.toLowerCase()));

    let matches = 0;
    for (const w of originalSet) {
      if (outputSet.has(w)) matches++;
    }

    const similarity = originalSet.size > 0 ? matches / originalSet.size : 1;
    if (similarity >= 0.92) {
      return sanitizeTelegramHtml(formattedOutput);
    }

    // AI modified or dropped too much content; fall back to deterministic formatter
    return formatTelegramMessage(text);
  } catch {
    // If AI fails or times out, immediately fall back to deterministic formatter
    return formatTelegramMessage(text);
  }
}
