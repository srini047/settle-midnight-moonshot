import OpenAI from 'openai';
import type { RoomStatusSnapshot } from './room-status';

export type ContractResponse = {
  intent: 'status_summary' | 'specific_question' | 'clarification';
  language: string;
  answer: string;
  risks: string[];
  nextActions: string[];
};

export type DerivedContractStatus = {
  status: 'negotiating' | 'ready_for_acceptance' | 'agreed' | 'blocked';
  termsTotal: number;
  termsAgreed: number;
  unresolvedItems: Array<{ type: string; title: string; details: string }>;
  agreementRevision: string | null;
  acceptedByInitiator: boolean;
  acceptedByResponder: boolean;
};

function sameNonEmpty(left: string, right: string): boolean {
  return Boolean(left.trim() && right.trim() && left.trim() === right.trim());
}

export function deriveContractStatus(snapshot: RoomStatusSnapshot): DerivedContractStatus {
  const unresolvedItems: DerivedContractStatus['unresolvedItems'] = [];
  let termsAgreed = 0;
  for (const term of snapshot.terms) {
    const valueA = term.positions.find(position => position.side === 'a')?.value ?? '';
    const valueB = term.positions.find(position => position.side === 'b')?.value ?? '';
    if (sameNonEmpty(valueA, valueB)) termsAgreed += 1;
    else unresolvedItems.push({
      type: 'term',
      title: term.name,
      details: `Initiating party: ${valueA || 'not stated'}; responding party: ${valueB || 'not stated'}.`,
    });
  }
  for (const clause of snapshot.clauses) {
    if (clause.resolution.trim().length < 3) {
      unresolvedItems.push({ type: 'clause', title: clause.title, details: 'Shared wording is still missing.' });
    }
  }
  if (!snapshot.negotiation.definitionsConfirmedByA || !snapshot.negotiation.definitionsConfirmedByB) {
    unresolvedItems.push({ type: 'definitions', title: 'Term definitions', details: 'Both parties must confirm the term definitions.' });
  }
  const agreement = snapshot.agreement;
  const bothAccepted = Boolean(
    agreement?.acceptedByA && agreement.acceptedByB
    && agreement.acceptedRevisionA === agreement.revision
    && agreement.acceptedRevisionB === agreement.revision
  );
  const status = snapshot.negotiation.status === 'agreed' || bothAccepted
    ? 'agreed'
    : unresolvedItems.length === 0 && Boolean(agreement?.content.trim())
      ? 'ready_for_acceptance'
      : 'negotiating';
  return {
    status,
    termsTotal: snapshot.terms.length,
    termsAgreed,
    unresolvedItems,
    agreementRevision: agreement?.revision ?? null,
    acceptedByInitiator: Boolean(agreement?.acceptedByA && agreement.acceptedRevisionA === agreement.revision),
    acceptedByResponder: Boolean(agreement?.acceptedByB && agreement.acceptedRevisionB === agreement.revision),
  };
}

function compactSnapshot(snapshot: RoomStatusSnapshot) {
  return {
    roomId: snapshot.roomId,
    negotiation: snapshot.negotiation,
    parties: snapshot.parties,
    terms: snapshot.terms,
    offers: snapshot.offers.slice(-10),
    proposals: snapshot.proposals.slice(-10),
    messages: snapshot.messages.slice(-20),
    clauses: snapshot.clauses,
    agreement: snapshot.agreement ? {
      revision: snapshot.agreement.revision,
      acceptedByA: snapshot.agreement.acceptedByA,
      acceptedByB: snapshot.agreement.acceptedByB,
      content: snapshot.agreement.content.slice(0, 18000),
    } : null,
    recentEvents: snapshot.events.slice(0, 30),
  };
}

export async function generateContractResponse(snapshot: RoomStatusSnapshot, question?: string, responseLanguage?: string): Promise<ContractResponse> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  const trimmedQuestion = question?.trim() ?? '';
  const derived = deriveContractStatus(snapshot);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: process.env.MEDIATOR_MODEL ?? 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: `You are Settle's contract activity assistant for an Indian rental negotiation. Use only the supplied database snapshot. Do not invent facts, legal conclusions, dates, amounts, or agreement status. Answer in the language used by the user's question or transcript${responseLanguage ? `, specifically using language code ${responseLanguage}` : ''}. If the user's request is unclear, ask whether they want a complete contract activity summary or an answer to a specific question. A status summary must explain progress, unresolved items, risks, and the next action. A specific answer must directly answer the question and mention uncertainty. Do not change the contract. Return only JSON: {"intent":"status_summary|specific_question|clarification","language":"ISO-639-1 code","answer":"plain-language response","risks":["short risk"],"nextActions":["concrete next action"]}.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          request: trimmedQuestion || 'The user has not asked a specific question. Ask which kind of help they want.',
          derivedStatus: derived,
          databaseSnapshot: compactSnapshot(snapshot),
        }),
      },
    ],
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Contract assistant returned an empty response');
  const parsed = JSON.parse(raw) as Partial<ContractResponse>;
  const intent = parsed.intent === 'specific_question' || parsed.intent === 'clarification' ? parsed.intent : 'status_summary';
  const language = typeof parsed.language === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(parsed.language) ? parsed.language : 'en';
  return {
    intent,
    language,
    answer: typeof parsed.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : 'I could not prepare a response from the current contract activity.',
    risks: Array.isArray(parsed.risks) ? parsed.risks.filter(item => typeof item === 'string').slice(0, 8) : [],
    nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions.filter(item => typeof item === 'string').slice(0, 8) : [],
  };
}
