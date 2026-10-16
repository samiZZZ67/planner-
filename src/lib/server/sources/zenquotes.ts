/**
 * ZenQuotes API Service (https://zenquotes.io/)
 *
 * Implements:
 * 1. Respects ZenQuotes rate limits (max 5 requests per 30 seconds on free tier).
 * 2. Caches responses aggressively (TTL >= 2 hours) to avoid rate limit throttling.
 * 3. Enforces required link-back attribution: "Inspirational quotes provided by ZenQuotes (https://zenquotes.io/)".
 * 4. Supports ZENQUOTES_API_KEY if configured on Render.
 */

import { externalSourceCaches, withRetry, normalizeQuery, deduplicateBy } from './cache';

export interface ZenQuoteItem {
  quote: string;
  author: string;
  attribution: string;
  sourceUrl: string;
}

const ZENQUOTES_BASE_URL = 'https://zenquotes.io/api';
const ZENQUOTES_ATTRIBUTION = 'Inspirational quotes provided by ZenQuotes (https://zenquotes.io/)';

export function getZenQuotesApiKey(): string | undefined {
  return process.env.ZENQUOTES_API_KEY?.trim() || undefined;
}

/**
 * Fetches quotes from ZenQuotes respecting rate limits, caching, and required attribution.
 */
export async function getZenQuotes(options: {
  keyword?: string;
  author?: string;
  limit?: number;
  mode?: 'quotes' | 'today' | 'random';
} = {}): Promise<ZenQuoteItem[]> {
  const mode = options.mode || 'quotes';
  const apiKey = getZenQuotesApiKey();
  const limit = options.limit ?? 3;

  const cacheKey = `zenquotes:${mode}:${apiKey ? 'auth' : 'free'}`;
  let rawQuotes = externalSourceCaches.zenquotes.get(cacheKey) as Array<{ q: string; a: string }> | undefined;

  if (!rawQuotes) {
    let endpoint = `${ZENQUOTES_BASE_URL}/${mode}`;
    if (apiKey) {
      endpoint = `${ZENQUOTES_BASE_URL}/${mode}/${apiKey}`;
    }

    try {
      const data = await withRetry(async () => {
        const res = await fetch(endpoint, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'NightPlanner-MoonAI/1.0',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) {
          throw Object.assign(new Error(`ZenQuotes API error: HTTP ${res.status}`), { status: res.status });
        }

        const json = await res.json();
        return Array.isArray(json) ? json : [];
      });

      // Filter out ZenQuotes error / rate limit warning messages
      // ZenQuotes returns [{"q": "Too many requests. Obtain an auth key...", "a": "zenquotes.io"}] when rate limited
      rawQuotes = data.filter((item: any) => {
        const text = String(item?.q || '');
        return text && !text.includes('Too many requests') && !text.includes('zenquotes.io');
      });

      if (rawQuotes && rawQuotes.length > 0) {
        externalSourceCaches.zenquotes.set(cacheKey, rawQuotes, 2 * 60 * 60 * 1000); // Cache 2 hours
      }
    } catch (err: any) {
      console.warn('[ZenQuotes] Fetch failed:', err.message);
      return [];
    }
  }

  if (!rawQuotes || rawQuotes.length === 0) return [];

  let candidates = rawQuotes;

  // Filter by author if requested
  if (options.author) {
    const authorLower = options.author.toLowerCase();
    const authorMatches = candidates.filter(item => item.a?.toLowerCase().includes(authorLower));
    if (authorMatches.length > 0) {
      candidates = authorMatches;
    }
  }

  // Filter by keyword if requested
  if (options.keyword) {
    const kwLower = options.keyword.toLowerCase();
    const kwMatches = candidates.filter(item => item.q?.toLowerCase().includes(kwLower));
    if (kwMatches.length > 0) {
      candidates = kwMatches;
    }
  }

  const mapped: ZenQuoteItem[] = candidates.map(item => ({
    quote: String(item.q).trim(),
    author: String(item.a || 'Unknown').trim(),
    attribution: ZENQUOTES_ATTRIBUTION,
    sourceUrl: 'https://zenquotes.io/',
  }));

  const deduplicated = deduplicateBy(mapped, q => q.quote.toLowerCase());
  return deduplicated.slice(0, limit);
}
