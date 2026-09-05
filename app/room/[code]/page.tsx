'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, reducers } from '../../../src/module_bindings';
import type {
  AgentProposal,
  Event,
  MediatorMessage,
  Offer,
  OfferTerm,
  Party,
  Position,
  Term,
} from '../../../src/module_bindings/types';

const EVENT_LABELS: Record<string, string> = {
  created: 'Room opened',
  joined: 'Opponent joined',
  rejoined: 'Party reconnected',
  position_updated: 'Position updated',
  reason_updated: 'Reason updated',
  offer_made: 'Offer made',
  counter_offer: 'Counter-offer made',
  offer_accepted: 'Offer accepted',
  offer_rejected: 'Offer rejected',
  agent_proposal: 'Mediator proposal',
  proposal_accepted: 'Proposal accepted',
  proposal_rejected: 'Proposal rejected',
  finalized: 'Deal finalized',
};

type TermValues = { valueA: string; valueB: string };

function fmtTime(micros: bigint): string {
  return new Date(Number(micros / 1000n)).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtElapsed(micros: bigint): string {
  const seconds = Math.max(0, Math.floor((Date.now() * 1000 - Number(micros)) / 1_000_000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function parseProposal(json: string): Array<{ termId: string; valueA: string; valueB: string }> {
  try {
    const parsed = JSON.parse(json) as
      | Array<{ termId: string | number; valueA: string; valueB: string }>
      | { terms?: Array<{ termId: string | number; valueA: string; valueB: string }> };
    const items = Array.isArray(parsed) ? parsed : (parsed?.terms ?? []);
    return items.map(i => ({
      termId: String(i.termId),
      valueA: i.valueA,
      valueB: i.valueB,
    }));
  } catch {
    return [];
  }
}

type SnapshotTerm = {
  id: string;
  name: string;
  valueA: string;
  valueB: string;
  reasonA: string;
  reasonB: string;
};
type SnapshotOffer = {
  createdBySide: string;
  status: string;
  note: string;
  terms: Array<{ name: string; valueA: string; valueB: string }>;
};

function useDebouncedWriter(initial: string, onCommit: (v: string) => void) {
  const [draft, setDraft] = useState(initial);
  const committed = useRef(initial);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (initial !== committed.current) {
      committed.current = initial;
      setDraft(initial);
    }
  }, [initial]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const commit = useCallback(
    (next: string) => {
      committed.current = next;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (next !== initial) onCommit(next);
      }, 550);
    },
    [initial, onCommit]
  );

  const set = (next: string) => {
    setDraft(next);
    commit(next);
  };

  return { draft, set, commitNow: (next: string) => { setDraft(next); onCommit(next); } };
}

function PositionEditor(props: {
  position: Position;
  initialValue: string;
  initialReason: string;
  editable: boolean;
  sideLabel: string;
  onValue: (v: string) => void;
  onReason: (r: string) => void;
}) {
  const { position, editable } = props;
  const value = useDebouncedWriter(position.value, props.onValue);
  const reason = useDebouncedWriter(position.reason, props.onReason);
  if (!editable) {
    return (
      <div className="side">
        <div className="who">{props.sideLabel}</div>
        <div className="term-version">
          <span>Initial</span>
          <strong>{props.initialValue || '—'}</strong>
          {props.initialReason && <small>{props.initialReason}</small>}
        </div>
        <div className="term-version latest">
          <span>Latest</span>
          <strong>{position.value || '—'}</strong>
        </div>
        {position.reason && <div className="pos-reason">{position.reason}</div>}
      </div>
    );
  }

  return (
    <div className="side mine">
      <div className="who">{props.sideLabel}</div>
      <div className="term-version">
        <span>Initial</span>
        <strong>{props.initialValue || '—'}</strong>
        {props.initialReason && <small>{props.initialReason}</small>}
      </div>
      <div className="term-version latest"><span>Latest</span></div>
      <div className="field-row">
        <input
          value={value.draft}
          onChange={e => value.set(e.target.value)}
          placeholder="Position"
        />
      </div>
      <textarea
        className="reason"
        value={reason.draft}
        onChange={e => reason.set(e.target.value)}
        placeholder="Why? (optional)"
      />
    </div>
  );
}

function OfferComposer(props: {
  terms: Term[];
  initial: Record<string, TermValues>;
  initialNote: string;
  submitLabel: string;
  onSubmit: (note: string, items: Array<{ termId: bigint; valueA: string; valueB: string }>) => void;
  onCancel: () => void;
}) {
  const { terms } = props;
  const [values, setValues] = useState(props.initial);
  const [note, setNote] = useState(props.initialNote);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const items = terms
      .map(t => ({
        termId: t.id,
        valueA: values[String(t.id)]?.valueA ?? '',
        valueB: values[String(t.id)]?.valueB ?? '',
      }))
      .filter(item => item.valueA.trim() || item.valueB.trim());
    if (items.length === 0) return;
    props.onSubmit(note.trim(), items);
  };

  return (
    <form className="composer stack" onSubmit={submit}>
      <h3>{props.submitLabel}</h3>
      {terms.map(t => {
        const v = values[String(t.id)] ?? { valueA: '', valueB: '' };
        return (
          <div key={String(t.id)} className="term-card stack">
            <label>{t.name}</label>
            <div className="sides">
              <label>
                Initiating party value
                <input
                  value={v.valueA}
                  onChange={e =>
                    setValues(prev => ({
                      ...prev,
                      [String(t.id)]: { ...prev[String(t.id)], valueA: e.target.value },
                    }))
                  }
                />
              </label>
              <label>
                Responding party value
                <input
                  value={v.valueB}
                  onChange={e =>
                    setValues(prev => ({
                      ...prev,
                      [String(t.id)]: { ...prev[String(t.id)], valueB: e.target.value },
                    }))
                  }
                />
              </label>
            </div>
          </div>
        );
      })}
      <label>
        Note to the other party
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="My reasoning, briefly" />
      </label>
      <div className="row">
        <button type="submit" className="btn ok">
          Send
        </button>
        <button type="button" className="btn ghost" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function RoomPage() {
  const params = useParams();
  const code = typeof params?.code === 'string' ? params.code : '';

  const { isActive, identity: myIdentity } = useSpacetimeDB();
  const [negotiations, negotiationsReady] = useTable(tables.negotiation);
  const [partiesAll] = useTable(tables.party);
  const [termsAll] = useTable(tables.term);
  const [positionsAll] = useTable(tables.position);
  const [offersAll] = useTable(tables.offer);
  const [offerTermsAll] = useTable(tables.offerTerm);
  const [proposalsAll] = useTable(tables.agentProposal);
  const [messagesAll] = useTable(tables.mediatorMessage);
  const [supportDocumentsAll] = useTable(tables.supportDocument);
  const [eventsAll] = useTable(tables.event);
  const [presenceAll] = useTable(tables.presence);

  const joinNegotiation = useReducer(reducers.joinNegotiation);
  const setPositionReducer = useReducer(reducers.setPosition);
  const setReasonReducer = useReducer(reducers.setReason);
  const makeOffer = useReducer(reducers.makeOffer);
  const counterOffer = useReducer(reducers.counterOffer);
  const acceptOffer = useReducer(reducers.acceptOffer);
  const rejectOffer = useReducer(reducers.rejectOffer);
  const submitProposal = useReducer(reducers.submitAgentProposal);
  const acceptProposal = useReducer(reducers.acceptProposal);
  const rejectProposal = useReducer(reducers.rejectProposal);
  const acceptCurrentTerms = useReducer(reducers.acceptCurrentTerms);
  const setPartyLabelReducer = useReducer(reducers.setPartyLabel);
  const sendMessage = useReducer(reducers.sendMediatorMessage);
  const addSupportDocument = useReducer(reducers.addSupportDocument);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediating, setMediating] = useState(false);
  const [composer, setComposer] = useState<{ mode: 'offer' | 'counter'; offerId?: bigint } | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const [supportContent, setSupportContent] = useState('');
  const [supportMime, setSupportMime] = useState('text/plain');
  const [supportData, setSupportData] = useState<Uint8Array>(new Uint8Array());
  const [supportUploads, setSupportUploads] = useState<Array<{ name: string; mimeType: string; content: string; data: Uint8Array }>>([]);
  const [partyLabelDraft, setPartyLabelDraft] = useState('');

  const neg = useMemo(
    () => [...negotiations].find(n => n.joinCode.toUpperCase() === code.toUpperCase()),
    [negotiations, code]
  );
  const negId = neg?.id;

  const negParties = useMemo(
    () => [...partiesAll].filter(p => p.negotiationId === negId),
    [partiesAll, negId]
  );
  const negTerms = useMemo(
    () => [...termsAll].filter(t => t.negotiationId === negId).sort((a, b) => a.sortOrder - b.sortOrder),
    [termsAll, negId]
  );
  const negPositions = useMemo(
    () => [...positionsAll].filter(p => p.negotiationId === negId),
    [positionsAll, negId]
  );
  const negOffers = useMemo(
    () => [...offersAll].filter(o => o.negotiationId === negId).sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch)),
    [offersAll, negId]
  );
  const negOfferTerms = useMemo(
    () => [...offerTermsAll].filter(ot => negOffers.some(o => o.id === ot.offerId)),
    [offerTermsAll, negOffers]
  );
  const negProposals = useMemo(
    () => [...proposalsAll].filter(p => p.negotiationId === negId).sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch)),
    [proposalsAll, negId]
  );
  const negMessages = useMemo(
    () => [...messagesAll].filter(m => m.negotiationId === negId).sort((a, b) => Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch)),
    [messagesAll, negId]
  );
  const supportDocuments = useMemo(
    () => [...supportDocumentsAll].filter(d => d.negotiationId === negId).sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch)),
    [supportDocumentsAll, negId]
  );
  const negEvents = useMemo(
    () => [...eventsAll].filter(e => e.negotiationId === negId).sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch)),
    [eventsAll, negId]
  );
  const negPresence = useMemo(
    () => [...presenceAll].filter(p => p.negotiationId === negId),
    [presenceAll, negId]
  );

  const partyA = negParties.find(p => p.side === 'a');
  const partyB = negParties.find(p => p.side === 'b');
  const myHex = myIdentity?.toHexString();
  const myParty = negParties.find(
    p => p.identity !== undefined && p.identity.toHexString() === myHex
  );

  useEffect(() => {
    if (myParty) setPartyLabelDraft(myParty.label);
  }, [myParty]);

  const partyLabel = useCallback(
    (p: Party | undefined) => p
      ? p.label === 'Party A' || p.side === 'a' && !p.label ? 'Initiating party' : p.label === 'Party B' || p.side === 'b' && !p.label ? 'Responding party' : p.label
      : 'Unrepresented party',
    []
  );
  const partyLabelById = useMemo(
    () => new Map(negParties.map(p => [String(p.id), p.label === 'Party A' ? 'Initiating party' : p.label === 'Party B' ? 'Responding party' : p.label])),
    [negParties]
  );

  const actorLabel = useCallback((identity: typeof myIdentity | undefined) => {
    const party = negParties.find(p => p.identity && identity && p.identity.toHexString() === identity.toHexString());
    return partyLabelById.get(String(party?.id)) ?? 'System';
  }, [myIdentity, negParties, partyLabelById]);

  const positionFor = useCallback(
    (termId: bigint, partyId: bigint | undefined) =>
      partyId === undefined
        ? undefined
        : negPositions.find(p => p.termId === termId && p.partyId === partyId),
    [negPositions]
  );

  const termsModel = useMemo(
    () =>
      negTerms.map(term => ({
        term,
        posA: positionFor(term.id, partyA?.id),
        posB: positionFor(term.id, partyB?.id),
      })),
    [negTerms, partyA, partyB, positionFor]
  );

  const gapAgreed = termsModel.filter(
    m => m.posA?.value && m.posB?.value && m.posA.value.trim() === m.posB.value.trim()
  ).length;
  const gapPct = termsModel.length ? (gapAgreed / termsModel.length) * 100 : 0;

  const mySide = myParty?.side;

  const currentValues = useMemo(() => {
    const map: Record<string, TermValues> = {};
    for (const m of termsModel) {
      map[String(m.term.id)] = {
        valueA: m.posA?.value ?? '',
        valueB: m.posB?.value ?? '',
      };
    }
    return map;
  }, [termsModel]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${code}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const onJoin = async () => {
    if (!isActive || !code) return;
    setBusy('Joining…');
    setError(null);
    try {
      await joinNegotiation({ joinCode: code });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join');
    } finally {
      setBusy(null);
    }
  };

  const buildSnapshot = (extraMessage?: string): {
    title: string;
    category: string;
    status: string;
    parties: Array<{ side: string; label: string; online: boolean }>;
    terms: SnapshotTerm[];
    offers: SnapshotOffer[];
      events: Array<{ type: string; payload: string }>;
      messages: Array<{ authorSide: string; body: string }>;
      supportDocuments: Array<{ name: string; mimeType: string; content: string }>;
  } => {
    const terms: SnapshotTerm[] = termsModel.map(m => ({
      id: String(m.term.id),
      name: m.term.name,
      valueA: m.posA?.value ?? '',
      valueB: m.posB?.value ?? '',
      reasonA: m.posA?.reason ?? '',
      reasonB: m.posB?.reason ?? '',
    }));
    const offers: SnapshotOffer[] = negOffers.map(o => ({
      createdBySide: partyA?.id === o.createdByPartyId ? 'a' : 'b',
      status: o.status,
      note: o.note,
      terms: negOfferTerms
        .filter(ot => ot.offerId === o.id)
        .map(ot => {
          const t = negTerms.find(term => term.id === ot.termId);
          return { name: t?.name ?? 'Term', valueA: ot.valueA, valueB: ot.valueB };
        }),
    }));
    return {
      title: neg?.title ?? '',
      category: neg?.category ?? '',
      status: neg?.status ?? '',
      parties: negParties.map(p => ({ side: p.side, label: p.label, online: p.online })),
      terms,
      offers,
      events: negEvents.map(e => ({ type: e.type, payload: e.payload })),
      messages: [
        ...negMessages.map(m => ({
        authorSide: partyA?.id === m.authorPartyId ? 'a' : 'b',
        body: m.body,
        })),
        ...(extraMessage ? [{ authorSide: mySide ?? 'unknown', body: extraMessage }] : []),
      ],
      supportDocuments: supportDocuments.map(d => ({ name: d.name, mimeType: d.mimeType, content: d.content })),
    };
  };

  const onMediate = async (extraMessage?: string) => {
    if (!neg || mediating) return;
    setMediating(true);
    setError(null);
    try {
      const res = await fetch('/api/mediate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSnapshot(extraMessage)),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        diagnosis: string;
        tradeoff: string;
        reasoning: string;
        proposal: { terms: Array<{ termId: string; valueA: string; valueB: string }> };
      };
      await submitProposal({
        negotiationId: neg.id,
        diagnosis: data.diagnosis,
        proposalJson: JSON.stringify({ terms: data.proposal.terms }),
        tradeoff: data.tradeoff,
        reasoning: data.reasoning,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mediation failed');
    } finally {
      setMediating(false);
    }
  };

  const onSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!neg || !message.trim()) return;
    setBusy('Sending…');
    setError(null);
    try {
      const nextMessage = message.trim();
      await sendMessage({ negotiationId: neg.id, body: nextMessage });
      setMessage('');
      await onMediate(nextMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message');
    } finally {
      setBusy(null);
    }
  };

  const onAddSupportDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!neg) return;
    const documents = [...supportUploads];
    if (supportContent.trim() || supportData.length > 0) {
      documents.push({ name: 'Supporting context', mimeType: supportMime, content: supportContent, data: supportData });
    }
    if (documents.length === 0) return;
    setBusy('Adding context…');
    setError(null);
    try {
      for (const document of documents) {
        await addSupportDocument({ negotiationId: neg.id, ...document });
      }
      setSupportContent('');
      setSupportMime('text/plain');
      setSupportData(new Uint8Array());
      setSupportUploads([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add context');
    } finally {
      setBusy(null);
    }
  };

  const pendingProposal = negProposals.find(p => p.status === 'pending');
  const latestPendingOffer = negOffers.find(o => o.status === 'pending');
  const proposedLatestTerms = pendingProposal
    ? parseProposal(pendingProposal.proposalJson)
    : latestPendingOffer
      ? negOfferTerms
        .filter(item => item.offerId === latestPendingOffer.id)
        .map(item => ({ termId: String(item.termId), valueA: item.valueA, valueB: item.valueB }))
      : termsModel.map(item => ({ termId: String(item.term.id), valueA: item.posA?.value ?? '', valueB: item.posB?.value ?? '' }));
  const proposedLatestSource = pendingProposal ? 'Mediator' : latestPendingOffer ? 'Manual offer' : 'Current';
  if (!neg && !negotiationsReady) {
    return (
      <main className="shell loading-state">
        <div className="spinner" aria-hidden="true" />
        <h1>Loading negotiation</h1>
        <p className="muted">Connecting to the shared matter workspace…</p>
      </main>
    );
  }

  if (!neg) {
    return (
      <main className="shell rise">
        <p className="pill">
          <span className="status-dot" />
          Room not found
        </p>
        <h1 className="brand">Settle</h1>
        <p className="lede">We couldn’t find a negotiation for code “{code}”.</p>
        <Link href="/" className="btn">
          Back to start a new one
        </Link>
      </main>
    );
  }

  const agreed = neg.status === 'agreed';

  return (
    <main className="shell rise">
      <div className="room-top">
        <Link href="/" className="btn micro ghost">
          ← Settle
        </Link>
        <div className="room-code">
          <span className="pill">
            <span className={`status-dot ${isActive ? 'on' : ''}`} />
            {code}
          </span>
          <button type="button" className="btn micro ghost" onClick={copyLink}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>

      <div className="room-head">
        <p className="pill">{neg.category}</p>
        <h1>{neg.title}</h1>
        <p className="muted">Opened {fmtElapsed(neg.createdAt.microsSinceUnixEpoch)}</p>
        <div className="presence row">
          {negParties.map(p => (
            <span key={String(p.id)} className="presence-chip">
              <span className={`status-dot ${p.online ? 'on' : ''}`} />
              {partyLabel(p)}
              {p.side === (mySide ?? '') ? ' (you)' : ''}
            </span>
          ))}
          {negPresence.length > 0 && (
            <span className="muted">{negPresence.length} connection{negPresence.length === 1 ? '' : 's'}</span>
          )}
        </div>
      </div>

      {myParty?.side === 'b' && (
        <section className="panel stack party-onboarding">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>Your party details</h2>
          <p className="muted">The initiating party opened the matter. Add your own legal role and opening position below; those entries become your initial record.</p>
          <form className="row" onSubmit={async e => {
            e.preventDefault();
            setBusy('Saving label…');
            try { await setPartyLabelReducer({ negotiationId: neg.id, label: partyLabelDraft }); }
            catch (err) { setError(err instanceof Error ? err.message : 'Could not save party label'); }
            finally { setBusy(null); }
          }}>
            <input
              value={partyLabelDraft}
              onChange={e => setPartyLabelDraft(e.target.value)}
              placeholder="Your legal role or name"
              maxLength={120}
              required
            />
            <button type="submit" className="btn" disabled={!partyLabelDraft.trim() || busy !== null}>Save label</button>
          </form>
        </section>
      )}

      <div className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>
            {agreed ? 'Agreed terms' : 'Live term sheet'}
          </h2>
          <span className={`tag ${neg.status}`}>{neg.status}</span>
        </div>

        {!myParty && !agreed && (
          <p className="muted">
            {partyB?.identity === undefined && myHex === undefined
              ? 'You are not seated yet — you can watch, or join as a party.'
              : 'You are not a party in this room.'}
          </p>
        )}

        {!myParty && !agreed && isActive && (
          <button type="button" className="btn" disabled={busy !== null} onClick={onJoin}>
            {busy ?? 'Join this negotiation'}
          </button>
        )}

        {termsModel.length > 0 && (
          <div className="term-grid">
            {termsModel.map(({ term, posA, posB }) => {
              const mineA = myParty?.id === partyA?.id;
              const mineB = myParty?.id === partyB?.id;
              const agree =
                posA?.value?.trim() !== '' &&
                posA?.value?.trim() === posB?.value?.trim();
              return (
                <div className="term-card stack" key={String(term.id)}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h3>{term.name}</h3>
                    {!agreed && <span className={`tag ${agree ? 'aligned' : 'gap'}`}>{agree ? 'Aligned' : 'Disagrees'}</span>}
                  </div>
                  <div className="sides">
                    <PositionEditor
                      position={
                        posA ?? {
                          id: 0n,
                          negotiationId: neg.id,
                          partyId: partyA?.id ?? 0n,
                          termId: term.id,
                          value: '',
                          reason: '',
                          initialValue: '',
                          initialReason: '',
                          updatedAt: neg.createdAt,
                        }
                      }
                      initialValue={posA?.initialValue || posA?.value || ''}
                      initialReason={posA?.initialReason || posA?.reason || ''}
                      editable={!agreed && myParty !== undefined && mineA && posA !== undefined}
                      sideLabel={partyLabel(partyA)}
                      onValue={v => posA && setPositionReducer({ positionId: posA.id, value: v })}
                      onReason={r => posA && setReasonReducer({ positionId: posA.id, reason: r })}
                    />
                    <PositionEditor
                      position={
                        posB ?? {
                          id: 0n,
                          negotiationId: neg.id,
                          partyId: partyB?.id ?? 0n,
                          termId: term.id,
                          value: '',
                          reason: '',
                          initialValue: '',
                          initialReason: '',
                          updatedAt: neg.createdAt,
                        }
                      }
                      initialValue={posB?.initialValue || posB?.value || ''}
                      initialReason={posB?.initialReason || posB?.reason || ''}
                      editable={!agreed && myParty !== undefined && mineB && posB !== undefined}
                      sideLabel={partyLabel(partyB)}
                      onValue={v => posB && setPositionReducer({ positionId: posB.id, value: v })}
                      onReason={r => posB && setReasonReducer({ positionId: posB.id, reason: r })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="gap-bar">
          <div className="gap-fill" style={{ width: `${gapPct}%` }} />
        </div>
        <p className="muted">
          {gapPct === 100
            ? 'Everything aligned on both sides.'
            : `${gapAgreed} of ${termsModel.length} terms match. The mediator can bridge the rest.`}
        </p>
      </div>

      {!agreed && (
        <section className="panel stack">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>Make a move</h2>
          <div className="latest-preview">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>Latest terms</h3>
              <span className="tag pending">{proposedLatestSource}</span>
            </div>
            <p className="muted">The current version under discussion. It changes after a manual offer or a mediator recommendation is accepted by both parties.</p>
            {proposedLatestTerms.map(item => {
              const term = negTerms.find(candidate => String(candidate.id) === item.termId);
              return (
                <div className="latest-preview-row" key={item.termId}>
                  <strong>{term?.name ?? 'Term'}</strong>
                  <span>{partyLabel(partyA)}: {item.valueA || '—'}</span>
                  <span>{partyLabel(partyB)}: {item.valueB || '—'}</span>
                </div>
              );
            })}
          </div>
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={!myParty || busy !== null}
              onClick={() => setComposer({ mode: 'offer' })}
            >
              Make offer
            </button>
            {myParty && (
              <button
                type="button"
                className="btn ok"
                disabled={busy !== null || (myParty.side === 'a' ? neg.acceptedByA : neg.acceptedByB)}
                onClick={async () => {
                  setBusy('Recording acceptance…');
                  try { await acceptCurrentTerms({ negotiationId: neg.id }); }
                  catch (err) { setError(err instanceof Error ? err.message : 'Could not accept terms'); }
                  finally { setBusy(null); }
                }}
              >
                {(myParty.side === 'a' ? neg.acceptedByA : neg.acceptedByB) ? 'Accepted by you' : 'Accept latest terms'}
              </button>
            )}
            <Link href={`/room/${code}/agreement`} className="btn ghost">Open working agreement</Link>
          </div>
          <p className="muted">Initiating party: {neg.acceptedByA ? 'accepted' : 'awaiting'} · Responding party: {neg.acceptedByB ? 'accepted' : 'awaiting'}. The matter is agreed only after both accept.</p>
          {latestPendingOffer && myParty && (
            <div className="action-bar">
              {myParty.id === latestPendingOffer.createdByPartyId ? (
                <span className="muted">Your latest offer is awaiting the other party.</span>
              ) : (
                <>
                  <strong>Respond to the latest offer</strong>
                  <div className="row">
                    <button type="button" className="btn ok" disabled={busy !== null} onClick={async () => {
                      setBusy('Accepting…');
                      try { await acceptOffer({ offerId: latestPendingOffer.id }); }
                      catch (err) { setError(err instanceof Error ? err.message : 'Accept failed'); }
                      finally { setBusy(null); }
                    }}>Accept</button>
                    <button type="button" className="btn warn" disabled={busy !== null} onClick={async () => {
                      setBusy('Rejecting…');
                      try { await rejectOffer({ offerId: latestPendingOffer.id }); }
                      catch (err) { setError(err instanceof Error ? err.message : 'Reject failed'); }
                      finally { setBusy(null); }
                    }}>Reject</button>
                    <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => setComposer({ mode: 'counter', offerId: latestPendingOffer.id })}>Counter</button>
                  </div>
                </>
              )}
            </div>
          )}
          {composer?.mode === 'offer' && (
            <OfferComposer
              terms={negTerms}
              initial={currentValues}
              initialNote=""
              submitLabel="Offer — both sides as proposed"
              onSubmit={async (note, items) => {
                await makeOffer({ negotiationId: neg.id, note, terms: items });
                setComposer(null);
              }}
              onCancel={() => setComposer(null)}
            />
          )}
          {composer?.mode === 'counter' && (
            <OfferComposer
              terms={negTerms}
              initial={(() => {
                const map: Record<string, TermValues> = {};
                for (const ot of negOfferTerms.filter(ot => ot.offerId === composer.offerId)) {
                  map[String(ot.termId)] = { valueA: ot.valueA, valueB: ot.valueB };
                }
                return map;
              })()}
              initialNote={negOffers.find(o => o.id === composer.offerId)?.note ?? ''}
              submitLabel="Counter-offer — adjust and send"
              onSubmit={async (note, items) => {
                await counterOffer({ negotiationId: neg.id, note, terms: items });
                setComposer(null);
              }}
              onCancel={() => setComposer(null)}
            />
          )}
        </section>
      )}

      <section className="panel stack">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>Supporting context</h2>
        <p className="muted">Add clauses, background facts, PDFs, images, or other files for the mediator. Text is read directly; binary files remain attached context.</p>
        {supportDocuments.map(document => (
          <details className="support-document" key={String(document.id)}>
            <summary>{document.name} <span className="muted">({document.mimeType})</span></summary>
            {document.content ? <pre>{document.content}</pre> : <p className="muted">Binary file attached for review.</p>}
          </details>
        ))}
        {!agreed && <form className="stack" onSubmit={onAddSupportDocument}>
          <input
            type="file"
            multiple
            accept="*/*"
            onChange={async e => {
              const input = e.currentTarget;
              const files = Array.from(e.target.files ?? []);
              const uploads = await Promise.all(files.map(async file => {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const readable = file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name);
                return { name: file.name, mimeType: file.type || 'application/octet-stream', content: readable ? await file.text() : '', data: bytes };
              }));
              setSupportUploads(previous => [...previous, ...uploads]);
              input.value = '';
            }}
          />
          {supportUploads.length > 0 && (
            <div className="file-list">
              {supportUploads.map((file, index) => (
                <div className="file-chip" key={`${file.name}-${index}`}>
                  <span>{file.name}</span>
                  <button type="button" onClick={() => setSupportUploads(files => files.filter((_, i) => i !== index))}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <textarea
            aria-label="Supporting text"
            rows={5}
            value={supportContent}
            onChange={e => setSupportContent(e.target.value)}
            placeholder="Paste supporting text or choose any file"
            maxLength={100000}
          />
          <button type="submit" className="btn ghost" disabled={!myParty || (supportUploads.length === 0 && !supportContent.trim() && supportData.length === 0) || busy !== null}>
            Add supporting context
          </button>
        </form>}
      </section>

      <section className="panel mediator stack">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>
          Mediator chat
        </h2>
        <p className="muted">
          Ask questions one after another. The mediator sees the live terms, supporting context, and the shared conversation.
        </p>
        {!agreed && (
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={!myParty || mediating}
              onClick={() => onMediate()}
            >
              {mediating ? 'Mediating…' : 'Ask the mediator'}
            </button>
          </div>
        )}

        {pendingProposal && (
          <div className="proposal-card stack chat-bubble mediator-bubble">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>Mediator recommendation</strong>
              <span className="tag pending">pending</span>
            </div>
            <p className="diagnosis">{pendingProposal.diagnosis}</p>
            <p className="muted">
              Initiating party: {pendingProposal.acceptedByA ? 'accepted' : 'awaiting'} · Responding party: {pendingProposal.acceptedByB ? 'accepted' : 'awaiting'}
            </p>
            {pendingProposal.tradeoff && (
              <p className="muted">
                <strong>Trade-off:</strong> {pendingProposal.tradeoff}
              </p>
            )}
            {pendingProposal.reasoning && (
              <p className="muted">
                <strong>Why:</strong> {pendingProposal.reasoning}
              </p>
            )}
            {parseProposal(pendingProposal.proposalJson).length > 0 && (
              <div className="term-grid" style={{ marginTop: '0.4rem' }}>
                {parseProposal(pendingProposal.proposalJson).map(item => {
                  const t = negTerms.find(term => String(term.id) === item.termId);
                  return (
                    <div key={item.termId} className="sides">
                      <span className="side mini">{t?.name ?? 'Term'}: {item.valueA}</span>
                      <span className="side mini aligned">{item.valueB}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {!agreed && myParty && (
              <div className="row">
                <button
                  type="button"
                  className="btn ok"
                  disabled={busy !== null || (myParty?.side === 'a' ? pendingProposal.acceptedByA : pendingProposal.acceptedByB)}
                  onClick={async () => {
                    setBusy('Accepting…');
                    try {
                      await acceptProposal({ proposalId: pendingProposal.id });
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Accept failed');
                    } finally {
                      setBusy(null);
                    }
                  }}
                  >
                  {myParty?.side === 'a' && pendingProposal.acceptedByA
                    ? 'Accepted by you'
                    : myParty?.side === 'b' && pendingProposal.acceptedByB
                      ? 'Accepted by you'
                      : 'Update my terms'}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy('Rejecting…');
                    try {
                      await rejectProposal({ proposalId: pendingProposal.id });
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Reject failed');
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        )}
        {negProposals.find(p => p.status === 'accepted') && (
          <p className="muted" style={{ color: 'var(--ok)' }}>
            Both parties accepted the mediator’s proposal. The latest terms were updated; each party must now accept those final terms to close the matter.
          </p>
        )}
        {!agreed && <form className="stack mediator-chat" onSubmit={onSendMessage}>
          <label>
            Message the mediator
            <textarea
              rows={3}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Ask a question or clarify an interest…"
              maxLength={2000}
            />
          </label>
          <button type="submit" className="btn ghost" disabled={!myParty || !message.trim() || busy !== null}>
            Send message
          </button>
          {negMessages.length > 0 && (
            <div className="message-list">
              {negMessages.map(item => (
                <div className="message chat-bubble party-bubble" key={String(item.id)}>
                  <strong>{partyLabelById.get(String(item.authorPartyId)) ?? 'Party'}</strong>
                  <span>{item.body}</span>
                </div>
              ))}
            </div>
          )}
        </form>}
      </section>

      {agreed && (
        <section className="deal-banner">
          <h2>Deal reached</h2>
          <p className="muted">
            Both sides agreed on all {gapAgreed} aligned terms — a shared record, closed out in Settle.
          </p>
        </section>
      )}

      {agreed && (
        <section className="panel stack">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>Agreement locked</h2>
          <p className="muted">The settled terms are locked. Review and download the final document from the separate agreement page.</p>
          <Link href={`/room/${code}/agreement`} className="btn">Open locked agreement</Link>
        </section>
      )}

      <section className="panel stack">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>Activity</h2>
        {negEvents.length === 0 && <p className="muted">Nothing yet.</p>}
        <ul className="history">
          {negEvents.map(e => (
            <li key={String(e.id)}>
              <strong>{EVENT_LABELS[e.type] ?? e.type}</strong> · {actorLabel(e.actor)} · {fmtTime(e.createdAt.microsSinceUnixEpoch)} · {fmtElapsed(e.createdAt.microsSinceUnixEpoch)}
              {e.payload !== '{}' && <small className="activity-detail">{e.payload}</small>}
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="error" style={{ marginTop: '1rem' }}>{error}</p>}
    </main>
  );
}
