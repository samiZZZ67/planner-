import { NextRequest, NextResponse } from 'next/server';
import { checkGatewayStatus, getGatewayConfig, POPULAR_FREE_MODELS } from '@/lib/server/freellm/gateway';
import { getActiveGeminiKey, getActiveGroqKey } from '@/lib/server/freellm/multimodal';
import { VERIFIED_FREE_MODELS } from '@/lib/server/freellm/catalog';

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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customUrl = searchParams.get('url') || undefined;
    const customKey = searchParams.get('apiKey') || undefined;

    const status = await checkGatewayStatus(customUrl, customKey);

    const hasVision = Boolean(getActiveGeminiKey());
    const hasTranscription = Boolean(getActiveGroqKey());

    return NextResponse.json(
      {
        ok: true,
        ...status,
        popularModels: POPULAR_FREE_MODELS,
        totalModelsAvailable: status.catalog?.length || VERIFIED_FREE_MODELS.length,
        defaultGatewayUrl: getGatewayConfig().baseUrl,
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
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        online: false,
        error: err.message || 'Status check failed',
        models: VERIFIED_FREE_MODELS.map(m => m.id),
        catalog: VERIFIED_FREE_MODELS,
        popularModels: POPULAR_FREE_MODELS,
        totalModelsAvailable: VERIFIED_FREE_MODELS.length,
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
        status: 200, // Return 200 so frontend can still gracefully use the catalog
        headers: corsHeaders(),
      }
    );
  }
}
