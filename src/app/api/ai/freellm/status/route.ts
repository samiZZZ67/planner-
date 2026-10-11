import { NextRequest, NextResponse } from 'next/server';
import { checkGatewayStatus, getGatewayConfig, POPULAR_FREE_MODELS } from '@/lib/server/freellm/gateway';
import { getActiveGeminiKey, getActiveGroqKey } from '@/lib/server/freellm/multimodal';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customUrl = searchParams.get('url') || undefined;
    const customKey = searchParams.get('apiKey') || undefined;

    const status = await checkGatewayStatus(customUrl, customKey);

    const hasVision = Boolean(getActiveGeminiKey());
    const hasTranscription = Boolean(getActiveGroqKey());

    return NextResponse.json({
      ok: true,
      ...status,
      popularModels: POPULAR_FREE_MODELS,
      defaultGatewayUrl: getGatewayConfig().baseUrl,
      capabilities: {
        chat: true,
        vision: hasVision,
        transcription: hasTranscription,
        imageGeneration: true,
        videoGeneration: true,
        voiceMode: true,
        tts: true,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        online: false,
        error: err.message || 'Status check failed',
        popularModels: POPULAR_FREE_MODELS,
        capabilities: {
          chat: true,
          vision: false,
          transcription: false,
          imageGeneration: true,
          videoGeneration: true,
          voiceMode: true,
          tts: true,
        },
      },
      { status: 500 }
    );
  }
}
