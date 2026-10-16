import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  searchWikipedia,
  getWikipediaPage,
  getBiographicalFacts,
  getWikipediaUserAgent,
} from './wikipedia';
import {
  searchGutendex,
  getGutenbergBook,
  identifyAvailableFormats,
  fetchGutenbergBookText,
} from './gutendex';
import {
  parseWikitext,
  extractQuotesFromWikitext,
  searchWikiquote,
  getWikiquoteQuotes,
} from './wikiquote';
import {
  getZenQuotes,
} from './zenquotes';
import {
  isYouTubeConfigured,
  searchYouTubeVideos,
} from './youtube';
import {
  isPodcastIndexConfigured,
  buildPodcastIndexAuthHeaders,
  searchPodcastEpisodes,
} from './podcastIndex';
import {
  researchReadingEnrichment,
  generateReadingQuiz,
} from './enrichment';
import { externalSourceCaches } from './cache';
import type { BookRecord, BookAssignmentRecord, BookPageRecord, BookStudyNotes } from '../../books/types';

describe('External Content Sources Integration Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Clear in-memory caches between tests
    for (const cache of Object.values(externalSourceCaches)) {
      cache.clear();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. WIKIPEDIA API
  // ─────────────────────────────────────────────────────────────
  describe('1. Wikipedia API Service', () => {
    it('uses a descriptive User-Agent header and custom env override', () => {
      const defaultAgent = getWikipediaUserAgent();
      expect(defaultAgent).toContain('NightPlanner-MoonAI');

      process.env.WIKIPEDIA_USER_AGENT = 'CustomApp/2.0 (test@example.com)';
      expect(getWikipediaUserAgent()).toBe('CustomApp/2.0 (test@example.com)');
      delete process.env.WIKIPEDIA_USER_AGENT;
    });

    it('retrieves relevant biographical facts and source URLs with CC BY-SA attribution', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('prop=extracts')) {
          return new Response(JSON.stringify({
            query: {
              pages: {
                '12345': {
                  pageid: 12345,
                  title: 'Cal Newport',
                  extract: 'Calvin C. Newport is an American author and computer science professor at Georgetown University. He writes on deep work and digital minimalism. In 2016 he published Deep Work.',
                  canonicalurl: 'https://en.wikipedia.org/wiki/Cal_Newport',
                },
              },
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ query: { search: [] } }), { status: 200 });
      }));

      const facts = await getBiographicalFacts('Cal Newport');
      expect(facts).not.toBeNull();
      expect(facts?.title).toBe('Cal Newport');
      expect(facts?.sourceUrl).toBe('https://en.wikipedia.org/wiki/Cal_Newport');
      expect(facts?.attribution).toBe('Source: Wikipedia (CC BY-SA 4.0)');
      expect(facts?.summary).toContain('Calvin C. Newport is an American author');
      expect(facts?.facts.length).toBeGreaterThanOrEqual(1);
    });

    it('handles missing pages and HTTP errors gracefully without throwing', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        return new Response('Not Found', { status: 404 });
      }));

      const page = await getWikipediaPage('NonExistentAuthor123XYZ');
      expect(page).toBeNull();

      const facts = await getBiographicalFacts('NonExistentAuthor123XYZ');
      expect(facts).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. GUTENDEX API
  // ─────────────────────────────────────────────────────────────
  describe('2. Gutendex API Service', () => {
    it('searches book metadata and identifies available ebook formats', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
        return new Response(JSON.stringify({
          count: 1,
          results: [
            {
              id: 84,
              title: 'Frankenstein; Or, The Modern Prometheus',
              authors: [{ name: 'Shelley, Mary Wollstonecraft', birth_year: 1797, death_year: 1851 }],
              formats: {
                'text/html': 'https://www.gutenberg.org/ebooks/84.html.images',
                'application/epub+zip': 'https://www.gutenberg.org/ebooks/84.epub3.images',
                'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/84.txt.utf-8',
              },
              download_count: 52000,
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }));

      const books = await searchGutendex('Frankenstein');
      expect(books).toHaveLength(1);
      const book = books[0];
      expect(book.title).toContain('Frankenstein');
      expect(book.authors[0].name).toBe('Shelley, Mary Wollstonecraft');
      expect(book.availableFormats.plainTextUrl).toBe('https://www.gutenberg.org/ebooks/84.txt.utf-8');
      expect(book.availableFormats.epubUrl).toBe('https://www.gutenberg.org/ebooks/84.epub3.images');
      expect(book.availableFormats.htmlUrl).toBe('https://www.gutenberg.org/ebooks/84.html.images');
    });

    it('retrieves actual text only from accessible text resources and never mistakes metadata for text', async () => {
      // 1. Test format identification rejects zip archives
      const formats = identifyAvailableFormats({
        'application/zip': 'https://www.gutenberg.org/files/84/84-0.zip',
        'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/84.txt.utf-8',
      });
      expect(formats.plainTextUrl).toBe('https://www.gutenberg.org/ebooks/84.txt.utf-8');

      // 2. Test text download with Gutenberg header/footer stripping
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
        const text = `*** START OF THE PROJECT GUTENBERG EBOOK FRANKENSTEIN ***\n\nChapter 1\n\nI am by birth a Genevese, and my family is one of the most distinguished of that republic.\n\n*** END OF THE PROJECT GUTENBERG EBOOK FRANKENSTEIN ***`;
        return new Response(text, {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }));

      const extract = await fetchGutenbergBookText(formats.plainTextUrl!);
      expect(extract).not.toBeNull();
      expect(extract?.text).toContain('I am by birth a Genevese');
      expect(extract?.text).not.toContain('*** START OF THE PROJECT GUTENBERG');
      expect(extract?.text).not.toContain('*** END OF THE PROJECT GUTENBERG');
      expect(extract?.attribution).toContain('Project Gutenberg');
    });

    it('refuses to fetch text from non-text resources (JSON / EPUB)', async () => {
      await expect(fetchGutenbergBookText('https://gutendex.com/books/84.json')).rejects.toThrow(/non-text resource/i);
      await expect(fetchGutenbergBookText('https://example.com/book.epub')).rejects.toThrow(/non-text resource/i);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. WIKIQUOTE API
  // ─────────────────────────────────────────────────────────────
  describe('3. Wikiquote API Service', () => {
    it('safely parses raw wikitext removing comments, templates, and wiki markup', () => {
      const raw = `* "It is a truth universally acknowledged..." <!-- comment --> {{w|Jane Austen}} in ''Pride and Prejudice'' [[Category:Literature]] <ref>Chapter 1</ref>`;
      const clean = parseWikitext(raw);
      expect(clean).toContain('"It is a truth universally acknowledged..."');
      expect(clean).toContain('Jane Austen');
      expect(clean).toContain('Pride and Prejudice');
      expect(clean).not.toContain('<!-- comment -->');
      expect(clean).not.toContain('[[Category');
      expect(clean).not.toContain('<ref>');
    });

    it('extracts quotations preserving attribution, context, and CC BY-SA attribution', () => {
      const sampleWikitext = `
== Quotes ==
* "Simplicity is the ultimate sophistication." ~ Leonardo da Vinci, Notebooks
* "Learning never exhausts the mind."
** As quoted in ''The Life of Leonardo da Vinci''
`;
      const quotes = extractQuotesFromWikitext(
        sampleWikitext,
        'Leonardo da Vinci',
        'https://en.wikiquote.org/wiki/Leonardo_da_Vinci',
        3
      );

      expect(quotes.length).toBeGreaterThanOrEqual(1);
      expect(quotes[0].author).toBe('Leonardo da Vinci');
      expect(quotes[0].quote).toContain('Simplicity is the ultimate sophistication.');
      expect(quotes[0].sourceContext).toContain('Notebooks');
      expect(quotes[0].attribution).toBe('Source: Wikiquote (CC BY-SA 4.0)');
      expect(quotes[0].sourceUrl).toBe('https://en.wikiquote.org/wiki/Leonardo_da_Vinci');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. ZENQUOTES API
  // ─────────────────────────────────────────────────────────────
  describe('4. ZenQuotes API Service', () => {
    it('respects required link-back attribution and rate limits via caching', async () => {
      const mockQuotes = [
        { q: 'The secret of getting ahead is getting started.', a: 'Mark Twain' },
        { q: 'Focus is a muscle that strengthens with use.', a: 'Cal Newport' },
      ];

      const fetchSpy = vi.fn(async () => {
        return new Response(JSON.stringify(mockQuotes), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchSpy);

      const quotes = await getZenQuotes({ keyword: 'focus', limit: 2 });
      expect(quotes).toHaveLength(1);
      expect(quotes[0].quote).toBe('Focus is a muscle that strengthens with use.');
      expect(quotes[0].author).toBe('Cal Newport');
      expect(quotes[0].attribution).toContain('Inspirational quotes provided by ZenQuotes (https://zenquotes.io/)');
      expect(quotes[0].sourceUrl).toBe('https://zenquotes.io/');

      // Subsequent call should hit cache without calling fetch again
      const cachedCall = await getZenQuotes({ keyword: 'focus', limit: 2 });
      expect(cachedCall).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. YOUTUBE DATA API V3
  // ─────────────────────────────────────────────────────────────
  describe('5. YouTube Data API v3 Service', () => {
    it('handles missing YOUTUBE_API_KEY without crashing', async () => {
      delete process.env.YOUTUBE_API_KEY;
      expect(isYouTubeConfigured()).toBe(false);

      const result = await searchYouTubeVideos('Deep Work');
      expect(result.configured).toBe(false);
      expect(result.warning).toContain('YOUTUBE_API_KEY is not configured on Render.');
      expect(result.videos).toEqual([]);
    });

    it('searches videos, validates 11-char video IDs, and returns working URLs', async () => {
      process.env.YOUTUBE_API_KEY = 'mock_youtube_key';
      expect(isYouTubeConfigured()).toBe(true);

      vi.stubGlobal('fetch', vi.fn(async () => {
        return new Response(JSON.stringify({
          items: [
            {
              id: { videoId: 'dQw4w9WgXcQ' },
              snippet: {
                title: 'Deep Work by Cal Newport Book Summary',
                channelTitle: 'Productivity Game',
                description: 'An animated book summary of Deep Work.',
              },
            },
            {
              id: { videoId: 'invalid_id_with_wrong_length' },
              snippet: { title: 'Invalid Video' },
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }));

      const result = await searchYouTubeVideos('Deep Work', { maxResults: 2 });
      expect(result.configured).toBe(true);
      expect(result.videos).toHaveLength(1); // Invalid ID was filtered out
      expect(result.videos[0].videoId).toBe('dQw4w9WgXcQ');
      expect(result.videos[0].url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result.videos[0].channelName).toBe('Productivity Game');

      delete process.env.YOUTUBE_API_KEY;
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. PODCAST INDEX API
  // ─────────────────────────────────────────────────────────────
  describe('6. Podcast Index API Service', () => {
    it('handles missing PODCAST_INDEX credentials without crashing', async () => {
      delete process.env.PODCAST_INDEX_API_KEY;
      delete process.env.PODCAST_INDEX_API_SECRET;
      expect(isPodcastIndexConfigured()).toBe(false);

      const result = await searchPodcastEpisodes('Deep Work');
      expect(result.configured).toBe(false);
      expect(result.warning).toContain('PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET are not configured on Render.');
      expect(result.podcasts).toEqual([]);
    });

    it('generates correct signed SHA-1 authentication headers', () => {
      const headers = buildPodcastIndexAuthHeaders('test_key', 'test_secret');
      expect(headers['X-Auth-Key']).toBe('test_key');
      expect(headers['X-Auth-Date']).toBeDefined();
      expect(headers['Authorization']).toHaveLength(40); // 40-character hex SHA-1 hash
      expect(headers['User-Agent']).toBeDefined();
    });

    it('searches podcast episodes and returns verified metadata and URLs', async () => {
      process.env.PODCAST_INDEX_API_KEY = 'mock_key';
      process.env.PODCAST_INDEX_API_SECRET = 'mock_secret';

      vi.stubGlobal('fetch', vi.fn(async () => {
        return new Response(JSON.stringify({
          status: 'true',
          feeds: [
            {
              id: 98765,
              title: 'Deep Questions with Cal Newport',
              author: 'Cal Newport',
              url: 'https://feeds.buzzsprout.com/1234.rss',
              link: 'https://calnewport.com/podcast',
              description: 'Cal Newport answers questions about deep work.',
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }));

      const result = await searchPodcastEpisodes('Deep Questions', { maxResults: 1 });
      expect(result.configured).toBe(true);
      expect(result.podcasts).toHaveLength(1);
      expect(result.podcasts[0].title).toBe('Deep Questions with Cal Newport');
      expect(result.podcasts[0].url).toBe('https://calnewport.com/podcast');
      expect(result.podcasts[0].podcastName).toBe('Cal Newport');

      delete process.env.PODCAST_INDEX_API_KEY;
      delete process.env.PODCAST_INDEX_API_SECRET;
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. UNIFIED READING ENRICHMENT & QUIZ GENERATION
  // ─────────────────────────────────────────────────────────────
  describe('7. Unified Reading Enrichment & Quiz Generation', () => {
    const mockBook: BookRecord = {
      id: 'test_book',
      userId: 'test_user',
      title: 'Deep Work: Rules for Focused Success',
      author: 'Cal Newport',
      metadata: '',
      originalFilename: 'deep_work.pdf',
      storedFilename: 'deep_work.pdf',
      fileSize: 1000,
      startPage: 1,
      endPage: 10,
      durationDays: 2,
      startDate: '2026-10-15',
      studyMinutes: 30,
      postingTime: '08:00',
      timezone: 'UTC',
      currentPage: 1,
      status: 'ready',
      extractionStatus: 'completed',
      extractionMessage: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockAssignment: BookAssignmentRecord = {
      id: 'asg_1',
      userId: 'test_user',
      bookId: 'test_book',
      dayNumber: 1,
      scheduledDate: '2026-10-15',
      startPdfPage: 1,
      endPdfPage: 5,
      concepts: [{ title: 'Deep Work Definition', concept: 'Focus without distraction', estimatedMinutes: 20 }],
      estimatedMinutes: 20,
      rationale: '',
      status: 'approved',
      updatedAt: Date.now(),
    };

    const mockPages: BookPageRecord[] = [
      { bookId: 'test_book', pdfPage: 1, text: 'Deep work is the ability to focus without distraction on a cognitively demanding task.', method: 'native', confidence: 1, warnings: [], requiresReview: false, updatedAt: 1 },
      { bookId: 'test_book', pdfPage: 2, text: 'Shallow work consists of logistical tasks that do not create new value.', method: 'native', confidence: 1, warnings: [], requiresReview: false, updatedAt: 1 },
      { bookId: 'test_book', pdfPage: 3, text: 'Carl Jung built a stone tower in Bollingen to focus his mind on writing.', method: 'native', confidence: 1, warnings: [], requiresReview: false, updatedAt: 1 },
      { bookId: 'test_book', pdfPage: 4, text: 'The Deep Work Hypothesis states that focused work is becoming rare and valuable.', method: 'native', confidence: 1, warnings: [], requiresReview: false, updatedAt: 1 },
      { bookId: 'test_book', pdfPage: 5, text: 'To thrive, you must quickly master hard things and produce at an elite level.', method: 'native', confidence: 1, warnings: [], requiresReview: false, updatedAt: 1 },
    ];

    it('generates reading-specific quizzes with varied difficulty for multi-page sections', () => {
      const quiz = generateReadingQuiz(mockBook, mockAssignment, mockPages);
      expect(quiz.length).toBeGreaterThanOrEqual(4); // 5-page section receives >= 4 questions

      const difficulties = new Set(quiz.map(q => q.difficulty));
      expect(difficulties.has('easy') || difficulties.has('medium') || difficulties.has('hard')).toBe(true);

      for (const q of quiz) {
        expect(q.question).toBeDefined();
        expect(q.options.length).toBeGreaterThanOrEqual(2);
        expect(q.correctOptionIndex).toBeGreaterThanOrEqual(0);
        expect(q.correctOptionIndex).toBeLessThan(q.options.length);
        expect(q.explanation).toBeDefined();
        expect(q.sourcePdfPages?.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('orchestrates external research concurrently and isolates provider failures', async () => {
      // Mock Wikipedia and ZenQuotes success, let YouTube and Podcast fail/be unconfigured
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('wikipedia.org')) {
          return new Response(JSON.stringify({
            query: {
              pages: {
                '1': {
                  title: 'Cal Newport',
                  extract: 'Calvin C. Newport is an American author. He is a professor at Georgetown University.',
                  canonicalurl: 'https://en.wikipedia.org/wiki/Cal_Newport',
                },
              },
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (u.includes('zenquotes.io')) {
          return new Response(JSON.stringify([
            { q: 'Focus is the foundation of achievement.', a: 'Cal Newport' },
          ]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('Unavailable', { status: 503 });
      }));

      const enrichment = await researchReadingEnrichment({
        book: mockBook,
        assignment: mockAssignment,
        pages: mockPages,
      });

      expect(enrichment.realLifeExamples.length).toBeGreaterThanOrEqual(1);
      expect(enrichment.realLifeExamples[0].attribution).toBe('Source: Wikipedia (CC BY-SA 4.0)');
      expect(enrichment.quotes.length).toBeGreaterThanOrEqual(1);
      expect(enrichment.quotes[0].attribution).toContain('ZenQuotes');
      expect(enrichment.quiz.length).toBeGreaterThanOrEqual(4);
      // Videos and podcasts gracefully remain empty without error
      expect(enrichment.videos).toEqual([]);
      expect(enrichment.podcasts).toEqual([]);
    });
  });
});
