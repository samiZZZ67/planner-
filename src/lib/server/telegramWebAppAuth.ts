import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifiedTelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface VerifiedTelegramWebAppInitData {
  authDate: number;
  user: VerifiedTelegramWebAppUser;
}

const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
const ALLOWED_FUTURE_SKEW_SECONDS = 60;

/** Verify Telegram Web App initData before trusting its user object. */
export function validateTelegramWebAppInitData(
  initData: string,
  botToken: string,
  nowMs = Date.now(),
): VerifiedTelegramWebAppInitData | null {
  if (!initData || initData.length > 16_384 || !botToken) return null;

  const entries = Array.from(new URLSearchParams(initData).entries());
  if (entries.length === 0) return null;

  const keys = new Set<string>();
  for (const [key] of entries) {
    if (keys.has(key)) return null;
    keys.add(key);
  }

  const receivedHash = new URLSearchParams(initData).get('hash');
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return null;

  const dataCheckString = entries
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const actualHash = Buffer.from(receivedHash, 'hex');
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) return null;

  const params = new URLSearchParams(initData);
  const authDate = Number(params.get('auth_date'));
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return null;
  if (authDate > nowSeconds + ALLOWED_FUTURE_SKEW_SECONDS) return null;
  if (nowSeconds - authDate > MAX_INIT_DATA_AGE_SECONDS) return null;

  const rawUser = params.get('user');
  if (!rawUser) return null;

  try {
    const user = JSON.parse(rawUser) as VerifiedTelegramWebAppUser;
    if (!Number.isSafeInteger(user?.id) || user.id <= 0 || typeof user.first_name !== 'string') return null;
    return { authDate, user };
  } catch {
    return null;
  }
}
