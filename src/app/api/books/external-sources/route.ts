import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import {
  searchWikipedia,
  getBiographicalFacts,
  getWikipediaUserAgent,
} from '@/lib/server/sources/wikipedia';
import {
  searchGutendex,
  getGutenbergBook,
  fetchGutenbergBookText,
} from '@/lib/server/sources/gutendex';
import {
  searchWikiquote,
  getWikiquoteQuotes,
} from '@/lib/server/sources/wikiquote';
import {
  getZenQuotes,
  getZenQuotesApiKey,
} from '@/lib/server/sources/zenquotes';
import {
  isYouTubeConfigured,
  searchYouTubeVideos,
} from '@/lib/server/sources/youtube';
import {
  isPodcastIndexConfigured,
  searchPodcastEpisodes,
} from '@/lib/server/sources/podcastIndex';

/**
 * GET: Returns configuration status for all external sources without exposing secrets.
 */
export async function GET(request: Request) {
  const session = await getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  return NextResponse.json({
    wikipedia: {
      enabled: true,
      requiresAuth: false,
      userAgentConfigured: Boolean(process.env.WIKIPEDIA_USER_AGENT),
      userAgent: getWikipediaUserAgent(),
    },
    gutendex: {
      enabled: true,
      requiresAuth: false,
    },
    wikiquote: {
      enabled: true,
      requiresAuth: false,
    },
    zenquotes: {
      enabled: true,
      requiresAuth: false,
      apiKeyConfigured: Boolean(getZenQuotesApiKey()),
    },
    youtube: {
      enabled: isYouTubeConfigured(),
      requiresAuth: true,
      configured: isYouTubeConfigured(),
      warning: !isYouTubeConfigured() ? 'YOUTUBE_API_KEY is not configured on Render.' : undefined,
    },
    podcastIndex: {
      enabled: isPodcastIndexConfigured(),
      requiresAuth: true,
      configured: isPodcastIndexConfigured(),
      warning: !isPodcastIndexConfigured() ? 'PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET are not configured on Render.' : undefined,
    },
  });
}

/**
 * POST: Test queries against external providers independently.
 */
export async function POST(request: Request) {
  const session = await getSessionUser(request);
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const source = String(body?.source || '').toLowerCase();
  const query = String(body?.query || '').trim();

  if (!source) {
    return NextResponse.json({ error: 'Field "source" is required (wikipedia, gutendex, wikiquote, zenquotes, youtube, podcast_index).' }, { status: 400 });
  }

  try {
    switch (source) {
      case 'wikipedia': {
        const facts = query ? await getBiographicalFacts(query) : null;
        const search = query ? await searchWikipedia(query, 3) : [];
        return NextResponse.json({ ok: true, source, facts, search });
      }
      case 'gutendex': {
        if (!query) return NextResponse.json({ error: 'Query is required for gutendex search.' }, { status: 400 });
        const books = await searchGutendex(query, 3);
        let sampleExtract: any = null;
        if (body.fetchText && books.length > 0 && books[0].availableFormats.plainTextUrl) {
          sampleExtract = await fetchGutenbergBookText(books[0], { maxBytes: 5000 });
        }
        return NextResponse.json({ ok: true, source, books, sampleExtract });
      }
      case 'wikiquote': {
        const quotes = query ? await getWikiquoteQuotes(query, 3) : [];
        return NextResponse.json({ ok: true, source, quotes });
      }
      case 'zenquotes': {
        const quotes = await getZenQuotes({ keyword: query || undefined, limit: 3 });
        return NextResponse.json({ ok: true, source, quotes });
      }
      case 'youtube': {
        if (!isYouTubeConfigured()) {
          return NextResponse.json({
            ok: false,
            source,
            configured: false,
            warning: 'YOUTUBE_API_KEY is not configured on Render.',
            videos: [],
          });
        }
        const result = await searchYouTubeVideos(query || 'Productivity', { maxResults: 3 });
        return NextResponse.json({ ok: true, source, ...result });
      }
      case 'podcast_index':
      case 'podcastindex': {
        if (!isPodcastIndexConfigured()) {
          return NextResponse.json({
            ok: false,
            source,
            configured: false,
            warning: 'PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET are not configured on Render.',
            podcasts: [],
          });
        }
        const result = await searchPodcastEpisodes(query || 'Productivity', { maxResults: 3 });
        return NextResponse.json({ ok: true, source, ...result });
      }
      default:
        return NextResponse.json({ error: `Unknown source "${source}". Supported: wikipedia, gutendex, wikiquote, zenquotes, youtube, podcast_index.` }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'External source query failed.' }, { status: 500 });
  }
}
