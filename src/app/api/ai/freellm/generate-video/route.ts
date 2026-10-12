import { NextRequest, NextResponse } from 'next/server';
import {
  startVideoGeneration,
  getVideoJobStatus,
  cleanMediaPrompt,
} from '@/lib/server/freellm/multimodal';

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

    const job = await startVideoGeneration(cleanPrompt);

    return NextResponse.json(
      {
        ok: true,
        job,
        provider: 'Pollinations AI (CogVideoX Engine)',
      },
      { headers: corsHeaders() }
    );
  } catch (err: any) {
    console.error('[Generate Video Route] Error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err.message || 'Video generation failed.',
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: 'jobId query parameter is required.' },
      { status: 400, headers: corsHeaders() }
    );
  }

  const job = getVideoJobStatus(jobId);
  if (!job) {
    return NextResponse.json(
      { ok: false, error: 'Video job not found.' },
      { status: 404, headers: corsHeaders() }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      job,
    },
    { headers: corsHeaders() }
  );
}
