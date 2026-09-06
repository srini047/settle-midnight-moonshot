import { NextResponse } from 'next/server';
import { generateContractResponse, deriveContractStatus } from '../../../lib/contract-response';
import { readRoomStatus } from '../../../lib/room-status';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { roomId?: string; question?: string };
  try {
    body = await request.json() as { roomId?: string; question?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.roomId?.trim()) return NextResponse.json({ error: 'roomId is required' }, { status: 400 });
  if (body.question && body.question.length > 4000) return NextResponse.json({ error: 'Question is too long' }, { status: 400 });

  try {
    const snapshot = await readRoomStatus(body.roomId);
    if (!snapshot) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    const response = await generateContractResponse(snapshot, body.question);
    return NextResponse.json({
      roomId: snapshot.roomId,
      status: deriveContractStatus(snapshot),
      ...response,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not summarize the contract activity';
    const status = /room ID|Room not found/i.test(message) ? 400 : /OPENAI_API_KEY/i.test(message) ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
