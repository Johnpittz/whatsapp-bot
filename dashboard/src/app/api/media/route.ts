import { NextRequest, NextResponse } from 'next/server';

const VPS_HOST = 'http://2.25.192.248:8080';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const type = request.nextUrl.searchParams.get('type') || 'image';

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    let fetchUrl = url;

    // Local /media/ paths → proxy through VPS
    if (url.startsWith('/media/')) {
      fetchUrl = `${VPS_HOST}${url}`;
    }

    // Validate: must be WhatsApp CDN or VPS
    const parsedUrl = new URL(fetchUrl);
    const isWhatsApp = parsedUrl.hostname.endsWith('whatsapp.net') || parsedUrl.hostname.endsWith('whatsapp.com');
    const isVPS = parsedUrl.hostname === '2.25.192.248';

    if (!isWhatsApp && !isVPS) {
      return NextResponse.json({ error: 'Invalid URL domain' }, { status: 403 });
    }

    const resp = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': '*/*',
      },
    });

    if (!resp.ok) {
      return NextResponse.json({ error: `Upstream returned ${resp.status}` }, { status: resp.status });
    }

    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Map message_type to MIME
    const mimeMap: Record<string, string> = {
      image: 'image/jpeg',
      sticker: 'image/webp',
      video: 'video/mp4',
      audio: 'audio/ogg',
      document: 'application/pdf',
    };

    // Detect from magic bytes
    let mime = mimeMap[type] || 'application/octet-stream';

    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) mime = 'image/jpeg';
    else if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = 'image/png';
    else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) mime = 'image/webp';
    else if (bytes[0] === 0x4F && bytes[1] === 0x67) mime = 'audio/ogg';
    else if (bytes[0] === 0x1A && bytes[1] === 0xE3) mime = 'video/mp4';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed', details: message }, { status: 500 });
  }
}
