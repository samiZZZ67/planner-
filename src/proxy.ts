import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const origin = request.headers.get('origin');
  const clientUrlEnv = process.env.CLIENT_URL || '';

  // Parse allowed origins from CLIENT_URL (supports comma-separated list or wildcard)
  const allowedOrigins = clientUrlEnv
    ? clientUrlEnv.split(',').map((u) => u.trim().replace(/\/+$/, ''))
    : ['*'];

  const isAllowed =
    allowedOrigins.includes('*') ||
    !origin ||
    allowedOrigins.includes(origin.replace(/\/+$/, ''));

  // If credentials are allowed, Access-Control-Allow-Origin cannot be '*' if an origin is supplied
  const allowOriginHeader = isAllowed
    ? origin || (allowedOrigins.includes('*') ? '*' : allowedOrigins[0])
    : allowedOrigins[0] || '*';

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    const preflightHeaders = new Headers();
    preflightHeaders.set('Access-Control-Allow-Origin', allowOriginHeader);
    preflightHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    preflightHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-token');
    preflightHeaders.set('Access-Control-Allow-Credentials', 'true');
    preflightHeaders.set('Access-Control-Max-Age', '86400');
    return new NextResponse(null, { status: 204, headers: preflightHeaders });
  }

  const response = NextResponse.next();
  response.headers.set('Access-Control-Allow-Origin', allowOriginHeader);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-token');
  response.headers.set('Access-Control-Allow-Credentials', 'true');

  return response;
}

export const config = {
  matcher: ['/api/:path*', '/health'],
};
