import { NextResponse } from 'next/server';
import { smallestStt } from '../../../lib/smallest';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!process.env.SMALLEST_API_KEY) {
    return NextResponse.json({ error: 'SMALLEST_API_KEY is not configured' }, { status: 503 });
  }

  const language = new URL(request.url).searchParams.get('language') || 'en';
  const form = await request.formData();
  const audio = form.get('audio');
  if (!audio || typeof audio === 'string') {
    return NextResponse.json({ error: 'Missing audio upload' }, { status: 400 });
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: 'Empty audio' }, { status: 400 });
  }

  try {
    const transcription = await smallestStt(bytes, language);
    return NextResponse.json({ transcription });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'STT failed' },
      { status: 502 }
    );
  }
}