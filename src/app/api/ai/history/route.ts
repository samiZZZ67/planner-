import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/server/auth';
import {
  getAIConversationsLocal,
  saveAIConversationLocal,
  deleteAIConversationLocal,
  getAIMessagesLocal,
  saveAIMessageLocal,
  getFreeLLMConversationsLocal,
  saveFreeLLMConversationLocal,
  deleteFreeLLMConversationLocal,
} from '@/lib/server/localDb';

export async function GET(req: NextRequest) {
  try {
    const isAuth = await verifySession(req);
    if (!isAuth) {
      return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const assistant = searchParams.get('assistant') || 'sams_ai';
    const convId = searchParams.get('conversationId');

    if (assistant === 'freellm') {
      const conversations = getFreeLLMConversationsLocal();
      return NextResponse.json({ ok: true, assistant, conversations });
    }

    // Default: Sam's AI
    if (convId) {
      const messages = getAIMessagesLocal(convId);
      return NextResponse.json({ ok: true, assistant, conversationId: convId, messages });
    }

    const conversations = getAIConversationsLocal('owner');
    // Also include messages for each conversation so phone/pc load everything at once
    const messagesByConv: Record<string, any[]> = {};
    for (const c of conversations) {
      messagesByConv[c.id] = getAIMessagesLocal(c.id);
    }

    return NextResponse.json({ ok: true, assistant, conversations, messages: messagesByConv });
  } catch (err: any) {
    console.error('[AI History API GET Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch history' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const isAuth = await verifySession(req);
    if (!isAuth) {
      return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { assistant = 'sams_ai', action = 'sync' } = body;

    // ── 1. FreeLLM Moon Assistant ──
    if (assistant === 'freellm') {
      if (action === 'save_conversation' && body.conversation) {
        saveFreeLLMConversationLocal(body.conversation);
        return NextResponse.json({ ok: true, conversation: body.conversation });
      }

      if (action === 'delete_conversation' && body.conversationId) {
        deleteFreeLLMConversationLocal(body.conversationId);
        return NextResponse.json({ ok: true });
      }

      if (action === 'sync') {
        const incoming: any[] = Array.isArray(body.conversations) ? body.conversations : [];
        const existing = getFreeLLMConversationsLocal();
        const existingMap = new Map(existing.map((c: any) => [c.id, c]));

        for (const inc of incoming) {
          const current = existingMap.get(inc.id);
          if (!current || (inc.updatedAt || 0) >= (current.updatedAt || 0)) {
            existingMap.set(inc.id, inc);
            saveFreeLLMConversationLocal(inc);
          }
        }

        const merged = Array.from(existingMap.values()).sort(
          (a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0)
        );
        return NextResponse.json({ ok: true, conversations: merged });
      }
    }

    // ── 2. Sam's AI ──
    if (action === 'save_conversation' && body.conversation) {
      saveAIConversationLocal(body.conversation);
      return NextResponse.json({ ok: true, conversation: body.conversation });
    }

    if (action === 'save_message' && body.message) {
      saveAIMessageLocal(body.message);
      return NextResponse.json({ ok: true, message: body.message });
    }

    if (action === 'delete_conversation' && body.conversationId) {
      deleteAIConversationLocal(body.conversationId);
      return NextResponse.json({ ok: true });
    }

    if (action === 'sync') {
      const incomingConvs: any[] = Array.isArray(body.conversations) ? body.conversations : [];
      const incomingMsgs: any[] = Array.isArray(body.messages) ? body.messages : [];

      const existingConvs = getAIConversationsLocal('owner');
      const convMap = new Map(existingConvs.map((c: any) => [c.id, c]));

      for (const inc of incomingConvs) {
        const cur = convMap.get(inc.id);
        if (!cur || (inc.updatedAt || 0) >= (cur.updatedAt || 0)) {
          convMap.set(inc.id, inc);
          saveAIConversationLocal(inc);
        }
      }

      for (const msg of incomingMsgs) {
        saveAIMessageLocal(msg);
      }

      const mergedConvs = Array.from(convMap.values()).sort(
        (a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0)
      );

      const messagesByConv: Record<string, any[]> = {};
      for (const c of mergedConvs) {
        messagesByConv[c.id] = getAIMessagesLocal(c.id);
      }

      return NextResponse.json({ ok: true, conversations: mergedConvs, messages: messagesByConv });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[AI History API POST Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to process history' }, { status: 500 });
  }
}
