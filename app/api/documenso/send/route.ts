import { NextResponse } from 'next/server';
import { createAgreementPdf } from '../../../../lib/agreement-pdf';
import { readRoomStatus } from '../../../../lib/room-status';

export const runtime = 'nodejs';

type RequestBody = {
  roomId?: string;
  signerAEmail?: string;
  signerBEmail?: string;
};

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error ?? parsed.message ?? text;
  } catch {
    return text || `Documenso request failed with status ${response.status}`;
  }
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const roomId = body.roomId?.trim() ?? '';
  const signerAEmail = body.signerAEmail?.trim().toLowerCase() ?? '';
  const signerBEmail = body.signerBEmail?.trim().toLowerCase() ?? '';
  if (!roomId || !isEmail(signerAEmail) || !isEmail(signerBEmail)) {
    return NextResponse.json({ error: 'A valid email is required for both parties' }, { status: 400 });
  }
  if (signerAEmail === signerBEmail) {
    return NextResponse.json({ error: 'The two parties must use different email addresses' }, { status: 400 });
  }
  if (!process.env.DOCUMENSO_API_KEY) {
    return NextResponse.json({ error: 'DOCUMENSO_API_KEY is not configured' }, { status: 503 });
  }

  try {
    const snapshot = await readRoomStatus(roomId);
    if (!snapshot) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

    const agreement = snapshot.agreement;
    const fullyAgreed = snapshot.negotiation.status === 'agreed'
      && Boolean(
        agreement
        && agreement.acceptedByA
        && agreement.acceptedByB
        && agreement.acceptedRevisionA === agreement.revision
        && agreement.acceptedRevisionB === agreement.revision
        && agreement.content.trim()
      );
    if (!fullyAgreed || !agreement) {
      return NextResponse.json({ error: 'Both parties must agree to the final agreement first' }, { status: 409 });
    }

    const partyA = snapshot.parties.find(party => party.side === 'a');
    const partyB = snapshot.parties.find(party => party.side === 'b');
    if (!partyA || !partyB || !partyA.joined || !partyB.joined) {
      return NextResponse.json({ error: 'Both parties must be present before sending for signature' }, { status: 409 });
    }

    const { pdf, pageCount } = createAgreementPdf({
      title: snapshot.negotiation.title,
      roomId: snapshot.roomId,
      revision: agreement.revision,
      content: agreement.content,
    });
    const pdfBytes = new Uint8Array(pdf.output('arraybuffer'));
    const payload = {
      type: 'DOCUMENT',
      title: snapshot.negotiation.title,
      recipients: [
        {
          email: signerAEmail,
          name: partyA.label || 'Initiating party',
          role: 'SIGNER',
          fields: [
            { identifier: 0, type: 'SIGNATURE', page: pageCount, positionX: 10, positionY: 80, width: 30, height: 5 },
            { identifier: 0, type: 'NAME', page: pageCount, positionX: 10, positionY: 87, width: 30, height: 4 },
            { identifier: 0, type: 'DATE', page: pageCount, positionX: 10, positionY: 94, width: 20, height: 3 },
          ],
        },
        {
          email: signerBEmail,
          name: partyB.label || 'Responding party',
          role: 'SIGNER',
          fields: [
            { identifier: 0, type: 'SIGNATURE', page: pageCount, positionX: 55, positionY: 80, width: 30, height: 5 },
            { identifier: 0, type: 'NAME', page: pageCount, positionX: 55, positionY: 87, width: 30, height: 4 },
            { identifier: 0, type: 'DATE', page: pageCount, positionX: 55, positionY: 94, width: 20, height: 3 },
          ],
        },
      ],
    };
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    form.append('files', new Blob([pdfBytes], { type: 'application/pdf' }), `${snapshot.roomId.toLowerCase()}-agreement.pdf`);

    const baseUrl = (process.env.DOCUMENSO_BASE_URL ?? 'https://app.documenso.com/api/v2').replace(/\/$/, '');
    const createResponse = await fetch(`${baseUrl}/envelope/create`, {
      method: 'POST',
      headers: { Authorization: process.env.DOCUMENSO_API_KEY },
      body: form,
    });
    if (!createResponse.ok) throw new Error(await responseError(createResponse));
    const envelope = await createResponse.json() as { id?: string };
    if (!envelope.id) throw new Error('Documenso did not return an envelope ID');

    const distributeResponse = await fetch(`${baseUrl}/envelope/distribute`, {
      method: 'POST',
      headers: {
        Authorization: process.env.DOCUMENSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ envelopeId: envelope.id }),
    });
    if (!distributeResponse.ok) throw new Error(await responseError(distributeResponse));

    return NextResponse.json({ envelopeId: envelope.id, sent: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not send the agreement for signature';
    const status = /DOCUMENSO_API_KEY/i.test(message) ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
