import { NextRequest, NextResponse } from 'next/server';
import { generateImage, cleanMediaPrompt } from '@/lib/server/freellm/multimodal';

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
    if (!body?.prompt) {
      return NextResponse.json(
        { ok: false, error: 'Prompt is required.' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const rawPrompt = String(body.prompt).trim();
    const cleanPrompt = cleanMediaPrompt(rawPrompt);

    const result = await generateImage({
      prompt: cleanPrompt,
      width: Number(body.width) || 1024,
      height: Number(body.height) || 1024,
      model: body.model === 'turbo' ? 'turbo' : 'flux',
      seed: typeof body.seed === 'number' ? body.seed : undefined,
    });

    return NextResponse.json(
      {
        ok: true,
        ...result,
        provider: 'Pollinations AI (Flux Engine)',
      },
      { headers: corsHeaders() }
    );
  } catch (err: any) {
    console.error('[Generate Image Route] Error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err.message || 'Image generation failed.',
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}
