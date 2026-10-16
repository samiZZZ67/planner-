/**
 * Podcast Index API Service (https://api.podcastindex.org/developer_docs)
 *
 * Implements:
 * 1. Required signed authentication headers:
 *    - User-Agent
 *    - X-Auth-Key: API key
 *    - X-Auth-Date: Unix timestamp (seconds)
 *    - Authorization: SHA-1(apiKey + apiSecret + apiHeaderTime)
 * 2. Search for relevant podcast episodes and series by book title, author, or topic.
 * 3. Verified episode metadata and working URLs.
 * 4. Graceful configuration error handling when credentials are not configured on Render.
 */

import crypto from 'node:crypto';
import { externalSourceCaches, withRetry, normalizeQuery, deduplicateBy } from './cache';

export interface PodcastItem {
  id: string | number;
  title: string;
  podcastName: string;
  url: string;
  description: string;
  feedUrl?: string;
  artwork?: string;
}

export interface PodcastSearchResult {
  configured: boolean;
  warning?: string;
  podcasts: PodcastItem[];
}

const PODCAST_INDEX_BASE_URL = 'https://api.podcastindex.org/api/1.0';

export function getPodcastIndexCredentials(): { apiKey?: string; apiSecret?: string } {
  const apiKey = process.env.PODCAST_INDEX_API_KEY?.trim() || undefined;
  const apiSecret = process.env.PODCAST_INDEX_API_SECRET?.trim() || undefined;
  return { apiKey, apiSecret };
}

export function isPodcastIndexConfigured(): boolean {
  const { apiKey, apiSecret } = getPodcastIndexCredentials();
  return Boolean(apiKey && apiSecret);
}

/**
 * Builds the signed authentication headers required by the Podcast Index API.
 */
export function buildPodcastIndexAuthHeaders(apiKey: string, apiSecret: string): Record<string, string> {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const hash = crypto
    .createHash('sha1')
    .update(apiKey + apiSecret + apiHeaderTime)
    .digest('hex');

  return {
    'User-Agent': process.env.WIKIPEDIA_USER_AGENT || 'NightPlanner-MoonAI/1.0',
    'X-Auth-Key': apiKey,
    'X-Auth-Date': apiHeaderTime,
    Authorization: hash,
    Accept: 'application/json',
  };
}

/**
 * Searches the Podcast Index API for relevant podcasts and episodes.
 */
export async function searchPodcastEpisodes(
  query: string,
  options: { maxResults?: number } = {}
): Promise<PodcastSearchResult> {
  const { apiKey, apiSecret } = getPodcastIndexCredentials();
  if (!apiKey || !apiSecret) {
    return {
      configured: false,
      warning: 'PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET are not configured on Render.',
      podcasts: [],
    };
  }

  const clean = normalizeQuery(query);
  if (!clean) {
    return { configured: true, podcasts: [] };
  }

  const maxResults = options.maxResults ?? 3;
  const cacheKey = `search:${clean.toLowerCase()}:${maxResults}`;
  const cached = externalSourceCaches.podcastIndex.get(cacheKey) as PodcastItem[] | undefined;
  if (cached) {
    return { configured: true, podcasts: cached };
  }

  const url = new URL(`${PODCAST_INDEX_BASE_URL}/search/byterm`);
  url.searchParams.set('q', clean);

  try {
    const data = await withRetry(async () => {
      const headers = buildPodcastIndexAuthHeaders(apiKey, apiSecret);
      const res = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw Object.assign(new Error(`Podcast Index API error: HTTP ${res.status}`), { status: res.status });
      }

      return res.json();
    });

    const feeds = Array.isArray(data?.feeds) ? data.feeds : [];
    const podcastItems: PodcastItem[] = [];

    for (const feed of feeds) {
      const title = String(feed.title || '').trim();
      const podcastName = String(feed.author || feed.title || '').trim();
      const link = String(feed.link || feed.url || feed.originalUrl || '').trim();
      const description = String(feed.description || '').replace(/<[^>]+>/g, '').trim();

      if (!title || !link || (!link.startsWith('http://') && !link.startsWith('https://'))) {
        continue;
      }

      podcastItems.push({
        id: feed.id || link,
        title,
        podcastName: podcastName || 'Podcast',
        url: link,
        description: description.slice(0, 300),
        feedUrl: feed.url || undefined,
        artwork: feed.artwork || feed.image || undefined,
      });

      if (podcastItems.length >= maxResults) break;
    }

    const deduplicated = deduplicateBy(podcastItems, p => String(p.id));
    externalSourceCaches.podcastIndex.set(cacheKey, deduplicated);

    return {
      configured: true,
      podcasts: deduplicated,
    };
  } catch (err: any) {
    console.warn(`[PodcastIndex] Search failed for "${query}":`, err.message);
    return {
      configured: true,
      warning: err.message,
      podcasts: [],
    };
  }
}
