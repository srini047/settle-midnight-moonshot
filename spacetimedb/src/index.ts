import {
  schema,
  table,
  t,
  SenderError,
  type InferSchema,
  type ReducerCtx,
} from 'spacetimedb/server';

const TermSeed = t.object('TermSeed', {
  name: t.string(),
  valueA: t.string(),
  valueB: t.string(),
  reasonA: t.string(),
  reasonB: t.string(),
  valueKind: t.string(),
  unit: t.string(),
  validationRule: t.string(),
  validationTarget: t.string(),
  mediatorPreference: t.string(),
});

const OfferTermInput = t.object('OfferTermInput', {
  termId: t.u64(),
  valueA: t.string(),
  valueB: t.string(),
});

const SupportDocumentSeed = t.object('SupportDocumentSeed', {
  name: t.string(),
  mimeType: t.string(),
  content: t.string(),
  data: t.array(t.u8()),
});

const AgreementClauseDraft = t.object('AgreementClauseDraft', {
  clauseId: t.u64(),
  text: t.string(),
});

const negotiation = table(
  { name: 'negotiation', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    joinCode: t.string().unique(),
    title: t.string(),
    category: t.string(),
    status: t.string(),
    createdAt: t.timestamp(),
    createdBy: t.identity(),
    initialContext: t.string().default(''),
    acceptedByA: t.bool().default(false),
    acceptedByB: t.bool().default(false),
    definitionsConfirmedByA: t.bool().default(false),
    definitionsConfirmedByB: t.bool().default(false),
    jurisdictionState: t.string().default(''),
    jurisdictionCity: t.string().default(''),
    propertyType: t.string().default('residential'),
    responderContext: t.string().default(''),
  }
);

const party = table(
  {
    name: 'party',
    public: true,
    indexes: [
      { accessor: 'by_negotiation', algorithm: 'btree', columns: ['negotiationId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    negotiationId: t.u64(),
    side: t.string(),
    label: t.string(),
    identity: t.option(t.identity()),
    online: t.bool(),
    labelConfirmed: t.bool().default(false),
  }
);

const term = table(
  {
    name: 'term',
    public: true,
    indexes: [
      { accessor: 'by_negotiation', algorithm: 'btree', columns: ['negotiationId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    negotiationId: t.u64(),
    name: t.string(),
    sortOrder: t.u32(),
    valueKind: t.string().default('free_text'),
    unit: t.string().default(''),
    validationRule: t.string().default('none'),
    validationTarget: t.string().default(''),
    mediatorPreference: t.string().default(''),
  }
);

const position = table(
  {
    name: 'position',
    public: true,
    indexes: [
      { accessor: 'by_negotiation', algorithm: 'btree', columns: ['negotiationId'] },
      { accessor: 'by_term', algorithm: 'btree', columns: ['termId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    negotiationId: t.u64(),
    partyId: t.u64(),
    termId: t.u64(),
    value: t.string(),
    reason: t.string(),
    updatedAt: t.timestamp(),
    initialValue: t.string().default(''),
    initialReason: t.string().default(''),
  }
);

const offer = table(
  {
    name: 'offer',
    public: true,
    indexes: [
      { accessor: 'by_negotiation', algorithm: 'btree', columns: ['negotiationId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    negotiationId: t.u64(),
    createdByPartyId: t.u64(),
    status: t.string(),
    note: t.string(),
    createdAt: t.timestamp(),
    acceptedByA: t.bool().default(false),
    acceptedByB: t.bool().default(false),
  }
);

const offer_term = table(
  {
    name: 'offer_term',
    public: true,
    indexes: [
      { accessor: 'by_offer', algorithm: 'btree', columns: ['offerId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    offerId: t.u64(),
    termId: t.u64(),
    valueA: t.string(),
    valueB: t.string(),
    previousValueA: t.string().default(''),
    previousValueB: t.string().default(''),
    previousCaptured: t.bool().default(false),
  }
);

const agent_proposal = table(
  {
    name: 'agent_proposal',
    public: true,
    indexes: [
      { accessor: 'by_negotiation', algorithm: 'btree', columns: ['negotiationId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    negotiationId: t.u64(),
    diagnosis: t.string(),
    proposalJson: t.string(),
    tradeoff: t.string(),
    reasoning: t.string(),
    status: t.string(),
    createdAt: t.timestamp(),
    acceptedByA: t.bool().default(false),
    acceptedByB: t.bool().default(false),
    decision: t.string().default('proceed'),
    concerns: t.string().default(''),
    requiredChanges: t.string().default(''),
    citationsJson: t.string().default('[]'),
    perspective: t.string().default('neutral'),
    requestedByPartyId: t.u64().default(0n),
  }
);

const mediator_message = table(
  {
    name: 'mediator_message',
    public: true,
    indexes: [{ accessor: 'by_negotiation', algorithm: 'btree', columns: ['negotiationId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    negotiationId: t.u64(),
    authorPartyId: t.u64(),
    body: t.string(),
    createdAt: t.timestamp(),
    speaker: t.string().default('party'),
    perspective: t.string().default('neutral'),
  }
);

const agreement_document = table(
  { name: 'agreement_document', public: true },
  {
    negotiationId: t.u64().primaryKey(),
    content: t.string(),
    updatedBy: t.identity(),
    updatedAt: t.timestamp(),
    lockedTerms: t.string().default(''),
    clauses: t.string().default(''),
    revision: t.u64().default(1n),
    acceptedByA: t.bool().default(false),
    acceptedByB: t.bool().default(false),
    acceptedRevisionA: t.u64().default(0n),
    acceptedRevisionB: t.u64().default(0n),
  }
);

const agreement_clause = table(
  {
    name: 'agreement_clause',
    public: true,
    indexes: [{ accessor: 'by_negotiation', algorithm: 'btree', columns: ['negotiationId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    negotiationId: t.u64(),
    title: t.string(),
    positionA: t.string(),
    positionB: t.string(),
    resolution: t.string(),
    status: t.string(),
    acceptedByA: t.bool(),
    acceptedByB: t.bool(),
    sortOrder: t.u32(),
    updatedAt: t.timestamp(),
  }
);

const agreement_revision = table(
  {
    name: 'agreement_revision',
    public: true,
    indexes: [{ accessor: 'by_negotiation', algorithm: 'btree', columns: ['negotiationId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    negotiationId: t.u64(),
    revision: t.u64(),
    content: t.string(),
    clauses: t.string(),
    changedBy: t.identity(),
    changedAt: t.timestamp(),
    source: t.string(),
    baseRevision: t.u64(),
    summary: t.string(),
  }
);

const agreement_draft = table(
  { name: 'agreement_draft', public: true },
  {
    negotiationId: t.u64().primaryKey(),
    baseRevision: t.u64(),
    content: t.string(),
    clauses: t.string(),
    summary: t.string(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
    status: t.string(),
  }
);

const support_document = table(
  {
    name: 'support_document',
    public: true,
    indexes: [{ accessor: 'by_negotiation', algorithm: 'btree', columns: ['negotiationId'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    negotiationId: t.u64(),
    name: t.string(),
    content: t.string(),
    uploadedBy: t.identity(),
    createdAt: t.timestamp(),
    mimeType: t.string().default('text/plain'),
    data: t.array(t.u8()).default([]),
  }
);

const event = table(
  {
    name: 'event',
    public: true,
    indexes: [
      { accessor: 'by_negotiation', algorithm: 'btree', columns: ['negotiationId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    negotiationId: t.u64(),
    actor: t.identity(),
    type: t.string(),
    payload: t.string(),
    createdAt: t.timestamp(),
  }
);

const presence = table(
  { name: 'presence', public: true },
  {
    identity: t.identity().primaryKey(),
    negotiationId: t.u64(),
    partyId: t.u64(),
    online: t.bool(),
  }
);

const spacetimedb = schema({
  negotiation,
  party,
  term,
  position,
  offer,
  offer_term,
  agent_proposal,
  mediator_message,
  agreement_document,
  agreement_clause,
  agreement_revision,
  agreement_draft,
  support_document,
  event,
  presence,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const JOIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeJoinCode(input: string): string {
  const parts = input.trim().split(/[/?#]/).filter(Boolean);
  return (parts[parts.length - 1] ?? input.trim()).toUpperCase();
}

function mintJoinCode(ctx: Ctx): string {
  for (let attempt = 0; attempt < 12; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += JOIN_ALPHABET[ctx.random.integerInRange(0, JOIN_ALPHABET.length - 1)]!;
    }
    if (!ctx.db.negotiation.joinCode.find(code)) {
      return code;
    }
  }
  throw new SenderError('Could not mint a unique join code');
}

function appendEvent(
  ctx: Ctx,
  negotiationId: bigint,
  type: string,
  payload: string
) {
  ctx.db.event.insert({
    id: 0n,
    negotiationId,
    actor: ctx.sender,
    type,
    payload,
    createdAt: ctx.timestamp,
  });
}

function requireNegotiation(ctx: Ctx, negotiationId: bigint) {
  const row = ctx.db.negotiation.id.find(negotiationId);
  if (!row) throw new SenderError('Negotiation not found');
  return row;
}

function partiesFor(ctx: Ctx, negotiationId: bigint) {
  return [...ctx.db.party.by_negotiation.filter(negotiationId)];
}

function findCallerParty(ctx: Ctx, negotiationId: bigint) {
  const parties = partiesFor(ctx, negotiationId);
  const mine = parties.find(
    p => p.identity !== undefined && p.identity.equals(ctx.sender)
  );
  if (!mine) throw new SenderError('You are not a party in this negotiation');
  return mine;
}

function currentLockedTerms(ctx: Ctx, negotiationId: bigint): string {
  const negotiation = ctx.db.negotiation.id.find(negotiationId);
  const parties = partiesFor(ctx, negotiationId);
  const partyA = parties.find(p => p.side === 'a');
  const partyB = parties.find(p => p.side === 'b');
  const terms = [...ctx.db.term.by_negotiation.filter(negotiationId)].sort((a, b) => a.sortOrder - b.sortOrder);
  const termLines = terms.map(term => {
    const positions = [...ctx.db.position.by_term.filter(term.id)];
    const valueA = positions.find(p => p.partyId === partyA?.id)?.value ?? '';
    const valueB = positions.find(p => p.partyId === partyB?.id)?.value ?? '';
    const value = valueA === valueB ? valueA : `Initiating: ${valueA} | Responding: ${valueB}`;
    return `- ${term.name}: ${value}`;
  });
  return [
    'RENTAL AGREEMENT',
    negotiation?.title ?? 'Rental matter',
    '',
    `Jurisdiction: ${negotiation?.jurisdictionCity ?? ''}, ${negotiation?.jurisdictionState ?? ''}, India`,
    `Premises type: ${negotiation?.propertyType ?? 'residential'}`,
    '',
    'PARTIES',
    `Initiating party: ${partyA?.label ?? 'Initiating party'}`,
    `Responding party: ${partyB?.label ?? 'Responding party'}`,
    '',
    'BACKGROUND',
    negotiation?.initialContext?.trim() || 'The parties negotiated the rental terms recorded below.',
    negotiation?.responderContext?.trim() ? `Responding party context: ${negotiation.responderContext.trim()}` : '',
    '',
    'AGREED RENTAL TERMS',
    ...termLines,
    '',
    'The parties agree to perform these terms in good faith, subject to the resolved clauses below.',
  ].filter(line => line !== '').join('\n');
}

function currentResolvedClauses(ctx: Ctx, negotiationId: bigint): string {
  return [...ctx.db.agreement_clause.by_negotiation.filter(negotiationId)]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(clause => `${clause.title}: ${clause.resolution}`)
    .join('\n');
}

function currentClauseSnapshot(ctx: Ctx, negotiationId: bigint): string {
  return JSON.stringify(
    [...ctx.db.agreement_clause.by_negotiation.filter(negotiationId)]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(clause => ({
        clauseId: String(clause.id),
        title: clause.title,
        text: clause.resolution,
      }))
  );
}

function renderAgreementContent(ctx: Ctx, negotiationId: bigint): string {
  const negotiation = ctx.db.negotiation.id.find(negotiationId);
  const parties = partiesFor(ctx, negotiationId);
  const partyA = parties.find(p => p.side === 'a');
  const partyB = parties.find(p => p.side === 'b');
  const clauses = [...ctx.db.agreement_clause.by_negotiation.filter(negotiationId)]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((clause, index) => [`${index + 1}. ${clause.title}`, clause.resolution.trim() || '[Draft clause pending]']);
  return [
    currentLockedTerms(ctx, negotiationId),
    '',
    'COMMON CLAUSES',
    ...clauses,
    '',
    'EXECUTION',
    `Initiating party (${partyA?.label ?? 'Initiating party'}) signature: ____________________    Date: __________`,
    `Responding party (${partyB?.label ?? 'Responding party'}) signature: ____________________    Date: __________`,
    negotiation?.status === 'agreed' ? '' : 'Working draft: this agreement is not final until both parties accept the same revision.',
  ].join('\n');
}

function appendAgreementRevision(
  ctx: Ctx,
  negotiationId: bigint,
  revision: bigint,
  content: string,
  clauses: string,
  source: string,
  baseRevision: bigint,
  summary: string
) {
  ctx.db.agreement_revision.insert({
    id: 0n,
    negotiationId,
    revision,
    content,
    clauses,
    changedBy: ctx.sender,
    changedAt: ctx.timestamp,
    source,
    baseRevision,
    summary,
  });
}

function ensureAgreementDocument(ctx: Ctx, negotiationId: bigint) {
  const existing = ctx.db.agreement_document.negotiationId.find(negotiationId);
  if (existing) {
    if ([...ctx.db.agreement_revision.by_negotiation.filter(negotiationId)].length === 0) {
      appendAgreementRevision(
        ctx,
        negotiationId,
        existing.revision,
        existing.content,
        existing.clauses.trim().startsWith('[') ? existing.clauses : currentClauseSnapshot(ctx, negotiationId),
        'migration',
        existing.revision,
        'Initial agreement revision'
      );
    }
    return;
  }
  {
    const lockedTerms = currentLockedTerms(ctx, negotiationId);
    const clauses = currentResolvedClauses(ctx, negotiationId);
    const content = renderAgreementContent(ctx, negotiationId);
    ctx.db.agreement_document.insert({
      negotiationId,
      content,
      lockedTerms,
      clauses,
      updatedBy: ctx.sender,
      updatedAt: ctx.timestamp,
      revision: 1n,
      acceptedByA: false,
      acceptedByB: false,
      acceptedRevisionA: 0n,
      acceptedRevisionB: 0n,
    });
    appendAgreementRevision(ctx, negotiationId, 1n, content, currentClauseSnapshot(ctx, negotiationId), 'system', 0n, 'Initial agreement revision');
  }
}

function clearAgreementAcceptance(ctx: Ctx, negotiationId: bigint) {
  const negotiation = ctx.db.negotiation.id.find(negotiationId);
  if (negotiation && (negotiation.acceptedByA || negotiation.acceptedByB)) {
    ctx.db.negotiation.id.update({ ...negotiation, acceptedByA: false, acceptedByB: false });
  }
  const document = ctx.db.agreement_document.negotiationId.find(negotiationId);
  if (document && (document.acceptedByA || document.acceptedByB)) {
    ctx.db.agreement_document.negotiationId.update({
      ...document,
      acceptedByA: false,
      acceptedByB: false,
      acceptedRevisionA: 0n,
      acceptedRevisionB: 0n,
    });
  }
}

function clearProposalAcceptance(ctx: Ctx, negotiationId: bigint, side: string) {
  for (const proposal of [...ctx.db.agent_proposal.by_negotiation.filter(negotiationId)]) {
    if (proposal.status !== 'pending') continue;
    ctx.db.agent_proposal.id.update({
      ...proposal,
      acceptedByA: side === 'a' ? false : proposal.acceptedByA,
      acceptedByB: side === 'b' ? false : proposal.acceptedByB,
    });
  }
}

function enforceOwnOfferValues(
  ctx: Ctx,
  negotiationId: bigint,
  side: string,
  terms: Array<{ termId: bigint; valueA: string; valueB: string }>
) {
  const parties = partiesFor(ctx, negotiationId);
  const opposingPartyId = parties.find(p => p.side !== side)?.id;
  for (const item of terms) {
    const term = ctx.db.term.id.find(item.termId);
    if (!term || term.negotiationId !== negotiationId) throw new SenderError('Offer contains an unknown term');
    const opposingPosition = [...ctx.db.position.by_term.filter(item.termId)].find(p => p.partyId === opposingPartyId);
    if (opposingPosition) {
      const opposingValue = side === 'a' ? item.valueB : item.valueA;
      if (opposingValue !== opposingPosition.value) {
        throw new SenderError('An offer can only change your party value');
      }
    }
  }
}

function applyOfferTerms(ctx: Ctx, offerId: bigint) {
  const parties = partiesFor(ctx, ctx.db.offer.id.find(offerId)?.negotiationId ?? 0n);
  const partyA = parties.find(p => p.side === 'a');
  const partyB = parties.find(p => p.side === 'b');
  if (!partyA || !partyB) throw new SenderError('Parties missing');
  for (const item of [...ctx.db.offer_term.by_offer.filter(offerId)]) {
    for (const position of [...ctx.db.position.by_term.filter(item.termId)]) {
      if (position.partyId === partyA.id) {
        ctx.db.position.id.update({ ...position, value: item.valueA, updatedAt: ctx.timestamp });
      } else if (position.partyId === partyB.id) {
        ctx.db.position.id.update({ ...position, value: item.valueB, updatedAt: ctx.timestamp });
      }
    }
  }
}

function identityEquals(
  left: { equals(other: typeof left): boolean } | undefined,
  right: { equals(other: typeof left): boolean }
) {
  return left !== undefined && left.equals(right);
}

export const init = spacetimedb.init(_ctx => {});

export const onConnect = spacetimedb.clientConnected(ctx => {
  const existing = ctx.db.presence.identity.find(ctx.sender);
  if (existing) {
    ctx.db.presence.identity.update({ ...existing, online: true });
    const p = ctx.db.party.id.find(existing.partyId);
    if (p) ctx.db.party.id.update({ ...p, online: true });
  }
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const existing = ctx.db.presence.identity.find(ctx.sender);
  if (existing) {
    ctx.db.presence.identity.update({ ...existing, online: false });
    const p = ctx.db.party.id.find(existing.partyId);
    if (p) ctx.db.party.id.update({ ...p, online: false });
  }
});

export const createNegotiation = spacetimedb.reducer(
  {
    title: t.string(),
    category: t.string(),
    partyALabel: t.string(),
    partyBLabel: t.string(),
    terms: t.array(TermSeed),
    supportingContext: t.string(),
    supportDocuments: t.array(SupportDocumentSeed),
    jurisdictionState: t.string(),
    jurisdictionCity: t.string(),
    propertyType: t.string(),
  },
  (ctx, { title, category, partyALabel, partyBLabel, terms, supportingContext, supportDocuments, jurisdictionState, jurisdictionCity, propertyType }) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) throw new SenderError('Title is required');
    if (terms.length === 0) throw new SenderError('Add at least one term');
    if (!jurisdictionState.trim() || !jurisdictionCity.trim()) throw new SenderError('State and city are required for legal context');
    if (!['residential', 'commercial'].includes(propertyType)) throw new SenderError('Property type must be residential or commercial');
    if (supportDocuments.length > 5) throw new SenderError('A matter can contain up to 5 supporting files');
    for (const seed of terms) {
      if (!['free_text', 'percentage', 'currency', 'number', 'date'].includes(seed.valueKind)) {
        throw new SenderError('Invalid term value format');
      }
      if (!['none', 'pair_sum', 'exact_match', 'range'].includes(seed.validationRule)) {
        throw new SenderError('Invalid term validation rule');
      }
      if ((seed.validationRule === 'pair_sum' || seed.validationRule === 'range') && !seed.validationTarget.trim()) {
        throw new SenderError(`Validation target is required for ${seed.name}`);
      }
    }

    const joinCode = mintJoinCode(ctx);
    const neg = ctx.db.negotiation.insert({
      id: 0n,
      joinCode,
      title: trimmedTitle,
      category: category.trim() || 'Custom',
      status: 'open',
      createdAt: ctx.timestamp,
      createdBy: ctx.sender,
      initialContext: supportingContext.trim(),
      acceptedByA: false,
      acceptedByB: false,
      definitionsConfirmedByA: true,
      definitionsConfirmedByB: false,
      jurisdictionState: jurisdictionState.trim(),
      jurisdictionCity: jurisdictionCity.trim(),
      propertyType,
      responderContext: '',
    });

    const partyA = ctx.db.party.insert({
      id: 0n,
      negotiationId: neg.id,
      side: 'a',
      label: partyALabel.trim() || 'Initiating party',
      identity: ctx.sender,
      online: true,
      labelConfirmed: true,
    });

    const partyB = ctx.db.party.insert({
      id: 0n,
      negotiationId: neg.id,
      side: 'b',
      label: partyBLabel.trim() || 'Responding party',
      identity: undefined,
      online: false,
      labelConfirmed: false,
    });

    ctx.db.presence.identity.delete(ctx.sender);
    ctx.db.presence.insert({
      identity: ctx.sender,
      negotiationId: neg.id,
      partyId: partyA.id,
      online: true,
    });

    terms.forEach((seed, index) => {
      const termRow = ctx.db.term.insert({
        id: 0n,
        negotiationId: neg.id,
        name: seed.name.trim() || `Term ${index + 1}`,
        sortOrder: index,
        valueKind: seed.valueKind.trim() || 'free_text',
        unit: seed.unit.trim(),
        validationRule: seed.validationRule.trim() || 'none',
        validationTarget: seed.validationTarget.trim(),
        mediatorPreference: seed.mediatorPreference.trim(),
      });
      ctx.db.position.insert({
        id: 0n,
        negotiationId: neg.id,
        partyId: partyA.id,
        termId: termRow.id,
        value: seed.valueA,
        reason: seed.reasonA,
        updatedAt: ctx.timestamp,
        initialValue: seed.valueA,
        initialReason: seed.reasonA,
      });
      ctx.db.position.insert({
        id: 0n,
        negotiationId: neg.id,
        partyId: partyB.id,
        termId: termRow.id,
        value: seed.valueB,
        reason: seed.reasonB,
        updatedAt: ctx.timestamp,
        initialValue: seed.valueB,
        initialReason: seed.reasonB,
      });
    });

    const defaultClauses = [
      ['Term and possession', 'The tenancy begins on [Commencement date] and continues for [Term]. Possession will be delivered subject to the agreed rental terms.'],
      ['Rent and payment', 'The tenant will pay the agreed rent of [Rent amount] on or before [Due date] by [Payment method]. Any late payment consequence must be agreed in writing and comply with applicable law.'],
      ['Security deposit', 'The security deposit is [Deposit amount]. Lawful deductions, if any, will be explained to the tenant and the balance will be returned within the agreed period after handover.'],
      ['Utilities and maintenance', 'The parties will pay utilities and perform maintenance responsibilities as recorded in the agreed rental terms. Each party will promptly notify the other of material issues.'],
      ['Permitted use and occupancy', 'The premises will be used only for lawful residential or commercial purposes agreed by the parties. Occupancy, pets, and house rules will follow the agreed terms.'],
      ['Repairs and alterations', 'The tenant will not make material alterations without written consent. Each party will handle repairs assigned to it under the agreed terms and applicable law.'],
      ['Inspection and access', 'The landlord may access the premises for lawful inspection, repairs, or emergencies with reasonable notice except where immediate access is necessary to prevent harm.'],
      ['Subletting and assignment', 'The tenant will not sublet, license, or assign the premises without the consent required by the agreed terms and applicable law.'],
      ['Default, termination, and handover', 'A party will give the agreed notice of termination and a reasonable opportunity to cure a remediable default. On termination, the tenant will return possession and keys subject to a documented handover.'],
      ['Dispute resolution', 'The parties will first return to Settle to document any disagreement and attempt a good-faith resolution before pursuing other remedies.'],
      ['Governing law and registration', `This agreement is subject to the laws applicable in ${jurisdictionState.trim()}, India. The parties will address stamp duty and registration obligations that apply to the premises and term.`],
      ['General provisions and signatures', 'Any amendment must be made in writing and accepted by both parties. The parties will sign below after reviewing the complete agreement.'],
    ];
    defaultClauses.forEach(([title, text], index) => {
      ctx.db.agreement_clause.insert({
        id: 0n,
        negotiationId: neg.id,
        title,
        positionA: text,
        positionB: text,
        resolution: text,
        status: 'resolved',
        acceptedByA: true,
        acceptedByB: true,
        sortOrder: index,
        updatedAt: ctx.timestamp,
      });
    });

    ensureAgreementDocument(ctx, neg.id);

    if (supportingContext.trim()) {
      ctx.db.support_document.insert({
        id: 0n,
        negotiationId: neg.id,
        name: 'Initial matter context',
        content: supportingContext.trim(),
        uploadedBy: ctx.sender,
        createdAt: ctx.timestamp,
        mimeType: 'text/plain',
        data: [],
      });
    }

    for (const document of supportDocuments) {
      if (!document.name.trim()) continue;
      if (document.data.length > 2_000_000) throw new SenderError(`${document.name} is larger than the 2 MB limit`);
      ctx.db.support_document.insert({
        id: 0n,
        negotiationId: neg.id,
        name: document.name.trim().slice(0, 200),
        content: document.content.slice(0, 100000),
        uploadedBy: ctx.sender,
        createdAt: ctx.timestamp,
        mimeType: document.mimeType.trim() || 'application/octet-stream',
        data: document.data.slice(0, 2_000_000),
      });
    }

    appendEvent(ctx, neg.id, 'created', JSON.stringify({ joinCode, title: trimmedTitle }));
  }
);

export const joinNegotiation = spacetimedb.reducer(
  { joinCode: t.string() },
  (ctx, { joinCode }) => {
    const code = normalizeJoinCode(joinCode);
    const neg = ctx.db.negotiation.joinCode.find(code);
    if (!neg) throw new SenderError('Invalid join code');
    if (neg.status === 'agreed' || neg.status === 'abandoned') {
      throw new SenderError('This negotiation is closed');
    }

    const parties = partiesFor(ctx, neg.id);
    const already = parties.find(p => identityEquals(p.identity, ctx.sender));
    if (already) {
      ctx.db.party.id.update({ ...already, online: true });
      ctx.db.presence.identity.delete(ctx.sender);
      ctx.db.presence.insert({
        identity: ctx.sender,
        negotiationId: neg.id,
        partyId: already.id,
        online: true,
      });
      appendEvent(ctx, neg.id, 'rejoined', JSON.stringify({ partyId: String(already.id) }));
      return;
    }

    const openSeat =
      parties.find(p => p.side === 'b' && p.identity === undefined) ??
      parties.find(p => p.side === 'b' && p.identity !== undefined && !p.online && !p.labelConfirmed) ??
      parties.find(p => p.identity === undefined);
    if (!openSeat) throw new SenderError('Both parties are already seated');

    ctx.db.party.id.update({
      ...openSeat,
      identity: ctx.sender,
      online: true,
      label: openSeat.side === 'b' ? 'Responding party' : openSeat.label,
      labelConfirmed: openSeat.side === 'b' ? false : openSeat.labelConfirmed,
    });
    ctx.db.presence.identity.delete(ctx.sender);
    ctx.db.presence.insert({
      identity: ctx.sender,
      negotiationId: neg.id,
      partyId: openSeat.id,
      online: true,
    });
    appendEvent(ctx, neg.id, 'joined', JSON.stringify({ partyId: String(openSeat.id), side: openSeat.side }));
  }
);

export const setPosition = spacetimedb.reducer(
  { positionId: t.u64(), value: t.string() },
  (ctx, { positionId, value }) => {
    const row = ctx.db.position.id.find(positionId);
    if (!row) throw new SenderError('Position not found');
    const caller = findCallerParty(ctx, row.negotiationId);
    if (caller.id !== row.partyId) {
      throw new SenderError('You can only edit your party positions');
    }
    if (row.initialValue.trim() || row.value.trim()) {
      throw new SenderError('Opening value is already recorded; use an offer to update it');
    }
    const neg = requireNegotiation(ctx, row.negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Deal already finalized');
    clearAgreementAcceptance(ctx, row.negotiationId);
    clearProposalAcceptance(ctx, row.negotiationId, caller.side);

    ctx.db.position.id.update({
      ...row,
      value,
      initialValue: row.initialValue || row.value || value,
      updatedAt: ctx.timestamp,
    });
    appendEvent(
      ctx,
      row.negotiationId,
      'position_updated',
      JSON.stringify({ positionId: String(positionId), value })
    );
  }
);

export const setReason = spacetimedb.reducer(
  { positionId: t.u64(), reason: t.string() },
  (ctx, { positionId, reason }) => {
    const row = ctx.db.position.id.find(positionId);
    if (!row) throw new SenderError('Position not found');
    const caller = findCallerParty(ctx, row.negotiationId);
    if (caller.id !== row.partyId) {
      throw new SenderError('You can only edit your party reasons');
    }
    if (row.initialReason.trim() || row.reason.trim()) {
      throw new SenderError('Opening reason is already recorded; use an offer to update it');
    }
    const neg = requireNegotiation(ctx, row.negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Deal already finalized');
    clearAgreementAcceptance(ctx, row.negotiationId);
    clearProposalAcceptance(ctx, row.negotiationId, caller.side);

    ctx.db.position.id.update({
      ...row,
      reason,
      initialReason: row.initialReason || row.reason || reason,
      updatedAt: ctx.timestamp,
    });
    appendEvent(
      ctx,
      row.negotiationId,
      'reason_updated',
      JSON.stringify({ positionId: String(positionId) })
    );
  }
);

export const makeOffer = spacetimedb.reducer(
  {
    negotiationId: t.u64(),
    note: t.string(),
    terms: t.array(OfferTermInput),
  },
  (ctx, { negotiationId, note, terms }) => {
    const neg = requireNegotiation(ctx, negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Deal already finalized');
    const caller = findCallerParty(ctx, negotiationId);
    if (terms.length === 0) throw new SenderError('Offer needs at least one term');
    clearAgreementAcceptance(ctx, negotiationId);
    enforceOwnOfferValues(ctx, negotiationId, caller.side, terms);

    for (const pending of [...ctx.db.offer.by_negotiation.filter(negotiationId)]) {
      if (pending.status === 'pending') {
        ctx.db.offer.id.update({ ...pending, status: 'superseded' });
      }
    }

    const offerRow = ctx.db.offer.insert({
      id: 0n,
      negotiationId,
      createdByPartyId: caller.id,
      status: 'pending',
      note,
      createdAt: ctx.timestamp,
      acceptedByA: caller.side === 'a',
      acceptedByB: caller.side === 'b',
    });

    for (const item of terms) {
      const positions = [...ctx.db.position.by_term.filter(item.termId)];
      const previousA = positions.find(position => position.partyId === partiesFor(ctx, negotiationId).find(p => p.side === 'a')?.id)?.value ?? '';
      const previousB = positions.find(position => position.partyId === partiesFor(ctx, negotiationId).find(p => p.side === 'b')?.id)?.value ?? '';
      ctx.db.offer_term.insert({
        id: 0n,
        offerId: offerRow.id,
        termId: item.termId,
        valueA: item.valueA,
        valueB: item.valueB,
        previousValueA: previousA,
        previousValueB: previousB,
        previousCaptured: true,
      });
    }

    applyOfferTerms(ctx, offerRow.id);

    ctx.db.negotiation.id.update({ ...neg, status: 'proposed' });
    appendEvent(
      ctx,
      negotiationId,
      'offer_made',
      JSON.stringify({ offerId: String(offerRow.id), note })
    );
  }
);

export const counterOffer = spacetimedb.reducer(
  {
    negotiationId: t.u64(),
    note: t.string(),
    terms: t.array(OfferTermInput),
  },
  (ctx, args) => {
    // Same mutation path as make_offer; named separately for event clarity in UI.
    const neg = requireNegotiation(ctx, args.negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Deal already finalized');
    const caller = findCallerParty(ctx, args.negotiationId);
    if (args.terms.length === 0) throw new SenderError('Offer needs at least one term');
    clearAgreementAcceptance(ctx, args.negotiationId);
    enforceOwnOfferValues(ctx, args.negotiationId, caller.side, args.terms);

    for (const pending of [...ctx.db.offer.by_negotiation.filter(args.negotiationId)]) {
      if (pending.status === 'pending') {
        ctx.db.offer.id.update({ ...pending, status: 'superseded' });
      }
    }

    const offerRow = ctx.db.offer.insert({
      id: 0n,
      negotiationId: args.negotiationId,
      createdByPartyId: caller.id,
      status: 'pending',
      note: args.note,
      createdAt: ctx.timestamp,
      acceptedByA: caller.side === 'a',
      acceptedByB: caller.side === 'b',
    });

    for (const item of args.terms) {
      const positions = [...ctx.db.position.by_term.filter(item.termId)];
      const previousA = positions.find(position => position.partyId === partiesFor(ctx, args.negotiationId).find(p => p.side === 'a')?.id)?.value ?? '';
      const previousB = positions.find(position => position.partyId === partiesFor(ctx, args.negotiationId).find(p => p.side === 'b')?.id)?.value ?? '';
      ctx.db.offer_term.insert({
        id: 0n,
        offerId: offerRow.id,
        termId: item.termId,
        valueA: item.valueA,
        valueB: item.valueB,
        previousValueA: previousA,
        previousValueB: previousB,
        previousCaptured: true,
      });
    }

    applyOfferTerms(ctx, offerRow.id);

    ctx.db.negotiation.id.update({ ...neg, status: 'proposed' });
    appendEvent(
      ctx,
      args.negotiationId,
      'counter_offer',
      JSON.stringify({ offerId: String(offerRow.id), note: args.note })
    );
  }
);

export const acceptOffer = spacetimedb.reducer(
  { offerId: t.u64() },
  (ctx, { offerId }) => {
    const offerRow = ctx.db.offer.id.find(offerId);
    if (!offerRow) throw new SenderError('Offer not found');
    if (offerRow.status !== 'pending') throw new SenderError('Offer is not pending');
    const caller = findCallerParty(ctx, offerRow.negotiationId);
    const parties = partiesFor(ctx, offerRow.negotiationId);
    const creator = parties.find(p => p.id === offerRow.createdByPartyId);
    const acceptedByA = offerRow.acceptedByA || caller.side === 'a' || creator?.side === 'a';
    const acceptedByB = offerRow.acceptedByB || caller.side === 'b' || creator?.side === 'b';
    ctx.db.offer.id.update({ ...offerRow, acceptedByA, acceptedByB });
    if (!acceptedByA || !acceptedByB) {
      appendEvent(ctx, offerRow.negotiationId, 'offer_accepted', JSON.stringify({ offerId: String(offerId), side: caller.side }));
      return;
    }

    const partyA = parties.find(p => p.side === 'a');
    const partyB = parties.find(p => p.side === 'b');
    if (!partyA || !partyB) throw new SenderError('Parties missing');

    for (const ot of [...ctx.db.offer_term.by_offer.filter(offerId)]) {
      for (const pos of [...ctx.db.position.by_term.filter(ot.termId)]) {
        if (pos.partyId === partyA.id) {
          ctx.db.position.id.update({
            ...pos,
            value: ot.valueA,
            updatedAt: ctx.timestamp,
          });
        } else if (pos.partyId === partyB.id) {
          ctx.db.position.id.update({
            ...pos,
            value: ot.valueB,
            updatedAt: ctx.timestamp,
          });
        }
      }
    }

    ctx.db.offer.id.update({ ...offerRow, status: 'accepted', acceptedByA, acceptedByB });
    const neg = requireNegotiation(ctx, offerRow.negotiationId);
    ctx.db.negotiation.id.update({ ...neg, status: 'proposed', acceptedByA: false, acceptedByB: false });
    appendEvent(
      ctx,
      offerRow.negotiationId,
      'offer_accepted',
      JSON.stringify({ offerId: String(offerId) })
    );
    appendEvent(
      ctx,
      offerRow.negotiationId,
      'latest_terms_updated',
      JSON.stringify({ source: 'offer', offerId: String(offerId) })
    );
  }
);

export const rejectOffer = spacetimedb.reducer(
  { offerId: t.u64() },
  (ctx, { offerId }) => {
    const offerRow = ctx.db.offer.id.find(offerId);
    if (!offerRow) throw new SenderError('Offer not found');
    if (offerRow.status !== 'pending') throw new SenderError('Offer is not pending');
    findCallerParty(ctx, offerRow.negotiationId);

    for (const item of [...ctx.db.offer_term.by_offer.filter(offerId)]) {
      if (!item.previousCaptured) continue;
      for (const position of [...ctx.db.position.by_term.filter(item.termId)]) {
        const party = partiesFor(ctx, offerRow.negotiationId).find(p => p.id === position.partyId);
        if (party?.side === 'a') {
          ctx.db.position.id.update({ ...position, value: item.previousValueA, updatedAt: ctx.timestamp });
        } else if (party?.side === 'b') {
          ctx.db.position.id.update({ ...position, value: item.previousValueB, updatedAt: ctx.timestamp });
        }
      }
    }

    ctx.db.offer.id.update({ ...offerRow, status: 'rejected' });
    const neg = requireNegotiation(ctx, offerRow.negotiationId);
    if (neg.status === 'proposed') {
      ctx.db.negotiation.id.update({ ...neg, status: 'open' });
    }
    appendEvent(
      ctx,
      offerRow.negotiationId,
      'offer_rejected',
      JSON.stringify({ offerId: String(offerId) })
    );
  }
);

export const submitAgentProposal = spacetimedb.reducer(
  {
    negotiationId: t.u64(),
    diagnosis: t.string(),
    proposalJson: t.string(),
    tradeoff: t.string(),
    reasoning: t.string(),
    decision: t.string(),
    concerns: t.string(),
    requiredChanges: t.string(),
    citationsJson: t.string(),
    perspective: t.string(),
    requestedByPartyId: t.u64(),
  },
  (ctx, { negotiationId, diagnosis, proposalJson, tradeoff, reasoning, decision, concerns, requiredChanges, citationsJson, perspective, requestedByPartyId }) => {
    requireNegotiation(ctx, negotiationId);
    findCallerParty(ctx, negotiationId);
    if (!['proceed', 'caution', 'block', 'human_review'].includes(decision)) {
      throw new SenderError('Invalid mediator decision');
    }

    for (const existing of [...ctx.db.agent_proposal.by_negotiation.filter(negotiationId)]) {
      if (existing.status === 'pending') {
        ctx.db.agent_proposal.id.update({ ...existing, status: 'superseded' });
      }
    }

    const proposal = ctx.db.agent_proposal.insert({
      id: 0n,
      negotiationId,
      diagnosis,
      proposalJson,
      tradeoff,
      reasoning,
      status: 'pending',
      createdAt: ctx.timestamp,
      acceptedByA: false,
      acceptedByB: false,
      decision,
      concerns,
      requiredChanges,
      citationsJson,
      perspective,
      requestedByPartyId,
    });

    appendEvent(
      ctx,
      negotiationId,
      'agent_proposal',
      JSON.stringify({ proposalId: String(proposal.id) })
    );
    ctx.db.mediator_message.insert({
      id: 0n,
      negotiationId,
      authorPartyId: 0n,
      body: diagnosis,
      createdAt: ctx.timestamp,
      speaker: 'system',
      perspective,
    });
  }
);

export const acceptProposal = spacetimedb.reducer(
  { proposalId: t.u64() },
  (ctx, { proposalId }) => {
    const proposal = ctx.db.agent_proposal.id.find(proposalId);
    if (!proposal) throw new SenderError('Proposal not found');
    if (proposal.status !== 'pending') throw new SenderError('Proposal is not pending');
    if (proposal.decision === 'block' || proposal.decision === 'human_review') {
      throw new SenderError('This matter requires clarification or human legal review before acceptance');
    }
    const caller = findCallerParty(ctx, proposal.negotiationId);
    if (proposal.requestedByPartyId !== 0n && !proposal.acceptedByA && !proposal.acceptedByB && caller.id !== proposal.requestedByPartyId) {
      throw new SenderError('The party who asked the mediator must review this proposal first');
    }

    let items: Array<{ termId: string; valueA: string; valueB: string }> = [];
    try {
      const parsed = JSON.parse(proposal.proposalJson) as {
        terms?: Array<{ termId: string | number; valueA: string; valueB: string }>;
      };
      items = (parsed.terms ?? []).map(t => ({
        termId: String(t.termId),
        valueA: t.valueA,
        valueB: t.valueB,
      }));
    } catch {
      throw new SenderError('Invalid proposal payload');
    }

    const parties = partiesFor(ctx, proposal.negotiationId);
    const partyA = parties.find(p => p.side === 'a');
    const partyB = parties.find(p => p.side === 'b');
    if (!partyA || !partyB) throw new SenderError('Parties missing');

    const acceptedByA = proposal.acceptedByA || caller.side === 'a';
    const acceptedByB = proposal.acceptedByB || caller.side === 'b';
    ctx.db.agent_proposal.id.update({
      ...proposal,
      acceptedByA,
      acceptedByB,
    });
    if (!acceptedByA || !acceptedByB) {
      for (const item of items) {
        const termId = BigInt(item.termId);
        for (const pos of [...ctx.db.position.by_term.filter(termId)]) {
          if ((caller.side === 'a' && pos.partyId === partyA.id) || (caller.side === 'b' && pos.partyId === partyB.id)) {
            const nextValue = caller.side === 'a' ? item.valueA : item.valueB;
            ctx.db.position.id.update({
              ...pos,
              value: nextValue,
              initialValue: pos.initialValue || pos.value || nextValue,
              updatedAt: ctx.timestamp,
            });
          }
        }
      }
      appendEvent(ctx, proposal.negotiationId, 'proposal_accepted', JSON.stringify({
        proposalId: String(proposalId),
        side: caller.side,
      }));
      return;
    }

    for (const item of items) {
      const termId = BigInt(item.termId);
      for (const pos of [...ctx.db.position.by_term.filter(termId)]) {
        if (pos.partyId === partyA.id) {
          ctx.db.position.id.update({ ...pos, value: item.valueA, updatedAt: ctx.timestamp });
        } else if (pos.partyId === partyB.id) {
          ctx.db.position.id.update({ ...pos, value: item.valueB, updatedAt: ctx.timestamp });
        }
      }
    }

    ctx.db.agent_proposal.id.update({ ...proposal, acceptedByA, acceptedByB, status: 'accepted' });
    const neg = requireNegotiation(ctx, proposal.negotiationId);
    ctx.db.negotiation.id.update({ ...neg, status: 'proposed', acceptedByA: false, acceptedByB: false });
    appendEvent(
      ctx,
      proposal.negotiationId,
      'proposal_accepted',
      JSON.stringify({ proposalId: String(proposalId) })
    );
  }
);

export const rejectProposal = spacetimedb.reducer(
  { proposalId: t.u64() },
  (ctx, { proposalId }) => {
    const proposal = ctx.db.agent_proposal.id.find(proposalId);
    if (!proposal) throw new SenderError('Proposal not found');
    if (proposal.status !== 'pending') throw new SenderError('Proposal is not pending');
    findCallerParty(ctx, proposal.negotiationId);

    ctx.db.agent_proposal.id.update({ ...proposal, status: 'rejected' });
    appendEvent(
      ctx,
      proposal.negotiationId,
      'proposal_rejected',
      JSON.stringify({ proposalId: String(proposalId) })
    );
  }
);

export const finalizeDeal = spacetimedb.reducer(
  { negotiationId: t.u64() },
  (ctx, { negotiationId }) => {
    const neg = requireNegotiation(ctx, negotiationId);
    const parties = partiesFor(ctx, negotiationId);
    if (parties.some(p => p.identity === undefined)) {
      throw new SenderError('Both parties must join before finalizing');
    }
    if (!neg.acceptedByA || !neg.acceptedByB) {
      throw new SenderError('Both parties must accept the latest terms');
    }
    if (!neg.definitionsConfirmedByA || !neg.definitionsConfirmedByB) {
      throw new SenderError('Both parties must confirm the term definitions');
    }
    const document = ctx.db.agreement_document.negotiationId.find(negotiationId);
    if (!document || !document.acceptedByA || !document.acceptedByB || document.acceptedRevisionA !== document.revision || document.acceptedRevisionB !== document.revision) {
      throw new SenderError('Both parties must accept the current agreement revision');
    }
    ctx.db.negotiation.id.update({ ...neg, status: 'agreed' });
    ensureAgreementDocument(ctx, negotiationId);
    appendEvent(ctx, negotiationId, 'finalized', '{}');
  }
);

export const acceptCurrentTerms = spacetimedb.reducer(
  { negotiationId: t.u64() },
  (ctx, { negotiationId }) => {
    const neg = requireNegotiation(ctx, negotiationId);
    const caller = findCallerParty(ctx, negotiationId);
    if (!neg.definitionsConfirmedByA || !neg.definitionsConfirmedByB) {
      throw new SenderError('Both parties must confirm the term definition');
    }
    const document = ctx.db.agreement_document.negotiationId.find(negotiationId);
    if (!document) throw new SenderError('Open the working agreement before accepting it');
    if ([...ctx.db.agreement_clause.by_negotiation.filter(negotiationId)].some(clause => clause.resolution.trim().length < 3)) {
      throw new SenderError('Every clause needs shared wording before accepting the agreement');
    }
    const acceptedByA = document.acceptedByA || caller.side === 'a';
    const acceptedByB = document.acceptedByB || caller.side === 'b';
    const acceptedRevisionA = caller.side === 'a' ? document.revision : document.acceptedRevisionA;
    const acceptedRevisionB = caller.side === 'b' ? document.revision : document.acceptedRevisionB;
    ctx.db.agreement_document.negotiationId.update({
      ...document,
      acceptedByA,
      acceptedByB,
      acceptedRevisionA,
      acceptedRevisionB,
      ...(acceptedByA && acceptedByB ? {
        lockedTerms: currentLockedTerms(ctx, negotiationId),
      } : {}),
    });
    if (acceptedByA && acceptedByB && acceptedRevisionA === document.revision && acceptedRevisionB === document.revision) {
      ctx.db.negotiation.id.update({ ...neg, status: 'agreed', acceptedByA: true, acceptedByB: true });
    } else {
      ctx.db.negotiation.id.update({ ...neg, status: 'proposed', acceptedByA: false, acceptedByB: false });
    }
    appendEvent(ctx, negotiationId, 'terms_accepted', JSON.stringify({ side: caller.side }));
  }
);

export const updateClausePosition = spacetimedb.reducer(
  { clauseId: t.u64(), text: t.string() },
  (ctx, { clauseId, text }) => {
    const clause = ctx.db.agreement_clause.id.find(clauseId);
    if (!clause) throw new SenderError('Clause not found');
    const neg = requireNegotiation(ctx, clause.negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Agreement is locked');
    const caller = findCallerParty(ctx, clause.negotiationId);
    const nextA = caller.side === 'a' ? text : clause.positionA;
    const nextB = caller.side === 'b' ? text : clause.positionB;
    const same = nextA.trim() !== '' && nextA.trim() === nextB.trim();
    ctx.db.agreement_clause.id.update({
      ...clause,
      positionA: nextA,
      positionB: nextB,
      resolution: same ? nextA : '',
      status: same ? 'resolved' : 'conflict',
      acceptedByA: same,
      acceptedByB: same,
      updatedAt: ctx.timestamp,
    });
    appendEvent(ctx, clause.negotiationId, 'clause_updated', JSON.stringify({ clauseId: String(clauseId), side: caller.side }));
  }
);

export const setClauseResolution = spacetimedb.reducer(
  { clauseId: t.u64(), resolution: t.string() },
  (ctx, { clauseId, resolution }) => {
    const clause = ctx.db.agreement_clause.id.find(clauseId);
    if (!clause) throw new SenderError('Clause not found');
    const neg = requireNegotiation(ctx, clause.negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Agreement is locked');
    findCallerParty(ctx, clause.negotiationId);
    const trimmed = resolution.trim();
    if (trimmed.length < 3) throw new SenderError('Resolution must be at least 3 characters');
    ctx.db.agreement_clause.id.update({
      ...clause,
      resolution: trimmed,
      status: 'proposed',
      acceptedByA: false,
      acceptedByB: false,
      updatedAt: ctx.timestamp,
    });
    appendEvent(ctx, clause.negotiationId, 'clause_resolution_proposed', JSON.stringify({ clauseId: String(clauseId) }));
  }
);

export const acceptClauseResolution = spacetimedb.reducer(
  { clauseId: t.u64() },
  (ctx, { clauseId }) => {
    const clause = ctx.db.agreement_clause.id.find(clauseId);
    if (!clause) throw new SenderError('Clause not found');
    const neg = requireNegotiation(ctx, clause.negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Agreement is locked');
    const caller = findCallerParty(ctx, clause.negotiationId);
    if (clause.status !== 'proposed' || clause.resolution.trim().length < 3) {
      throw new SenderError('A mediator resolution is required first');
    }
    const acceptedByA = clause.acceptedByA || caller.side === 'a';
    const acceptedByB = clause.acceptedByB || caller.side === 'b';
    ctx.db.agreement_clause.id.update({ ...clause, acceptedByA, acceptedByB, status: acceptedByA && acceptedByB ? 'resolved' : 'proposed', updatedAt: ctx.timestamp });
    appendEvent(ctx, clause.negotiationId, 'clause_resolution_accepted', JSON.stringify({ clauseId: String(clauseId), side: caller.side }));
  }
);

export const sendMediatorMessage = spacetimedb.reducer(
  { negotiationId: t.u64(), body: t.string() },
  (ctx, { negotiationId, body }) => {
    requireNegotiation(ctx, negotiationId);
    const caller = findCallerParty(ctx, negotiationId);
    const trimmed = body.trim();
    if (!trimmed) throw new SenderError('Message cannot be empty');
    if (trimmed.length > 2000) throw new SenderError('Message is too long');
    ctx.db.mediator_message.insert({
      id: 0n,
      negotiationId,
      authorPartyId: caller.id,
      body: trimmed,
      createdAt: ctx.timestamp,
      speaker: caller.side === 'a' ? 'initiator' : 'responder',
      perspective: 'party',
    });
    appendEvent(ctx, negotiationId, 'mediator_message', JSON.stringify({ partyId: String(caller.id) }));
  }
);

export const setPartyContext = spacetimedb.reducer(
  { negotiationId: t.u64(), context: t.string() },
  (ctx, { negotiationId, context }) => {
    const negotiation = requireNegotiation(ctx, negotiationId);
    if (negotiation.status === 'agreed') throw new SenderError('Deal already finalized');
    const caller = findCallerParty(ctx, negotiationId);
    if (context.length > 100000) throw new SenderError('Context is too large');
    if (caller.side !== 'b') throw new SenderError('Only the responding party can update this context');
    clearAgreementAcceptance(ctx, negotiationId);
    ctx.db.negotiation.id.update({ ...negotiation, responderContext: context.trim() });
    appendEvent(ctx, negotiationId, 'responder_context_updated', '{}');
  }
);

export const updateAgreementDocument = spacetimedb.reducer(
  { negotiationId: t.u64(), content: t.string(), expectedRevision: t.u64() },
  (ctx, { negotiationId, content, expectedRevision }) => {
    const neg = requireNegotiation(ctx, negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Agreement is locked after both parties agree');
    findCallerParty(ctx, negotiationId);
    if (content.length > 100000) throw new SenderError('Document is too large');
    ensureAgreementDocument(ctx, negotiationId);
    const existing = ctx.db.agreement_document.negotiationId.find(negotiationId);
    if (!existing) throw new SenderError('Agreement document not found');
    if (existing.revision !== expectedRevision) throw new SenderError('Agreement changed remotely. Reload before saving.');
    clearAgreementAcceptance(ctx, negotiationId);
    const nextRevision = existing.revision + 1n;
    ctx.db.agreement_document.negotiationId.update({
      ...existing,
      content,
      updatedBy: ctx.sender,
      updatedAt: ctx.timestamp,
      revision: nextRevision,
      acceptedByA: false,
      acceptedByB: false,
      acceptedRevisionA: 0n,
      acceptedRevisionB: 0n,
    });
    appendAgreementRevision(ctx, negotiationId, nextRevision, content, existing.clauses, 'manual', existing.revision, 'Agreement text updated');
    appendEvent(ctx, negotiationId, 'agreement_revision_created', JSON.stringify({ revision: String(nextRevision), source: 'manual' }));
  }
);

export const updateAgreementClause = spacetimedb.reducer(
  { clauseId: t.u64(), text: t.string(), expectedRevision: t.u64() },
  (ctx, { clauseId, text, expectedRevision }) => {
    const clause = ctx.db.agreement_clause.id.find(clauseId);
    if (!clause) throw new SenderError('Clause not found');
    const neg = requireNegotiation(ctx, clause.negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Agreement is locked');
    findCallerParty(ctx, clause.negotiationId);
    const document = ctx.db.agreement_document.negotiationId.find(clause.negotiationId);
    if (!document) throw new SenderError('Agreement document not found');
    if (document.revision !== expectedRevision) throw new SenderError('Agreement changed remotely. Reload before saving.');
    const trimmed = text.trim();
    if (trimmed.length > 20000) throw new SenderError('Clause is too large');
    clearAgreementAcceptance(ctx, clause.negotiationId);
    ctx.db.agreement_clause.id.update({
      ...clause,
      resolution: trimmed,
      status: trimmed ? 'resolved' : 'draft',
      acceptedByA: false,
      acceptedByB: false,
      updatedAt: ctx.timestamp,
    });
    const nextRevision = document.revision + 1n;
    const content = renderAgreementContent(ctx, clause.negotiationId);
    const clauses = currentResolvedClauses(ctx, clause.negotiationId);
    const snapshot = currentClauseSnapshot(ctx, clause.negotiationId);
    ctx.db.agreement_document.negotiationId.update({
      ...document,
      content,
      clauses,
      updatedBy: ctx.sender,
      updatedAt: ctx.timestamp,
      revision: nextRevision,
      acceptedByA: false,
      acceptedByB: false,
      acceptedRevisionA: 0n,
      acceptedRevisionB: 0n,
    });
    appendAgreementRevision(ctx, clause.negotiationId, nextRevision, content, snapshot, 'manual', document.revision, `Clause updated: ${clause.title}`);
    appendEvent(ctx, clause.negotiationId, 'agreement_revision_created', JSON.stringify({ revision: String(nextRevision), source: 'manual', clauseId: String(clauseId) }));
  }
);

export const saveAgreementDraft = spacetimedb.reducer(
  { negotiationId: t.u64(), baseRevision: t.u64(), content: t.string(), clauses: t.string(), summary: t.string() },
  (ctx, { negotiationId, baseRevision, content, clauses, summary }) => {
    const neg = requireNegotiation(ctx, negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Agreement is locked');
    findCallerParty(ctx, negotiationId);
    const document = ctx.db.agreement_document.negotiationId.find(negotiationId);
    if (!document) throw new SenderError('Agreement document not found');
    if (baseRevision !== document.revision) throw new SenderError('This AI draft is based on an older agreement revision.');
    if (content.length > 100000 || clauses.length > 100000) throw new SenderError('AI draft is too large');
    try {
      const parsed = JSON.parse(clauses) as unknown;
      if (!Array.isArray(parsed)) throw new Error('not an array');
    } catch {
      throw new SenderError('AI draft clauses are invalid');
    }
    const existing = ctx.db.agreement_draft.negotiationId.find(negotiationId);
    const draft = {
      negotiationId,
      baseRevision,
      content,
      clauses,
      summary: summary.trim(),
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      status: 'pending',
    };
    if (existing) ctx.db.agreement_draft.negotiationId.update(draft);
    else ctx.db.agreement_draft.insert(draft);
    appendEvent(ctx, negotiationId, 'agreement_draft_created', JSON.stringify({ baseRevision: String(baseRevision) }));
  }
);

export const applyAgreementDraft = spacetimedb.reducer(
  { negotiationId: t.u64(), expectedRevision: t.u64() },
  (ctx, { negotiationId, expectedRevision }) => {
    const neg = requireNegotiation(ctx, negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Agreement is locked');
    findCallerParty(ctx, negotiationId);
    const document = ctx.db.agreement_document.negotiationId.find(negotiationId);
    const draft = ctx.db.agreement_draft.negotiationId.find(negotiationId);
    if (!document || !draft) throw new SenderError('AI draft not found');
    if (document.revision !== expectedRevision || draft.baseRevision !== expectedRevision) {
      throw new SenderError('Agreement changed since this AI draft was generated. Generate a new draft.');
    }
    clearAgreementAcceptance(ctx, negotiationId);
    const nextRevision = document.revision + 1n;
    const content = draft.content;
    const clauses = draft.clauses;
    ctx.db.agreement_document.negotiationId.update({
      ...document,
      content,
      clauses,
      updatedBy: ctx.sender,
      updatedAt: ctx.timestamp,
      revision: nextRevision,
      acceptedByA: false,
      acceptedByB: false,
      acceptedRevisionA: 0n,
      acceptedRevisionB: 0n,
    });
    ctx.db.agreement_draft.negotiationId.update({ ...draft, status: 'applied' });
    appendAgreementRevision(ctx, negotiationId, nextRevision, content, clauses, 'ai', document.revision, draft.summary || 'AI agreement draft applied');
    appendEvent(ctx, negotiationId, 'agreement_revision_created', JSON.stringify({ revision: String(nextRevision), source: 'ai' }));
  }
);

export const restoreAgreementRevision = spacetimedb.reducer(
  { negotiationId: t.u64(), revisionId: t.u64(), expectedRevision: t.u64() },
  (ctx, { negotiationId, revisionId, expectedRevision }) => {
    const neg = requireNegotiation(ctx, negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Agreement is locked');
    findCallerParty(ctx, negotiationId);
    const document = ctx.db.agreement_document.negotiationId.find(negotiationId);
    const historical = ctx.db.agreement_revision.id.find(revisionId);
    if (!document || !historical || historical.negotiationId !== negotiationId) throw new SenderError('Agreement revision not found');
    if (document.revision !== expectedRevision) throw new SenderError('Agreement changed remotely. Reload before restoring.');
    clearAgreementAcceptance(ctx, negotiationId);
    const nextRevision = document.revision + 1n;
    const content = historical.content;
    const clauses = historical.clauses;
    ctx.db.agreement_document.negotiationId.update({
      ...document,
      content,
      clauses,
      updatedBy: ctx.sender,
      updatedAt: ctx.timestamp,
      revision: nextRevision,
      acceptedByA: false,
      acceptedByB: false,
      acceptedRevisionA: 0n,
      acceptedRevisionB: 0n,
    });
    appendAgreementRevision(ctx, negotiationId, nextRevision, content, clauses, 'restore', document.revision, `Restored revision ${historical.revision}`);
    appendEvent(ctx, negotiationId, 'agreement_revision_created', JSON.stringify({ revision: String(nextRevision), source: 'restore', restoredRevision: String(historical.revision) }));
  }
);

export const acceptAgreementRevision = spacetimedb.reducer(
  { negotiationId: t.u64(), revision: t.u64() },
  (ctx, { negotiationId, revision }) => {
    const neg = requireNegotiation(ctx, negotiationId);
    const caller = findCallerParty(ctx, negotiationId);
    if (!neg.definitionsConfirmedByA || !neg.definitionsConfirmedByB) throw new SenderError('Both parties must confirm term definitions');
    const document = ctx.db.agreement_document.negotiationId.find(negotiationId);
    if (!document || document.revision !== revision) throw new SenderError('Only the current agreement revision can be accepted');
    const clauses = [...ctx.db.agreement_clause.by_negotiation.filter(negotiationId)];
    if (clauses.some(clause => clause.resolution.trim().length < 3)) throw new SenderError('Every clause needs shared wording before acceptance');
    const acceptedByA = document.acceptedByA || caller.side === 'a';
    const acceptedByB = document.acceptedByB || caller.side === 'b';
    const nextDocument = {
      ...document,
      acceptedByA,
      acceptedByB,
      acceptedRevisionA: caller.side === 'a' ? revision : document.acceptedRevisionA,
      acceptedRevisionB: caller.side === 'b' ? revision : document.acceptedRevisionB,
    };
    if (acceptedByA && acceptedByB && nextDocument.acceptedRevisionA === revision && nextDocument.acceptedRevisionB === revision) {
      ctx.db.negotiation.id.update({ ...neg, status: 'agreed', acceptedByA: true, acceptedByB: true });
      ctx.db.agreement_document.negotiationId.update({
        ...nextDocument,
        lockedTerms: currentLockedTerms(ctx, negotiationId),
      });
    } else {
      ctx.db.agreement_document.negotiationId.update(nextDocument);
    }
    appendEvent(ctx, negotiationId, 'agreement_revision_accepted', JSON.stringify({ revision: String(revision), side: caller.side }));
  }
);

export const updateAgreementClauses = spacetimedb.reducer(
  { negotiationId: t.u64(), clauses: t.string() },
  (ctx, { negotiationId, clauses }) => {
    const neg = requireNegotiation(ctx, negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Agreement is locked after both parties agree');
    findCallerParty(ctx, negotiationId);
    if (clauses.length > 100000) throw new SenderError('Clauses are too large');
    const document = ctx.db.agreement_document.negotiationId.find(negotiationId);
    if (!document) throw new SenderError('Agreement document not found');
    ctx.db.agreement_document.negotiationId.update({
      ...document,
      content: `${document.lockedTerms}\n\nClauses\n${clauses}`,
      clauses,
      updatedBy: ctx.sender,
      updatedAt: ctx.timestamp,
    });
  }
);

export const addSupportDocument = spacetimedb.reducer(
  { negotiationId: t.u64(), name: t.string(), content: t.string(), mimeType: t.string(), data: t.array(t.u8()) },
  (ctx, { negotiationId, name, content, mimeType, data }) => {
    requireNegotiation(ctx, negotiationId);
    findCallerParty(ctx, negotiationId);
    if ([...ctx.db.support_document.by_negotiation.filter(negotiationId)].length >= 5) {
      throw new SenderError('A matter can contain up to 5 supporting files');
    }
    const trimmedName = name.trim();
    const trimmedContent = content.trim();
    if (!trimmedName) throw new SenderError('Document name is required');
    if (!trimmedContent && data.length === 0) throw new SenderError('Document content is required');
    if (trimmedName.length > 200) throw new SenderError('Document name is too long');
    if (trimmedContent.length > 100000 || data.length > 2_000_000) throw new SenderError('Document is larger than the 2 MB limit');
    clearAgreementAcceptance(ctx, negotiationId);
    ctx.db.support_document.insert({
      id: 0n,
      negotiationId,
      name: trimmedName,
      content: trimmedContent,
      uploadedBy: ctx.sender,
      createdAt: ctx.timestamp,
      mimeType: mimeType.trim() || 'application/octet-stream',
      data,
    });
    appendEvent(ctx, negotiationId, 'support_document_added', JSON.stringify({ name: trimmedName }));
  }
);

export const setPresence = spacetimedb.reducer(
  { negotiationId: t.u64() },
  (ctx, { negotiationId }) => {
    requireNegotiation(ctx, negotiationId);
    const caller = findCallerParty(ctx, negotiationId);
    ctx.db.presence.identity.delete(ctx.sender);
    ctx.db.presence.insert({
      identity: ctx.sender,
      negotiationId,
      partyId: caller.id,
      online: true,
    });
    ctx.db.party.id.update({ ...caller, online: true });
  }
);

export const setPartyLabel = spacetimedb.reducer(
  { negotiationId: t.u64(), label: t.string() },
  (ctx, { negotiationId, label }) => {
    const neg = requireNegotiation(ctx, negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Deal already finalized');
    const party = findCallerParty(ctx, negotiationId);
    if (party.labelConfirmed) throw new SenderError('Party label is already confirmed');
    const trimmed = label.trim();
    if (trimmed.length < 2) throw new SenderError('Party label is required');
    if (trimmed.length > 120) throw new SenderError('Party label is too long');
    ctx.db.party.id.update({ ...party, label: trimmed, labelConfirmed: true });
    appendEvent(ctx, negotiationId, 'party_label_updated', JSON.stringify({ partyId: String(party.id) }));
  }
);

export const confirmTermDefinitions = spacetimedb.reducer(
  { negotiationId: t.u64() },
  (ctx, { negotiationId }) => {
    const neg = requireNegotiation(ctx, negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Deal already finalized');
    const caller = findCallerParty(ctx, negotiationId);
    ctx.db.negotiation.id.update({
      ...neg,
      definitionsConfirmedByA: neg.definitionsConfirmedByA || caller.side === 'a',
      definitionsConfirmedByB: neg.definitionsConfirmedByB || caller.side === 'b',
    });
    appendEvent(ctx, negotiationId, 'term_definitions_confirmed', JSON.stringify({ side: caller.side }));
  }
);
