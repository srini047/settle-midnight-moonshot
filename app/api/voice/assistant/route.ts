import { NextResponse } from 'next/server';
import { generateContractResponse, deriveContractStatus } from '../../../../lib/contract-response';
import { readRoomStatus } from '../../../../lib/room-status';

export const runtime = 'nodejs';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

async function transcribe(audio: File): Promise<string> {
  const bytes = Buffer.from(await audio.arrayBuffer());
  const query = new URLSearchParams({ model: 'pulse', language: 'multi-indic', word_timestamps: 'false' });
  const response = await fetch(`https://api.smallest.ai/waves/v1/stt/?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SMALLEST_API_KEY}`,
      'Content-Type': audio.type || 'application/octet-stream',
      'x-expire-content': 'true',
    },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Speech transcription failed (${response.status})`);
  const data = await response.json() as { transcription?: string };
  if (!data.transcription?.trim()) throw new Error('No speech was detected');
  return data.transcription.trim();
}

async function synthesize(text: string, language: string): Promise<{ audioDataUrl: string | null; error?: string }> {
  if (!process.env.SMALLEST_API_KEY) return { audioDataUrl: null, error: 'SMALLEST_API_KEY is not configured' };
  const response = await fetch('https://api.smallest.ai/waves/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SMALLEST_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'audio/wav',
    },
    body: JSON.stringify({
      text: text.slice(0, 3000),
      voice_id: process.env.SMALLEST_TTS_VOICE_ID ?? 'devansh',
      model: process.env.SMALLEST_TTS_MODEL ?? 'lightning_v3.1',
      sample_rate: 24000,
      speed: 1,
      language: language || 'auto',
      output_format: 'wav',
    }),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    return { audioDataUrl: null, error: `Speech synthesis failed (${response.status})${details ? `: ${details.slice(0, 300)}` : ''}` };
  }
  const audio = Buffer.from(await response.arrayBuffer()).toString('base64');
  return { audioDataUrl: `data:audio/wav;base64,${audio}` };
}

export async function POST(request: Request) {
  if (!process.env.SMALLEST_API_KEY) {
    return NextResponse.json({ error: 'SMALLEST_API_KEY is required for voice conversation' }, { status: 503 });
  }
  const form = await request.formData();
  const roomId = String(form.get('roomId') ?? '').trim();
  const conversationLanguage = String(form.get('conversationLanguage') ?? '').trim();
  const audio = form.get('audio');
  if (!roomId) return NextResponse.json({ error: 'roomId is required' }, { status: 400 });
  if (!(audio instanceof File)) return NextResponse.json({ error: 'audio is required' }, { status: 400 });
  if (audio.size === 0 || audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: 'Audio must be between 1 byte and 10 MB' }, { status: 400 });

  try {
    const snapshot = await readRoomStatus(roomId);
    if (!snapshot) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    const transcript = await transcribe(audio);
    const response = await generateContractResponse(snapshot, transcript, /^[a-z]{2}(?:-[A-Z]{2})?$/.test(conversationLanguage) ? conversationLanguage : undefined);
    const speech = await synthesize(response.answer, response.language);
    return NextResponse.json({
      roomId: snapshot.roomId,
      transcript,
      status: deriveContractStatus(snapshot),
      intent: response.intent,
      language: response.language,
      response: response.answer,
      risks: response.risks,
      nextActions: response.nextActions,
      audioDataUrl: speech.audioDataUrl,
      audioError: speech.error ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Voice assistant failed' },
      { status: 502 }
    );
  }
}
