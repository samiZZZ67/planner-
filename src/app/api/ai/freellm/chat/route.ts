import { NextRequest, NextResponse } from 'next/server';
import { sendChatCompletionWithFallback, ChatMessage } from '@/lib/server/freellm/gateway';
import {
  isImageGenerationRequest,
  isVideoGenerationRequest,
  cleanMediaPrompt,
  generateImage,
  startVideoGeneration,
  analyzeMultimodalWithGemini,
  AttachmentItem,
} from '@/lib/server/freellm/multimodal';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    const { messages, model, temperature, gatewayUrl, apiKey, mode } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages array is required and must contain at least one message.' },
        { status: 400 }
      );
    }

    const latestMessage = messages[messages.length - 1];
    const latestContent = String(latestMessage?.content || '').trim();
    const attachments: AttachmentItem[] = Array.isArray(latestMessage?.attachments)
      ? latestMessage.attachments
      : [];

    const hasVisualOrDocAttachments = attachments.some(
      a =>
        a.textContent ||
        (a.dataUrl && (a.type?.startsWith('image/') || a.type?.includes('pdf') || a.dataUrl.startsWith('data:image/')))
    );

    // ── 1. ROUTING: Vision or Document Analysis with Gemini 2.5 Flash ──
    if (hasVisualOrDocAttachments) {
      try {
        const visionResult = await analyzeMultimodalWithGemini(
          latestContent,
          attachments,
          'You are the Moon Assistant in NightPlanner, an expert multimodal assistant. Analyze the user\'s uploaded images, documents, and instructions thoroughly, accurately, and concisely.'
        );

        return NextResponse.json({
          ok: true,
          message: {
            role: 'assistant',
            content: visionResult.text,
          },
          model: visionResult.model,
          latencyMs: 1200,
          provider: 'Gemini Multimodal Vision',
        });
      } catch (visionErr: any) {
        console.warn('[Multimodal Route] Gemini vision failed, falling back to chat...', visionErr);
        // If vision fails, proceed with chat
      }
    }

    // ── 2. ROUTING: Image Generation ──
    if (mode === 'image_gen' || isImageGenerationRequest(latestContent)) {
      const cleanPrompt = cleanMediaPrompt(latestContent);
      const imgResult = await generateImage({
        prompt: cleanPrompt,
        model: 'flux',
        width: 1024,
        height: 1024,
      });

      return NextResponse.json({
        ok: true,
        message: {
          role: 'assistant',
          content: `🎨 I've generated an illustration based on your prompt:\n\n> **"${cleanPrompt}"**`,
        },
        generatedMedia: {
          type: 'image',
          url: imgResult.imageUrl,
          prompt: cleanPrompt,
          model: imgResult.model,
          width: imgResult.width,
          height: imgResult.height,
        },
        model: 'flux-pollinations-ai',
        latencyMs: 800,
        provider: 'Pollinations AI Image Engine',
      });
    }

    // ── 3. ROUTING: Video Generation ──
    if (mode === 'video_gen' || isVideoGenerationRequest(latestContent)) {
      const cleanPrompt = cleanMediaPrompt(latestContent);
      const videoJob = await startVideoGeneration(cleanPrompt);

      return NextResponse.json({
        ok: true,
        message: {
          role: 'assistant',
          content: `🎬 I've initiated video generation for your prompt:\n\n> **"${cleanPrompt}"**`,
        },
        generatedMedia: {
          type: 'video',
          url: videoJob.videoUrl,
          prompt: cleanPrompt,
          model: 'cogvideox-pollinations',
        },
        model: 'cogvideox-pollinations',
        latencyMs: 950,
        provider: 'Pollinations AI Video Engine',
      });
    }

    // ── 4. ROUTING: Standard Conversation via FreeLLM with Resilient Fallback ──
    const formattedMessages: ChatMessage[] = messages.map((m: any) => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: String(m.content || ''),
    }));

    const result = await sendChatCompletionWithFallback({
      messages: formattedMessages,
      model: typeof model === 'string' && model.trim() ? model.trim() : 'auto',
      temperature: typeof temperature === 'number' ? temperature : 0.7,
      customUrl: typeof gatewayUrl === 'string' && gatewayUrl.trim() ? gatewayUrl.trim() : undefined,
      customKey: typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : undefined,
    });

    return NextResponse.json({
      ok: true,
      message: {
        role: 'assistant',
        content: result.content,
      },
      model: result.model,
      latencyMs: result.latencyMs,
      tokensUsed: result.tokensUsed,
      provider: result.providerUsed,
    });
  } catch (err: any) {
    console.error('[FreeLLMAPI Route] Chat completion error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err.message || 'FreeLLMAPI request failed.',
      },
      { status: 502 }
    );
  }
}
