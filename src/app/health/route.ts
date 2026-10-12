import { NextResponse } from 'next/server';
import { checkDbConnection } from '@/lib/server/neon';

export async function GET() {
  const dbHealth = await checkDbConnection();

  return NextResponse.json(
    {
      status: 'ok',
      service: 'sams-space-backend',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: dbHealth.ok ? 'connected (SSL Postgres)' : `fallback (${dbHealth.message})`,
      port: process.env.PORT || '3000',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}
