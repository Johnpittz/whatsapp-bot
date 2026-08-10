import { NextRequest, NextResponse } from 'next/server';

const VPS_HOST = 'http://2.25.192.248:8080';

/**
 * Proxy all /api/bulk/* requests to VPS bot
 * Handles: GET, POST, DELETE
 */
async function proxyRequest(request: NextRequest, path: string) {
  const url = new URL(request.url);
  const targetUrl = `${VPS_HOST}/api/bulk/${path}${url.search ? '?' + url.searchParams.toString() : ''}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const options: RequestInit = {
    method: request.method,
    headers,
  };

  // Forward body for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    try {
      const body = await request.text();
      if (body) options.body = body;
    } catch {}
  }

  try {
    const resp = await fetch(targetUrl, options);
    const data = await resp.text();

    return new NextResponse(data, {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Proxy failed', details: message }, { status: 500 });
  }
}

// Catch-all route for /api/bulk/*
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> }
) {
  const { slug } = await params;
  const path = slug ? slug.join('/') : '';
  return proxyRequest(request, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> }
) {
  const { slug } = await params;
  const path = slug ? slug.join('/') : '';
  return proxyRequest(request, path);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> }
) {
  const { slug } = await params;
  const path = slug ? slug.join('/') : '';
  return proxyRequest(request, path);
}
