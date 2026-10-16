/**
 * YouTube Data API v3 Service (https://developers.google.com/youtube/v3)
 *
 * Implements:
 * 1. Searching for relevant videos by book title, author, or educational topic.
 * 2. Strict video ID validation (^[a-zA-Z0-9_-]{11}$) and working URL generation.
 * 3. Quota-conscious TTL caching (24 hours) to preserve the daily Google API quota.
 * 4. Graceful handling when YOUTUBE_API_KEY is missing or when quota is exceeded.
 */

import { externalSourceCaches, withRetry, normalizeQuery, deduplicateBy } from './cache';

export interface YouTubeVideoItem {
  videoId: string;
  title: string;
  channelName: string;
  url: string;
  description: string;
  publishedAt?: string;
}

export interface YouTubeSearchResult {
  configured: boolean;
  warning?: string;
  videos: YouTubeVideoItem[];
}

const YOUTUBE_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function getYouTubeApiKey(): string | undefined {
  return process.env.YOUTUBE_API_KEY?.trim() || undefined;
}

export function isYouTubeConfigured(): boolean {
  return Boolean(getYouTubeApiKey());
}

/**
 * Searches YouTube Data API v3 for relevant educational videos.
 * Returns valid video IDs, titles, channel names, and verified links.
 */
export async function searchYouTubeVideos(
  query: string,
  options: { maxResults?: number } = {}
): Promise<YouTubeSearchResult> {
  const apiKey = getYouTubeApiKey();
  if (!apiKey) {
    return {
      configured: false,
      warning: 'YOUTUBE_API_KEY is not configured on Render.',
      videos: [],
    };
  }

  const clean = normalizeQuery(query);
  if (!clean) {
    return { configured: true, videos: [] };
  }

  const maxResults = options.maxResults ?? 3;
  const cacheKey = `search:${clean.toLowerCase()}:${maxResults}`;
  const cached = externalSourceCaches.youtube.get(cacheKey) as YouTubeVideoItem[] | undefined;
  if (cached) {
    return { configured: true, videos: cached };
  }

  const url = new URL(YOUTUBE_SEARCH_ENDPOINT);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('q', clean);
  url.searchParams.set('key', apiKey);

  try {
    const data = await withRetry(async () => {
      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        const errMsg = errorBody?.error?.message || `HTTP ${res.status}`;
        throw Object.assign(new Error(`YouTube API error: ${errMsg}`), { status: res.status });
      }

      return res.json();
    });

    const items = Array.isArray(data?.items) ? data.items : [];
    const validVideos: YouTubeVideoItem[] = [];

    for (const item of items) {
      const videoId = String(item?.id?.videoId || '').trim();
      // Strictly validate videoId format to prevent fake or corrupted links
      if (!YOUTUBE_VIDEO_ID_REGEX.test(videoId)) continue;

      const snippet = item.snippet || {};
      const title = String(snippet.title || '').trim();
      const channelName = String(snippet.channelTitle || '').trim();
      const description = String(snippet.description || '').trim();

      if (!title) continue;

      validVideos.push({
        videoId,
        title,
        channelName: channelName || 'YouTube',
        url: `https://www.youtube.com/watch?v=${videoId}`,
        description,
        publishedAt: snippet.publishedAt,
      });
    }

    const deduplicated = deduplicateBy(validVideos, v => v.videoId);
    externalSourceCaches.youtube.set(cacheKey, deduplicated);

    return {
      configured: true,
      videos: deduplicated,
    };
  } catch (err: any) {
    console.warn(`[YouTube] Search failed for "${query}":`, err.message);
    return {
      configured: true,
      warning: err.message,
      videos: [],
    };
  }
}
