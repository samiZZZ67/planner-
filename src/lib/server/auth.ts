import { cookies } from 'next/headers';

const SESSION_COOKIE_NAME = 'np_session';
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

// In-memory rate limiting fallback cache
const memoryAttempts = new Map<string, { count: number; blockedUntil: number; lastAttempt: number }>();

function getSecretKey(): string {
  return process.env.SESSION_SECRET || 'default-night-planner-fallback-secret-key-32chars';
}

/**
 * Sign data using Web Crypto HMAC-SHA256
 */
async function sign(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  const hashArray = Array.from(new Uint8Array(signature));
  const hexSignature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${value}.${hexSignature}`;
}

/**
 * Verify HMAC-SHA256 signature
 */
async function verify(signedValue: string, secret: string): Promise<string | null> {
  const lastDot = signedValue.lastIndexOf('.');
  if (lastDot === -1) return null;
  const value = signedValue.slice(0, lastDot);
  const expectedSignature = await sign(value, secret);
  if (signedValue === expectedSignature) {
    return value;
  }
  return null;
}

/**
 * Check if IP is rate limited
 */
export function checkRateLimit(ip: string): { allowed: boolean; remainingAttempts: number; retryAfterMs: number } {
  const now = Date.now();
  const record = memoryAttempts.get(ip);

  if (!record) {
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS, retryAfterMs: 0 };
  }

  if (record.blockedUntil > now) {
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterMs: record.blockedUntil - now,
    };
  }

  // If outside rate limit window, reset
  if (now - record.lastAttempt > RATE_LIMIT_WINDOW_MS) {
    memoryAttempts.delete(ip);
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS, retryAfterMs: 0 };
  }

  return {
    allowed: record.count < MAX_ATTEMPTS,
    remainingAttempts: Math.max(0, MAX_ATTEMPTS - record.count),
    retryAfterMs: 0,
  };
}

/**
 * Record a failed login attempt
 */
export function recordFailedAttempt(ip: string): { remainingAttempts: number; blockedUntil: number } {
  const now = Date.now();
  const record = memoryAttempts.get(ip) || { count: 0, blockedUntil: 0, lastAttempt: now };

  record.count += 1;
  record.lastAttempt = now;

  if (record.count >= MAX_ATTEMPTS) {
    record.blockedUntil = now + RATE_LIMIT_WINDOW_MS;
  }

  memoryAttempts.set(ip, record);
  return {
    remainingAttempts: Math.max(0, MAX_ATTEMPTS - record.count),
    blockedUntil: record.blockedUntil,
  };
}

/**
 * Clear failed attempts after successful login
 */
export function clearRateLimit(ip: string): void {
  memoryAttempts.delete(ip);
}

/**
 * Create 90-day signed session token
 */
export async function createSessionToken(userId: string = 'owner'): Promise<string> {
  const payload = JSON.stringify({
    authenticated: true,
    userId,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000, // 90 days
  });
  return await sign(Buffer.from(payload).toString('base64url'), getSecretKey());
}

export interface SessionUser {
  authenticated: boolean;
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Retrieve verified session user from Next.js headers/request
 */
export async function getSessionUser(req?: Request | any): Promise<SessionUser | null> {
  try {
    let token: string | null = null;

    // 1. Check Authorization header or x-session-token (essential for cross-origin and mobile PWA)
    if (req && typeof req.headers?.get === 'function') {
      const authHeader = req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      }
      if (!token) {
        token = req.headers.get('x-session-token');
      }
    }

    // 2. Check httpOnly cookie if no header token was provided
    if (!token) {
      try {
        const cookieStore = await cookies();
        token = cookieStore.get(SESSION_COOKIE_NAME)?.value || null;
      } catch {
        // cookies() can throw outside Next request context
      }
    }

    if (!token) return null;

    const rawPayload = await verify(token, getSecretKey());
    if (!rawPayload) return null;

    const data = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8'));
    if (!data.authenticated || Date.now() > data.expiresAt) {
      return null;
    }
    return {
      authenticated: true,
      userId: data.userId || 'owner',
      issuedAt: data.issuedAt,
      expiresAt: data.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Verify session cookie from Next.js headers/request
 */
export async function verifySession(req?: Request | any): Promise<boolean> {
  const user = await getSessionUser(req);
  return Boolean(user && user.authenticated);
}

export { SESSION_COOKIE_NAME };

