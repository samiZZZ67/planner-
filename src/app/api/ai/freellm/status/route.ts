import { NextResponse } from 'next/server';
import { checkGatewayStatus, getGatewayConfig, POPULAR_FREE_MODELS } from '@/lib/server/freellm/gateway';
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
        status: 200, // Return JSON status so the frontend can preserve its current catalog
        headers: corsHeaders(),
      }
    );
  }
}
