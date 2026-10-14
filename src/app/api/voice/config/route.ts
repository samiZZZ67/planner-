import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getTTSConfig } from '@/lib/server/voice/synthesizer';

export async function GET(_request: NextRequest) {
  try {
    const config = getTTSConfig();
    return NextResponse.json(config);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Could not load voice configuration.' },
      { status: 500 }
    );
  }
}
