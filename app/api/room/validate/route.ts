import { NextResponse } from 'next/server';
import { readRoomStatus } from '../../../../lib/room-status';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { roomId?: string };
  try {
    body = await request.json() as { roomId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.roomId?.trim()) return NextResponse.json({ error: 'roomId is required' }, { status: 400 });
  try {
    const snapshot = await readRoomStatus(body.roomId);
    if (!snapshot) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    return NextResponse.json({ roomId: snapshot.roomId, title: snapshot.negotiation.title });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not validate room' }, { status: 400 });
  }
}
