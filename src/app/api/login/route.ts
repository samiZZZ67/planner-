import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, recordFailedAttempt, clearRateLimit, createSessionToken, SESSION_COOKIE_NAME } from '@/lib/server/auth';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
               req.headers.get('x-real-ip') || 
               '127.0.0.1';

    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      const waitMinutes = Math.ceil(rateCheck.retryAfterMs / (60 * 1000));
      return NextResponse.json(
        { error: `Too many wrong attempts. Please wait ${waitMinutes} minutes before trying again.` },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { password } = body;
    const expectedPassword = process.env.APP_PASSWORD || 'sami@0334';

    if (!expectedPassword) {
      return NextResponse.json(
        { error: 'Server authentication is not configured (APP_PASSWORD missing).' },
        { status: 500 }
      );
    }

    if (!password || password !== expectedPassword) {
      const failInfo = recordFailedAttempt(ip);
      const remainingMsg = failInfo.remainingAttempts > 0 
        ? `${failInfo.remainingAttempts} attempts remaining.`
        : 'Account locked for 15 minutes.';
      return NextResponse.json(
        { error: `Invalid password. ${remainingMsg}` },
        { status: 401 }
      );
    }

    // Success: clear rate limit & generate 90-day session cookie
    clearRateLimit(ip);
    const token = await createSessionToken();

    const response = NextResponse.json({
      ok: true,
      token,
      message: 'Logged in successfully.',
    });

    const isCrossDomain = Boolean(process.env.CLIENT_URL);
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || isCrossDomain,
      sameSite: isCrossDomain ? 'none' : 'lax',
      path: '/',
      maxAge: 90 * 24 * 60 * 60, // 90 days
    });

    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
