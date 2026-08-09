import { NextRequest, NextResponse } from 'next/server';

const BOT_URL = process.env.BOT_URL || 'http://2.25.192.248:8080';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { number, text } = body;

    if (!number || !text) {
      return NextResponse.json({ error: 'Missing required fields: number, text' }, { status: 400 });
    }

    const resp = await fetch(`${BOT_URL}/api/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, text })
    });

    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PROXY] Error:', message);
    return NextResponse.json({ error: 'Proxy error', details: message }, { status: 500 });
  }
}
