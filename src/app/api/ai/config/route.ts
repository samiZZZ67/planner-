import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/server/auth';
import { getAIProvidersStatus, saveStoredAIConfig } from '@/lib/server/ai/providers';

export async function GET(req: NextRequest) {
  try {
    const isAuth = await verifySession(req);
    if (!isAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const status = getAIProvidersStatus();
    return NextResponse.json(status);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch AI status' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const isAuth = await verifySession(req);
    if (!isAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const updated = saveStoredAIConfig({
      activeProviderId: body.activeProviderId,
      fallbackEnabled: body.fallbackEnabled,
      modelOverrides: body.modelOverrides,
    });

    return NextResponse.json({
      ok: true,
      config: updated,
      status: getAIProvidersStatus(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update AI config' }, { status: 500 });
  }
}
