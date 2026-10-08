import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/server/auth';
import { getDb, syncBatch } from '@/lib/server/neon';
import { syncBatchLocal } from '@/lib/server/localDb';
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

    const body: SyncPayload = await req.json();
    const batchInput = {
      sections: body.sections || [],
      tasks: body.tasks || [],
      timeLogs: body.timeLogs || [],
      days: body.days || [],
      lastServerSeq: body.lastServerSeq || 0,
    };

    const sql = getDb();
    let result;

    if (sql) {
      // Primary: Neon Postgres cloud database
      result = await syncBatch(sql, batchInput);
    } else {
      // Shared server store: allows real PC ↔ phone sync on local network/self-hosted Next server
      result = await syncBatchLocal(batchInput);
    }

    return NextResponse.json({
      ok: true,
      currentServerSeq: result.currentServerSeq,
      acknowledgedIds: result.ack,
      serverChanges: result.serverChanges,
      storageEngine: sql ? 'neon_postgres' : 'server_shared_db',
    });
  } catch (err: any) {
    console.error('Sync API Error:', err);
    return NextResponse.json(
      { error: err.message || 'Sync failed on server' },
      { status: 500 }
    );
  }
}
