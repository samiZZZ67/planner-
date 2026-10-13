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
import { isVisionModel, isImageGenModel, isVideoGenModel, getModelById } from '@/lib/server/freellm/catalog';

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON request body.' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const { messages, model, temperature, mode } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Messages array is required and must contain at least one message.' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const selectedModel = typeof model === 'string' && model.trim() ? model.trim() : 'auto';
    const latestMessage = messages[messages.length - 1];
    let latestContent = String(latestMessage?.content || '').trim();
    const attachments: AttachmentItem[] = Array.isArray(latestMessage?.attachments)
      ? latestMessage.attachments
      : [];

    // ── 1. Process Document & Code Attachments (Inject into context) ──
    const docAttachments = attachments.filter(a => a.textContent && a.textContent.trim().length > 0);
    if (docAttachments.length > 0) {
      const docContext = docAttachments
        .map(a => `\n--- ATTACHED FILE: ${a.name} (${a.type}) ---\n${a.textContent}\n--- END OF ATTACHED FILE ---\n`)
        .join('\n');
      latestContent = `${latestContent}\n\n${docContext}`.trim();
    }

    // ── 2. Check for Visual Attachments (Images, PDFs) ──
    const visualAttachments = attachments.filter(
      a =>
        a.dataUrl &&
        (a.type?.startsWith('image/') ||
          a.type?.includes('pdf') ||
          a.dataUrl.startsWith('data:image/') ||
          a.dataUrl.includes('application/pdf'))
    );

    // ── 3. ROUTING: Vision Analysis ──
    if (visualAttachments.length > 0 || (isVisionModel(selectedModel) && attachments.length > 0)) {
      try {
        const visionResult = await analyzeMultimodalWithGemini(
          latestContent || 'Please analyze the attached image/document in detail.',
          attachments,
          'You are the FreeLLM Moon Assistant in Sam\'Space, an expert multimodal assistant. Analyze the user\'s uploaded images, screenshots, diagrams, documents, and instructions thoroughly, accurately, and concisely.'
        );

        return NextResponse.json(
          {
            ok: true,
            message: {
              role: 'assistant',
              content: visionResult.text,
            },
            model: visionResult.model,
            latencyMs: 1200,
            provider: 'Gemini Multimodal Vision Engine',
          },
          { headers: corsHeaders() }
        );
      } catch (visionErr: any) {
        console.warn('[Multimodal Route] Vision attempt failed, proceeding to chat fallback...', visionErr);
        // If vision fails, proceed to chat fallback
      }
    }

    // ── 4. ROUTING: Image Generation ──
    if (
      mode === 'image_gen' ||
      isImageGenModel(selectedModel) ||
      isImageGenerationRequest(latestContent)
    ) {
      const cleanPrompt = cleanMediaPrompt(latestContent);
      const imgResult = await generateImage({
        prompt: cleanPrompt,
        model: 'flux',
        width: 1024,
        height: 1024,
      });

      return NextResponse.json(
        {
          ok: true,
          message: {
            role: 'assistant',
            content: `🎨 Generated illustration for prompt:\n\n> **"${cleanPrompt}"**`,
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
          provider: 'Pollinations AI (Flux Engine)',
        },
        { headers: corsHeaders() }
      );
    }

    // ── 5. ROUTING: Video Generation ──
    if (
      mode === 'video_gen' ||
      isVideoGenModel(selectedModel) ||
      isVideoGenerationRequest(latestContent)
    ) {
      const cleanPrompt = cleanMediaPrompt(latestContent);
      const videoJob = await startVideoGeneration(cleanPrompt);

      return NextResponse.json(
        {
          ok: true,
          message: {
            role: 'assistant',
            content: `🎬 Generated video stream for prompt:\n\n> **"${cleanPrompt}"**`,
          },
          generatedMedia: {
            type: 'video',
            url: videoJob.videoUrl,
            prompt: cleanPrompt,
            model: 'cogvideox-pollinations',
          },
          model: 'cogvideox-pollinations',
          latencyMs: 950,
          provider: 'Pollinations AI (CogVideoX Engine)',
        },
        { headers: corsHeaders() }
      );
    }

    // ── 6. ROUTING: Standard Conversation via FreeLLM with Resilient Fallback ──
    const formattedMessages: ChatMessage[] = messages.map((m: any, index: number) => {
      let content = String(m.content || '');
      // If last user message had doc attachments, use the augmented content
      if (index === messages.length - 1 && m.role === 'user' && docAttachments.length > 0) {
        content = latestContent;
      }
      return {
        role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
        content,
      };
    });

    const result = await sendChatCompletionWithFallback({
      messages: formattedMessages,
      model: selectedModel,
      temperature: typeof temperature === 'number' ? temperature : 0.7,
    });

    return NextResponse.json(
      {
        ok: true,
        message: {
          role: 'assistant',
          content: result.content,
        },
        model: result.model,
        provider: result.providerUsed,
        latencyMs: result.latencyMs,
        tokensUsed: result.tokensUsed,
      },
      { headers: corsHeaders() }
    );
  } catch (err: any) {
    console.error('[FreeLLMAPI Route] Chat completion error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err.message || 'FreeLLMAPI request could not be completed.',
      },
      { status: 502, headers: corsHeaders() }
    );
  }
}
