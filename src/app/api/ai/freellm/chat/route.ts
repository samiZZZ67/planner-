import { NextRequest, NextResponse } from 'next/server';
import { sendChatCompletion, ChatMessage } from '@/lib/server/freellm/gateway';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    const { messages, model, temperature, gatewayUrl, apiKey } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages array is required and must contain at least one message.' },
        { status: 400 }
      );
    }

    const formattedMessages: ChatMessage[] = messages.map((m: any) => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: String(m.content || ''),
    }));

    const result = await sendChatCompletion({
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
      provider: 'FreeLLMAPI Gateway',
    });
  } catch (err: any) {
    console.error('[FreeLLMAPI Route] Chat completion error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err.message || 'FreeLLMAPI Gateway request failed.',
      },
      { status: 502 }
    );
  }
}
