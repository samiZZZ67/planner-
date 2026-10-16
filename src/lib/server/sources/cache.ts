/**
 * Bounded TTL Cache and Retry Utility for External Content Sources
 *
 * Provides:
 * 1. Safe in-memory caching with Time-To-Live (TTL) to respect third-party rate limits and quotas.
 * 2. Automatic cache eviction to prevent memory leaks in long-running Render processes.
 * 3. Bounded exponential-backoff retries for transient HTTP errors (5xx, 429) and network timeouts.
 * 4. Safe query string normalization and deduplication helpers.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class BoundedTtlCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(defaultTtlMs = 60 * 60 * 1000, maxEntries = 500) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    if (this.cache.size >= this.maxEntries) {
      // Evict oldest or expired keys
      const now = Date.now();
      let evictedCount = 0;
      for (const [k, v] of this.cache.entries()) {
        if (now > v.expiresAt || evictedCount < Math.floor(this.maxEntries * 0.2)) {
          this.cache.delete(k);
          evictedCount++;
        }
      }
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * Shared in-memory caches for each external source
 */
export const externalSourceCaches = {
  wikipedia: new BoundedTtlCache(24 * 60 * 60 * 1000, 300), // 24 hours
  gutendex: new BoundedTtlCache(12 * 60 * 60 * 1000, 200), // 12 hours
  wikiquote: new BoundedTtlCache(24 * 60 * 60 * 1000, 300), // 24 hours
  zenquotes: new BoundedTtlCache(2 * 60 * 60 * 1000, 100), // 2 hours (respect free rate limit)
  youtube: new BoundedTtlCache(24 * 60 * 60 * 1000, 500), // 24 hours (quota conservation)
  podcastIndex: new BoundedTtlCache(12 * 60 * 60 * 1000, 300), // 12 hours
};

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  timeoutMs?: number;
}

/**
 * Executes an async fetch operation with bounded exponential backoff retries.
 * Only retries on retryable errors (transient network failure, 5xx, or 429 rate limit).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const initialDelayMs = options.initialDelayMs ?? 400;
  const backoffFactor = options.backoffFactor ?? 2;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err: any) {
      lastError = err;
      const isLast = attempt === maxRetries;
      if (isLast) break;

      const isRateLimit = err?.status === 429 || /rate limit/i.test(err?.message || '');
      const isServerError = err?.status >= 500 && err?.status < 600;
      const isNetworkTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|econnreset|fetch failed/i.test(err?.message || '');

      // Do not retry 4xx errors other than 429
      if (err?.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err;
      }

      if (!isRateLimit && !isServerError && !isNetworkTimeout) {
        throw err;
      }

      const delay = initialDelayMs * Math.pow(backoffFactor, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Normalizes and sanitizes search queries to clean whitespace and avoid injection.
 */
export function normalizeQuery(query: string): string {
  if (!query) return '';
  return query
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-\.\'\,\:\;]/gi, '')
    .slice(0, 150);
}

/**
 * Deduplicates an array of objects based on a key extraction function.
 */
export function deduplicateBy<T, K>(items: T[], keyFn: (item: T) => K): T[] {
  const seen = new Set<K>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}
