import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { parseVoiceIntent, type VoiceContext } from '@/lib/voice/voiceIntentParser';
import { executeVoiceCommand } from '@/lib/server/voiceAssistantService';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionUser(req);
    const userId = session?.userId || 'owner';

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400, headers: corsHeaders() });
    }

    const { command, context = {}, confirmation } = body as {
      command?: string;
      context?: VoiceContext;
      confirmation?: { confirmed: boolean; action: string; targetId?: string; targetTitle?: string };
    };

    let parsed = body.parsedIntent;

    if (confirmation) {
      parsed = {
        intent: confirmation.confirmed ? 'assistant.confirm' : 'assistant.reject',
        params: {
          confirmedIntent: confirmation.action,
          targetId: confirmation.targetId,
          targetTitle: confirmation.targetTitle,
        },
        confidence: 1.0,
        rawText: confirmation.confirmed ? 'confirm' : 'cancel',
      };
    } else if (typeof command === 'string' && command.trim()) {
      parsed = parseVoiceIntent(command, context);
    }

    if (!parsed) {
      return NextResponse.json(
        { ok: false, error: 'Command string or parsedIntent is required.' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const result = await executeVoiceCommand(userId, parsed, context);
    return NextResponse.json(result, { headers: corsHeaders() });
  } catch (err: any) {
    console.error('[Voice Assistant API Error]:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Internal voice assistant execution error.' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
