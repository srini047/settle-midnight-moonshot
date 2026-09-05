import { NextResponse } from 'next/server';
import { smallestTts } from '../../../lib/smallest';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!process.env.SMALLEST_API_KEY) {
    return NextResponse.json({ error: 'SMALLEST_API_KEY is not configured' }, { status: 503 });
  }

  let text: string;
  try {
    const body = (await request.json()) as { text?: string };
    text = (body.text ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  try {
    const res = await smallestTts(text);
    const audio = await res.arrayBuffer();
    return new NextResponse(audio, {
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'audio/mpeg' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'TTS failed' },
      { status: 502 }
    );
  }
}