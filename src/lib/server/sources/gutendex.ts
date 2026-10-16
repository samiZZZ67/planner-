/**
 * Gutendex API Service (https://gutendex.com/)
 *
 * Implements:
 * 1. Book metadata search by title/author across Project Gutenberg.
 * 2. Ebook format identification (plain text, EPUB, HTML, etc.).
 * 3. Text retrieval strictly from accessible plain-text resources (never mistaking metadata for book content).
 * 4. Safe streaming/capping of text downloads and caching.
 */

import { externalSourceCaches, withRetry, normalizeQuery } from './cache';

export interface GutenbergAuthor {
  name: string;
  birthYear?: number;
  deathYear?: number;
}

export interface GutenbergBook {
  id: number;
  title: string;
  authors: GutenbergAuthor[];
  languages: string[];
  subjects: string[];
  downloadCount: number;
  formats: Record<string, string>;
  availableFormats: {
    plainTextUrl?: string;
    epubUrl?: string;
    htmlUrl?: string;
  };
  gutenbergUrl: string;
}

export interface GutenbergTextExtract {
  bookId: number;
  title: string;
  sourceUrl: string;
  text: string;
  byteCount: number;
  truncated: boolean;
  attribution: string;
}

const GUTENDEX_API_ENDPOINT = 'https://gutendex.com/books';

const ACCESSIBLE_TEXT_FORMAT_KEYS = [
  'text/plain; charset=utf-8',
  'text/plain; charset=us-ascii',
  'text/plain; charset=iso-8859-1',
  'text/plain',
];

/**
 * Extracts and maps accessible format URLs from Gutendex formats map.
 */
export function identifyAvailableFormats(formats: Record<string, string> = {}): {
  plainTextUrl?: string;
  epubUrl?: string;
  htmlUrl?: string;
} {
  let plainTextUrl: string | undefined;
  for (const key of ACCESSIBLE_TEXT_FORMAT_KEYS) {
    if (formats[key] && !formats[key].endsWith('.zip')) {
      plainTextUrl = formats[key];
      break;
    }
  }

  // Also check if any format key contains 'text/plain' and doesn't point to a zip
  if (!plainTextUrl) {
    for (const [key, url] of Object.entries(formats)) {
      if (key.startsWith('text/plain') && !url.endsWith('.zip')) {
        plainTextUrl = url;
        break;
      }
    }
  }

  const epubUrl = formats['application/epub+zip'] || Object.entries(formats).find(([k]) => k.includes('epub'))?.[1];
  const htmlUrl = formats['text/html'] || Object.entries(formats).find(([k]) => k.includes('html'))?.[1];

  return { plainTextUrl, epubUrl, htmlUrl };
}

/**
 * Searches Gutendex for public domain books matching a query.
 */
export async function searchGutendex(query: string, limit = 5): Promise<GutenbergBook[]> {
  const clean = normalizeQuery(query);
  if (!clean) return [];

  const cacheKey = `search:${clean}:${limit}`;
  const cached = externalSourceCaches.gutendex.get(cacheKey) as GutenbergBook[] | undefined;
  if (cached) return cached;

  const url = new URL(GUTENDEX_API_ENDPOINT);
  url.searchParams.set('search', clean);

  try {
    const data = await withRetry(async () => {
      const res = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NightPlanner-MoonAI/1.0',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw Object.assign(new Error(`Gutendex API error: HTTP ${res.status}`), { status: res.status });
      }
      return res.json();
    });

    const results = (data?.results || []).slice(0, limit).map((item: any): GutenbergBook => {
      const formats: Record<string, string> = item.formats || {};
      const availableFormats = identifyAvailableFormats(formats);
      return {
        id: Number(item.id),
        title: String(item.title || 'Untitled').trim(),
        authors: (item.authors || []).map((a: any) => ({
          name: String(a.name || '').trim(),
          birthYear: a.birth_year ? Number(a.birth_year) : undefined,
          deathYear: a.death_year ? Number(a.death_year) : undefined,
        })),
        languages: Array.isArray(item.languages) ? item.languages : [],
        subjects: Array.isArray(item.subjects) ? item.subjects.slice(0, 5) : [],
        downloadCount: Number(item.download_count || 0),
        formats,
        availableFormats,
        gutenbergUrl: `https://www.gutenberg.org/ebooks/${item.id}`,
      };
    });

    externalSourceCaches.gutendex.set(cacheKey, results);
    return results;
  } catch (err: any) {
    console.warn(`[Gutendex] Search failed for "${query}":`, err.message);
    return [];
  }
}

/**
 * Retrieves a single Gutenberg book by its ID.
 */
export async function getGutenbergBook(bookId: number): Promise<GutenbergBook | null> {
  if (!bookId || bookId <= 0) return null;

  const cacheKey = `book:${bookId}`;
  const cached = externalSourceCaches.gutendex.get(cacheKey) as GutenbergBook | undefined;
  if (cached) return cached;

  const url = `${GUTENDEX_API_ENDPOINT}/${bookId}`;

  try {
    const item = await withRetry(async () => {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'NightPlanner-MoonAI/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw Object.assign(new Error(`Gutendex book lookup error: HTTP ${res.status}`), { status: res.status });
      }
      return res.json();
    });

    const formats: Record<string, string> = item.formats || {};
    const book: GutenbergBook = {
      id: Number(item.id),
      title: String(item.title || 'Untitled').trim(),
      authors: (item.authors || []).map((a: any) => ({
        name: String(a.name || '').trim(),
        birthYear: a.birth_year ? Number(a.birth_year) : undefined,
        deathYear: a.death_year ? Number(a.death_year) : undefined,
      })),
      languages: Array.isArray(item.languages) ? item.languages : [],
      subjects: Array.isArray(item.subjects) ? item.subjects.slice(0, 5) : [],
      downloadCount: Number(item.download_count || 0),
      formats,
      availableFormats: identifyAvailableFormats(formats),
      gutenbergUrl: `https://www.gutenberg.org/ebooks/${item.id}`,
    };

    externalSourceCaches.gutendex.set(cacheKey, book);
    return book;
  } catch (err: any) {
    console.warn(`[Gutendex] Lookup failed for book ${bookId}:`, err.message);
    return null;
  }
}

/**
 * Retrieves actual book text ONLY from accessible text resources.
 * Strictly verifies content type and excludes HTML or JSON metadata to prevent
 * mistaking metadata for book content.
 */
export async function fetchGutenbergBookText(
  bookOrFormatUrl: GutenbergBook | string,
  options: { maxBytes?: number; skipHeaders?: boolean } = {}
): Promise<GutenbergTextExtract | null> {
  const maxBytes = options.maxBytes ?? 100_000; // Default 100KB max to conserve memory
  let textUrl: string | undefined;
  let bookId = 0;
  let bookTitle = 'Project Gutenberg Book';

  if (typeof bookOrFormatUrl === 'string') {
    textUrl = bookOrFormatUrl;
  } else {
    bookId = bookOrFormatUrl.id;
    bookTitle = bookOrFormatUrl.title;
    textUrl = bookOrFormatUrl.availableFormats.plainTextUrl;
  }

  if (!textUrl) {
    console.warn(`[Gutendex] No accessible plain text format found for book "${bookTitle}"`);
    return null;
  }

  // Safety check: ensure the URL is not a JSON API endpoint or an EPUB archive
  if (textUrl.endsWith('.json') || textUrl.endsWith('.epub') || textUrl.endsWith('.zip')) {
    throw new Error(`Cannot retrieve book text from non-text resource: ${textUrl}`);
  }

  const cacheKey = `text:${textUrl}:${maxBytes}`;
  const cached = externalSourceCaches.gutendex.get(cacheKey) as GutenbergTextExtract | undefined;
  if (cached) return cached;

  try {
    const rawText = await withRetry(async () => {
      const res = await fetch(textUrl!, {
        headers: {
          Accept: 'text/plain; charset=utf-8, text/plain',
          'User-Agent': 'NightPlanner-MoonAI/1.0',
        },
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) {
        throw Object.assign(new Error(`Failed to fetch book text: HTTP ${res.status}`), { status: res.status });
      }

      const contentType = res.headers.get('content-type') || '';
      // Ensure we didn't receive HTML or JSON error page
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        throw new Error(`Resource returned ${contentType} instead of plain text.`);
      }

      const text = await res.text();
      return text;
    });

    if (!rawText || rawText.trim().length === 0) return null;

    let processedText = rawText;
    if (options.skipHeaders !== false) {
      // Strip Project Gutenberg standard header markers if present
      const startMarker = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\*]*\*\*\*/i;
      const matchStart = processedText.match(startMarker);
      if (matchStart && matchStart.index !== undefined) {
        processedText = processedText.slice(matchStart.index + matchStart[0].length).trim();
      }

      // Strip Project Gutenberg standard footer markers if present
      const endMarker = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\*]*\*\*\*/i;
      const matchEnd = processedText.match(endMarker);
      if (matchEnd && matchEnd.index !== undefined) {
        processedText = processedText.slice(0, matchEnd.index).trim();
      }
    }

    const truncated = processedText.length > maxBytes;
    const finalContent = truncated ? processedText.slice(0, maxBytes) : processedText;

    const extract: GutenbergTextExtract = {
      bookId,
      title: bookTitle,
      sourceUrl: textUrl,
      text: finalContent,
      byteCount: finalContent.length,
      truncated,
      attribution: 'Source: Project Gutenberg (Public Domain)',
    };

    externalSourceCaches.gutendex.set(cacheKey, extract);
    return extract;
  } catch (err: any) {
    console.warn(`[Gutendex] Failed to retrieve text from "${textUrl}":`, err.message);
    return null;
  }
}
