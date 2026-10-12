import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSessionToken,
  getSessionUser,
  verifySession,
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
} from './auth';

describe('Authoritative Master Password Auth System', () => {
  beforeEach(() => {
    clearRateLimit('127.0.0.1');
    clearRateLimit('192.168.1.100');
  });

  it('should generate a valid HMAC-SHA256 session token', async () => {
    const token = await createSessionToken('owner');
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.includes('.')).toBe(true);
  });

  it('should successfully verify token from Bearer authorization header', async () => {
    const token = await createSessionToken('owner');
    const fakeReq = {
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'authorization') return `Bearer ${token}`;
          return null;
        },
      },
    };

    const user = await getSessionUser(fakeReq);
    expect(user).not.toBeNull();
    expect(user?.authenticated).toBe(true);
    expect(user?.userId).toBe('owner');
    expect(user?.expiresAt).toBeGreaterThan(Date.now());

    const isValid = await verifySession(fakeReq);
    expect(isValid).toBe(true);
  });

  it('should reject tampered tokens', async () => {
    const token = await createSessionToken('owner');
    const tampered = token.slice(0, -4) + 'abcd';
    const fakeReq = {
      headers: {
        get: (name: string) => (name.toLowerCase() === 'authorization' ? `Bearer ${tampered}` : null),
      },
    };

    const user = await getSessionUser(fakeReq);
    expect(user).toBeNull();

    const isValid = await verifySession(fakeReq);
    expect(isValid).toBe(false);
  });

  it('should rate limit repeated failed attempts', () => {
    const ip = '192.168.1.100';
    expect(checkRateLimit(ip).allowed).toBe(true);

    // Fail 5 times
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(ip);
    }

    const status = checkRateLimit(ip);
    expect(status.allowed).toBe(false);
    expect(status.retryAfterMs).toBeGreaterThan(0);

    // Clear rate limit
    clearRateLimit(ip);
    expect(checkRateLimit(ip).allowed).toBe(true);
  });
});
