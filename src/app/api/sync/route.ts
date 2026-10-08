import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/server/auth';
import { getDb, syncBatch } from '@/lib/server/neon';
import type { SyncPayload } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const isAuthenticated = await verifySession();
    if (!isAuthenticated) {
      return NextResponse.json(
        { error: 'Session expired or not logged in', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const sql = getDb();
    if (!sql) {
      return NextResponse.json(
        { error: 'Cloud database is not configured (DATABASE_URL missing or dummy).' },
        { status: 503 }
      );
    }

    const body: SyncPayload = await req.json();
    const result = await syncBatch(sql, {
      sections: body.sections || [],
      tasks: body.tasks || [],
      timeLogs: body.timeLogs || [],
      days: body.days || [],
      lastServerSeq: body.lastServerSeq || 0,
    });

    return NextResponse.json({
      ok: true,
      currentServerSeq: result.currentServerSeq,
      acknowledgedIds: result.ack,
      serverChanges: result.serverChanges,
    });
  } catch (err: any) {
    console.error('Sync API Error:', err);
    return NextResponse.json(
      { error: err.message || 'Sync failed on server' },
      { status: 500 }
    );
  }
}
