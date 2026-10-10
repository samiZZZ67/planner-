import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/server/auth';

export async function POST() {
  const response = NextResponse.json({ ok: true, message: 'Logged out successfully.' });
  const isCrossDomain = Boolean(process.env.CLIENT_URL);
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || isCrossDomain,
    sameSite: isCrossDomain ? 'none' : 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
