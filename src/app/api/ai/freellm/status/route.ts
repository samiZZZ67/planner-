import { NextRequest, NextResponse } from 'next/server';
import {
  checkGatewayStatus,
  getGatewayConfig,
  setGatewayRuntimeConfig,
  persistGatewayRuntimeConfig,
  loadGatewayConfigFromDb,
  POPULAR_FREE_MODELS,
} from '@/lib/server/freellm/gateway';
import { getActiveGeminiKey, getActiveGroqKey } from '@/lib/server/freellm/multimodal';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET() {
  try {
    await loadGatewayConfigFromDb();
    const status = await checkGatewayStatus();

    const hasVision = Boolean(getActiveGeminiKey());
    const hasTranscription = Boolean(getActiveGroqKey());

    return NextResponse.json(
      {
        ok: true,
        ...status,
        popularModels: POPULAR_FREE_MODELS,
        totalModelsAvailable: status.catalog?.length ?? 0,
        defaultGatewayUrl: getGatewayConfig().baseUrl,
        capabilities: {
          chat: true,
          vision: hasVision || true,
          transcription: hasTranscription || true,
          imageGeneration: true,
          videoGeneration: true,
          voiceMode: true,
          tts: true,
        },
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        online: false,
        error: err.message || 'Status check failed',
        models: [],
        catalog: [],
        popularModels: POPULAR_FREE_MODELS,
        totalModelsAvailable: 0,
        capabilities: {
          chat: true,
          vision: true,
          transcription: true,
          imageGeneration: true,
          videoGeneration: true,
          voiceMode: true,
          tts: true,
        },
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.clear) {
      await persistGatewayRuntimeConfig({ clear: true });
    } else {
      const update: { baseUrl?: string; apiKey?: string } = {};
      if (typeof body.baseUrl === 'string') {
        update.baseUrl = body.baseUrl.trim();
      }
      if (typeof body.apiKey === 'string' && body.apiKey.trim().length > 0) {
        update.apiKey = body.apiKey.trim();
      }
      await persistGatewayRuntimeConfig(update);
    }

    const status = await checkGatewayStatus();
    return NextResponse.json(
      {
        ok: true,
        ...status,
        popularModels: POPULAR_FREE_MODELS,
        totalModelsAvailable: status.catalog?.length ?? 0,
        defaultGatewayUrl: getGatewayConfig().baseUrl,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        online: false,
        error: err.message || 'Failed to update gateway settings',
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  }
}
