/**
 * Wikipedia API Service (https://en.wikipedia.org/w/api.php)
 *
 * Implements:
 * 1. Biographical facts extraction and source URL retrieval.
 * 2. Proper User-Agent header compliance per Wikimedia Foundation policy.
 * 3. Attribution preservation: "Source: Wikipedia (CC BY-SA 4.0)".
 * 4. Safe parsing, deduplication, error isolation, and TTL caching.
 */

import { externalSourceCaches, withRetry, normalizeQuery } from './cache';

export interface WikipediaArticle {
  pageId: number;
  title: string;
  extract: string;
  sourceUrl: string;
  attribution: string;
}

export interface BiographicalFacts {
  subject: string;
  title: string;
  sourceUrl: string;
  attribution: string;
  summary: string;
  facts: string[];
}

const WIKIPEDIA_API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
const DEFAULT_USER_AGENT = 'NightPlanner-MoonAI/1.0 (https://your-backend-app.onrender.com; contact@nightplanner.internal)';

export function getWikipediaUserAgent(): string {
  const envAgent = process.env.WIKIPEDIA_USER_AGENT?.trim();
  return envAgent || DEFAULT_USER_AGENT;
}

/**
 * Searches Wikipedia for relevant article titles matching a query.
 */
export async function searchWikipedia(query: string, limit = 5): Promise<Array<{ title: string; snippet: string }>> {
  const clean = normalizeQuery(query);
  if (!clean) return [];

  const cacheKey = `search:${clean}:${limit}`;
  const cached = externalSourceCaches.wikipedia.get(cacheKey) as Array<{ title: string; snippet: string }> | undefined;
  if (cached) return cached;

  const userAgent = getWikipediaUserAgent();
  const url = new URL(WIKIPEDIA_API_ENDPOINT);
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
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw Object.assign(new Error(`Wikipedia API error: HTTP ${res.status}`), { status: res.status });
      }
      return res.json();
    });

    const searchResults = (data?.query?.search || []).map((item: any) => ({
      title: String(item.title || '').trim(),
      snippet: String(item.snippet || '').replace(/<[^>]+>/g, '').trim(),
    })).filter((item: any) => item.title.length > 0);

    externalSourceCaches.wikipedia.set(cacheKey, searchResults);
    return searchResults;
  } catch (err: any) {
    console.warn(`[Wikipedia] Search failed for "${query}":`, err.message);
    return [];
  }
}

/**
 * Retrieves the introductory extract and canonical source URL for a Wikipedia page title.
 */
export async function getWikipediaPage(title: string): Promise<WikipediaArticle | null> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return null;

  const cacheKey = `page:${cleanTitle.toLowerCase()}`;
  const cached = externalSourceCaches.wikipedia.get(cacheKey) as WikipediaArticle | undefined;
  if (cached) return cached;

  const userAgent = getWikipediaUserAgent();
  const url = new URL(WIKIPEDIA_API_ENDPOINT);
  url.searchParams.set('action', 'query');
  url.searchParams.set('prop', 'extracts|info');
  url.searchParams.set('exintro', '1');
  url.searchParams.set('explaintext', '1');
  url.searchParams.set('inprop', 'url');
  url.searchParams.set('titles', cleanTitle);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  try {
    const data = await withRetry(async () => {
      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw Object.assign(new Error(`Wikipedia API error: HTTP ${res.status}`), { status: res.status });
      }
      return res.json();
    });

    const pages = data?.query?.pages || {};
    const pageId = Object.keys(pages)[0];
    if (!pageId || pageId === '-1') return null;

    const page = pages[pageId];
    const extract = String(page.extract || '').trim();
    if (!extract) return null;

    const canonicalUrl = page.canonicalurl || page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(cleanTitle.replace(/\s+/g, '_'))}`;

    const result: WikipediaArticle = {
      pageId: Number(pageId),
      title: page.title || cleanTitle,
      extract,
      sourceUrl: canonicalUrl,
      attribution: 'Source: Wikipedia (CC BY-SA 4.0)',
    };

    externalSourceCaches.wikipedia.set(cacheKey, result);
    return result;
  } catch (err: any) {
    console.warn(`[Wikipedia] Page fetch failed for "${title}":`, err.message);
    return null;
  }
}

/**
 * Extracts key biographical facts and historical context for an author or subject.
 */
export async function getBiographicalFacts(authorOrSubject: string): Promise<BiographicalFacts | null> {
  const clean = normalizeQuery(authorOrSubject);
  if (!clean) return null;

  // Direct lookup first
  let article = await getWikipediaPage(clean);

  // If not found directly, search for the best match
  if (!article) {
    const results = await searchWikipedia(clean, 3);
    if (results.length > 0) {
      article = await getWikipediaPage(results[0].title);
    }
  }

  if (!article || !article.extract) return null;

  // Split extract into distinct factual sentences, avoiding splitting on initials or abbreviations
  const protectedExtract = article.extract.replace(/\b([A-Z]|Dr|Mr|Mrs|Prof|Jr|Sr|vs|etc)\./g, (_, p1) => `${p1}\uE002`);
  const sentences = protectedExtract
    .split(/(?<=[.!?])\s+/)
    .map(s => s.replace(/\uE002/g, '.').trim())
    .filter(s => s.length > 25 && !s.startsWith('==') && !s.includes('may refer to:'));

  const summary = sentences[0] || article.extract.slice(0, 300);
  // Pick up to 3 informative factual sentences following the lead summary
  const facts = sentences.slice(1, 4);

  return {
    subject: authorOrSubject,
    title: article.title,
    sourceUrl: article.sourceUrl,
    attribution: article.attribution,
    summary,
    facts,
  };
}
