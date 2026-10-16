/**
 * Wikiquote API Service (https://en.wikiquote.org/w/api.php)
 *
 * Implements:
 * 1. Searching for quote articles by author, book title, or topic.
 * 2. Safe parsing of returned wikitext (stripping templates, wiki tags, links, and comments).
 * 3. Preserving quotation attribution and source context.
 * 4. Attribution: "Source: Wikiquote (CC BY-SA 4.0)" and canonical URL.
 */

import { externalSourceCaches, withRetry, normalizeQuery, deduplicateBy } from './cache';
import { getWikipediaUserAgent } from './wikipedia';

export interface WikiquoteItem {
  quote: string;
  author: string;
  sourceContext?: string;
  sourceUrl: string;
  attribution: string;
}

const WIKIQUOTE_API_ENDPOINT = 'https://en.wikiquote.org/w/api.php';

/**
 * Safely parses raw Wikitext into clean text while preserving quotation meaning.
 */
export function parseWikitext(wikitext: string): string {
  if (!wikitext) return '';

  let text = wikitext;

  // 1. Remove comments <!-- ... -->
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // 2. Remove reference tags <ref>...</ref> and <ref ... />
  text = text.replace(/<ref\b[\s\S]*?<\/ref>/gi, '');
  text = text.replace(/<ref\b[^>]*\/>/gi, '');

  // 3. Remove standard media / files / categories: [[Category:...]], [[File:...]], [[Image:...]]
  text = text.replace(/\[\[(?:Category|File|Image):[^\]]*\]\]/gi, '');

  // 4. Handle templates {{w|Topic|Text}} -> Text, {{quote|...}}
  text = text.replace(/\{\{(?:w\|)?([^|}]+)\|([^}]+)\}\}/g, '$2');
  text = text.replace(/\{\{[^}]+\}\}/g, '');

  // 5. Convert wiki internal links: [[Article|Display]] -> Display, [[Article]] -> Article
  text = text.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1');

  // 6. Convert external links: [https://... Display] -> Display
  text = text.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1');
  text = text.replace(/\[https?:\/\/[^\s\]]+\]/g, '');

  // 7. Remove wiki formatting for bold/italic (''' or '')
  text = text.replace(/'''''/g, '');
  text = text.replace(/'''/g, '');
  text = text.replace(/''/g, '');

  // 8. Remove any remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  return text.trim();
}

/**
 * Extracts individual quotations with source context from raw Wikiquote article wikitext.
 */
export function extractQuotesFromWikitext(
  wikitext: string,
  author: string,
  sourceUrl: string,
  maxQuotes = 5
): WikiquoteItem[] {
  if (!wikitext) return [];

  const lines = wikitext.split('\n');
  const items: WikiquoteItem[] = [];

  let currentSection = '';
  let pendingQuote = '';
  let pendingContext = '';

  const savePending = () => {
    if (pendingQuote && pendingQuote.length >= 15 && pendingQuote.length <= 600) {
      items.push({
        quote: pendingQuote,
        author,
        sourceContext: pendingContext || currentSection || undefined,
        sourceUrl,
        attribution: 'Source: Wikiquote (CC BY-SA 4.0)',
      });
    }
    pendingQuote = '';
    pendingContext = '';
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // Section header (e.g. == Quotes == or === The Republic ===)
    const sectionMatch = trimmed.match(/^={2,4}\s*([^=]+)\s*={2,4}$/);
    if (sectionMatch) {
      savePending();
      const secTitle = parseWikitext(sectionMatch[1]);
      if (!/external links|see also|references|further reading/i.test(secTitle)) {
        currentSection = secTitle;
      }
      continue;
    }

    // Skip ignored sections
    if (/external links|see also|references|further reading/i.test(currentSection)) {
      continue;
    }

    // Secondary bullet point (context, date, or source line for the previous quote)
    if (trimmed.startsWith('**') || trimmed.startsWith('*:')) {
      const cleanSub = parseWikitext(trimmed.replace(/^(\*\*|\*:)\s*/, ''));
      if (cleanSub) {
        pendingContext = pendingContext ? `${pendingContext}; ${cleanSub}` : cleanSub;
      }
      continue;
    }

    // Primary quote bullet point
    if (trimmed.startsWith('*')) {
      savePending();
      const cleanLine = parseWikitext(trimmed.replace(/^\*\s*/, ''));
      // Clean leading and trailing quotation marks
      const unquoted = cleanLine.replace(/^["'“‘]+|["'”’]+$/g, '').trim();

      // Check for inline attribution in the line: e.g. "Quote text" ~ Author, Source
      const splitTilde = unquoted.split(/\s+~\s+/);
      if (splitTilde.length > 1) {
        pendingQuote = splitTilde[0].trim();
        pendingContext = splitTilde.slice(1).join(' ').trim();
      } else {
        pendingQuote = unquoted;
      }

      if (items.length >= maxQuotes * 2) break;
    }
  }

  savePending();

  // Deduplicate and filter quotes
  const deduplicated = deduplicateBy(items, i => i.quote.toLowerCase());
  return deduplicated.slice(0, maxQuotes);
}

/**
 * Searches Wikiquote for matching page titles.
 */
export async function searchWikiquote(query: string, limit = 5): Promise<string[]> {
  const clean = normalizeQuery(query);
  if (!clean) return [];

  const cacheKey = `search:${clean}:${limit}`;
  const cached = externalSourceCaches.wikiquote.get(cacheKey) as string[] | undefined;
  if (cached) return cached;

  const url = new URL(WIKIQUOTE_API_ENDPOINT);
  url.searchParams.set('action', 'query');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srsearch', clean);
  url.searchParams.set('srlimit', String(limit));
  url.searchParams.set('utf8', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  try {
    const data = await withRetry(async () => {
      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': getWikipediaUserAgent(),
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw Object.assign(new Error(`Wikiquote search error: HTTP ${res.status}`), { status: res.status });
      }
      return res.json();
    });

    const titles = (data?.query?.search || []).map((item: any) => String(item.title || '').trim()).filter(Boolean);
    externalSourceCaches.wikiquote.set(cacheKey, titles);
    return titles;
  } catch (err: any) {
    console.warn(`[Wikiquote] Search failed for "${query}":`, err.message);
    return [];
  }
}

/**
 * Retrieves quotes from a Wikiquote article by page title or query.
 */
export async function getWikiquoteQuotes(titleOrQuery: string, maxQuotes = 4): Promise<WikiquoteItem[]> {
  const clean = normalizeQuery(titleOrQuery);
  if (!clean) return [];

  const cacheKey = `quotes:${clean.toLowerCase()}:${maxQuotes}`;
  const cached = externalSourceCaches.wikiquote.get(cacheKey) as WikiquoteItem[] | undefined;
  if (cached) return cached;

  let pageTitle = clean;

  const fetchPageWikitext = async (title: string): Promise<string | null> => {
    const url = new URL(WIKIQUOTE_API_ENDPOINT);
    url.searchParams.set('action', 'parse');
    url.searchParams.set('page', title);
    url.searchParams.set('prop', 'wikitext');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    try {
      const data = await withRetry(async () => {
        const res = await fetch(url.toString(), {
          headers: {
            'User-Agent': getWikipediaUserAgent(),
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          throw Object.assign(new Error(`Wikiquote fetch error: HTTP ${res.status}`), { status: res.status });
        }
        return res.json();
      });

      return data?.parse?.wikitext?.['*'] || null;
    } catch {
      return null;
    }
  };

  // Try direct page title
  let wikitext = await fetchPageWikitext(pageTitle);

  // If not found, search Wikiquote for the best page match
  if (!wikitext) {
    const searchMatches = await searchWikiquote(clean, 3);
    if (searchMatches.length > 0) {
      pageTitle = searchMatches[0];
      wikitext = await fetchPageWikitext(pageTitle);
    }
  }

  if (!wikitext) return [];

  const sourceUrl = `https://en.wikiquote.org/wiki/${encodeURIComponent(pageTitle.replace(/\s+/g, '_'))}`;
  const quotes = extractQuotesFromWikitext(wikitext, pageTitle, sourceUrl, maxQuotes);

  externalSourceCaches.wikiquote.set(cacheKey, quotes);
  return quotes;
}
