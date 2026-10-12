import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user || !user.authenticated) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    return NextResponse.json({
      authenticated: true,
      userId: user.userId,
      expiresAt: user.expiresAt,
    });
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
