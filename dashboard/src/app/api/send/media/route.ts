import { NextRequest, NextResponse } from 'next/server';

const BOT_URL = process.env.BOT_URL || 'http://2.25.192.248:8080';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { number, mediatype, mimetype, caption, media, fileName } = body;

    if (!number || !media || !mediatype) {
      return NextResponse.json(
        { error: 'Missing required fields: number, media, mediatype' },
        { status: 400 }
      );
    }

    const resp = await fetch(`${BOT_URL}/api/send/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, mediatype, mimetype, caption, media, fileName })
    });

    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PROXY] Error:', message);
    return NextResponse.json({ error: 'Proxy error', details: message }, { status: 500 });
  }
}
