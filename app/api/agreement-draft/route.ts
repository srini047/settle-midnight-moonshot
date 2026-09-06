import OpenAI from 'openai';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type Clause = {
  id: string;
  title: string;
  text: string;
};

type AgreementDraftRequest = {
  title: string;
  category: string;
  initialContext: string;
  responderContext: string;
  jurisdictionState: string;
  jurisdictionCity: string;
  propertyType: string;
  terms: Array<{ name: string; valueA: string; valueB: string }>;
  clauses: Clause[];
  currentContent: string;
};

const SYSTEM_PROMPT = `
You draft a complete shared rental agreement for an Indian residential or commercial rental
matter. Use the supplied context, parties, premises facts, jurisdiction, negotiated terms, and
existing agreement. Do not invent facts, law, names, amounts, dates, or legal conclusions. If a
fact is missing, use a clear bracketed placeholder such as [Landlord full name] rather than
guessing. The wording must be neutral, practical, and understandable. This is a negotiation
draft, not legal advice.

Use a professional rental-agreement structure similar to a real Indian rental agreement:
1. Title, date, and place of execution.
2. Landlord and tenant identification.
3. Premises/property description and permitted use.
4. Term, commencement, possession, and renewal.
5. Rent, due date, payment method, late payment, and escalation.
6. Security deposit, deductions, and refund.
7. Utilities, maintenance, repairs, alterations, and fixtures.
8. Occupancy, pets, nuisance, subletting, and assignment.
9. Inspection, access, safety, and compliance.
10. Default, termination, notice, handover, and holding over.
11. Dispute resolution, jurisdiction, stamp duty, and registration.
12. General provisions, notices, signatures, and witnesses.

Return a complete plain-text agreement suitable for PDF export. Use numbered headings and
paragraphs, not a summary or a list of suggestions. Include every supplied negotiated term in
the relevant clause and keep unresolved values visibly marked.

Return only JSON with this exact shape:
{
  "summary": "short summary of meaningful changes",
  "content": "complete plain-text rental agreement",
  "sections": [{ "id": "stable section id", "title": "section heading", "body": "complete section wording" }]
}
`.trim();

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY is required' }, { status: 503 });
  }

  let snapshot: AgreementDraftRequest;
  try {
    snapshot = (await request.json()) as AgreementDraftRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!snapshot.title?.trim() || !snapshot.jurisdictionState?.trim() || !snapshot.jurisdictionCity?.trim()) {
    return NextResponse.json({ error: 'Matter title and jurisdiction are required' }, { status: 400 });
  }
  if (!Array.isArray(snapshot.clauses) || snapshot.clauses.length === 0) {
    return NextResponse.json({ error: 'No agreement clauses are available' }, { status: 400 });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: process.env.MEDIATOR_MODEL ?? 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            matter: {
              title: snapshot.title,
              category: snapshot.category,
              propertyType: snapshot.propertyType,
              jurisdiction: `${snapshot.jurisdictionCity}, ${snapshot.jurisdictionState}, India`,
            },
            context: {
              initiatingParty: snapshot.initialContext,
              respondingParty: snapshot.responderContext,
            },
            negotiatedTerms: snapshot.terms,
            currentAgreement: snapshot.currentContent,
            clauses: snapshot.clauses,
          }),
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Agreement draft returned empty output');
    const parsed = JSON.parse(raw) as {
      summary?: string;
      content?: string;
      sections?: Array<{ id?: string; title?: string; body?: string }>;
    };
    const content = String(parsed.content ?? '').trim();
    const sections = (parsed.sections ?? [])
      .map(section => ({
        id: String(section.id ?? '').trim(),
        title: String(section.title ?? '').trim(),
        body: String(section.body ?? '').trim(),
      }))
      .filter(section => section.id && section.title && section.body);
    if (content.length < 500) throw new Error('Agreement draft is too short to be a complete rental agreement');
    if (sections.length < 8) throw new Error('Agreement draft did not return enough rental-agreement sections');
    if (new Set(sections.map(section => section.id)).size !== sections.length) {
      throw new Error('Agreement draft contains duplicate section IDs');
    }
    return NextResponse.json({
      summary: parsed.summary?.trim() || 'AI generated a complete rental agreement draft.',
      content,
      sections,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Agreement draft generation failed' },
      { status: 502 }
    );
  }
}
