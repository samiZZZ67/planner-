import { NextRequest, NextResponse } from 'next/server';
import { checkGatewayStatus, getGatewayConfig, POPULAR_FREE_MODELS } from '@/lib/server/freellm/gateway';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customUrl = searchParams.get('url') || undefined;
    const customKey = searchParams.get('apiKey') || undefined;

    const status = await checkGatewayStatus(customUrl, customKey);

    return NextResponse.json({
      ok: true,
      ...status,
      popularModels: POPULAR_FREE_MODELS,
      defaultGatewayUrl: getGatewayConfig().baseUrl,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        online: false,
        error: err.message || 'Status check failed',
        popularModels: POPULAR_FREE_MODELS,
      },
      { status: 500 }
    );
  }
}
