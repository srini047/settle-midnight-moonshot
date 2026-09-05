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
});

const OfferTermInput = t.object('OfferTermInput', {
  termId: t.u64(),
  valueA: t.string(),
  valueB: t.string(),
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
  event,
  presence,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const JOIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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
  },
  (ctx, { title, category, partyALabel, partyBLabel, terms }) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) throw new SenderError('Title is required');
    if (terms.length === 0) throw new SenderError('Add at least one term');

    const joinCode = mintJoinCode(ctx);
    const neg = ctx.db.negotiation.insert({
      id: 0n,
      joinCode,
      title: trimmedTitle,
      category: category.trim() || 'Custom',
      status: 'open',
      createdAt: ctx.timestamp,
      createdBy: ctx.sender,
    });

    const partyA = ctx.db.party.insert({
      id: 0n,
      negotiationId: neg.id,
      side: 'a',
      label: partyALabel.trim() || 'Party A',
      identity: ctx.sender,
      online: true,
    });

    const partyB = ctx.db.party.insert({
      id: 0n,
      negotiationId: neg.id,
      side: 'b',
      label: partyBLabel.trim() || 'Party B',
      identity: undefined,
      online: false,
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
      });
      ctx.db.position.insert({
        id: 0n,
        negotiationId: neg.id,
        partyId: partyA.id,
        termId: termRow.id,
        value: seed.valueA,
        reason: seed.reasonA,
        updatedAt: ctx.timestamp,
      });
      ctx.db.position.insert({
        id: 0n,
        negotiationId: neg.id,
        partyId: partyB.id,
        termId: termRow.id,
        value: seed.valueB,
        reason: seed.reasonB,
        updatedAt: ctx.timestamp,
      });
    });

    appendEvent(ctx, neg.id, 'created', JSON.stringify({ joinCode, title: trimmedTitle }));
  }
);

export const joinNegotiation = spacetimedb.reducer(
  { joinCode: t.string() },
  (ctx, { joinCode }) => {
    const code = joinCode.trim().toUpperCase();
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
      parties.find(p => p.identity === undefined);
    if (!openSeat) throw new SenderError('Both parties are already seated');

    ctx.db.party.id.update({
      ...openSeat,
      identity: ctx.sender,
      online: true,
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
    const neg = requireNegotiation(ctx, row.negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Deal already finalized');

    ctx.db.position.id.update({
      ...row,
      value,
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
    const neg = requireNegotiation(ctx, row.negotiationId);
    if (neg.status === 'agreed') throw new SenderError('Deal already finalized');

    ctx.db.position.id.update({
      ...row,
      reason,
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
    });

    for (const item of terms) {
      ctx.db.offer_term.insert({
        id: 0n,
        offerId: offerRow.id,
        termId: item.termId,
        valueA: item.valueA,
        valueB: item.valueB,
      });
    }

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
    });

    for (const item of args.terms) {
      ctx.db.offer_term.insert({
        id: 0n,
        offerId: offerRow.id,
        termId: item.termId,
        valueA: item.valueA,
        valueB: item.valueB,
      });
    }

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
    if (caller.id === offerRow.createdByPartyId) {
      throw new SenderError('The other party must accept your offer');
    }

    const parties = partiesFor(ctx, offerRow.negotiationId);
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

    ctx.db.offer.id.update({ ...offerRow, status: 'accepted' });
    const neg = requireNegotiation(ctx, offerRow.negotiationId);
    ctx.db.negotiation.id.update({ ...neg, status: 'agreed' });
    appendEvent(
      ctx,
      offerRow.negotiationId,
      'offer_accepted',
      JSON.stringify({ offerId: String(offerId) })
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
  },
  (ctx, { negotiationId, diagnosis, proposalJson, tradeoff, reasoning }) => {
    requireNegotiation(ctx, negotiationId);
    findCallerParty(ctx, negotiationId);

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
    });

    appendEvent(
      ctx,
      negotiationId,
      'agent_proposal',
      JSON.stringify({ proposalId: String(proposal.id) })
    );
  }
);

export const acceptProposal = spacetimedb.reducer(
  { proposalId: t.u64() },
  (ctx, { proposalId }) => {
    const proposal = ctx.db.agent_proposal.id.find(proposalId);
    if (!proposal) throw new SenderError('Proposal not found');
    if (proposal.status !== 'pending') throw new SenderError('Proposal is not pending');
    findCallerParty(ctx, proposal.negotiationId);

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

    for (const item of items) {
      const termId = BigInt(item.termId);
      for (const pos of [...ctx.db.position.by_term.filter(termId)]) {
        if (pos.partyId === partyA.id) {
          ctx.db.position.id.update({
            ...pos,
            value: item.valueA,
            updatedAt: ctx.timestamp,
          });
        } else if (pos.partyId === partyB.id) {
          ctx.db.position.id.update({
            ...pos,
            value: item.valueB,
            updatedAt: ctx.timestamp,
          });
        }
      }
    }

    ctx.db.agent_proposal.id.update({ ...proposal, status: 'accepted' });
    const neg = requireNegotiation(ctx, proposal.negotiationId);
    ctx.db.negotiation.id.update({ ...neg, status: 'agreed' });
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
    findCallerParty(ctx, negotiationId);
    ctx.db.negotiation.id.update({ ...neg, status: 'agreed' });
    appendEvent(ctx, negotiationId, 'finalized', '{}');
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
