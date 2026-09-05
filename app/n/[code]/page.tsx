'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, reducers } from '../../../src/module_bindings';
import type {
  AgentProposal,
  Event,
  Offer,
  OfferTerm,
  Party,
  Position,
  Term,
} from '../../../src/module_bindings/types';
import { recordAndTranscribe, speak } from '../../../lib/voice';

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
  editable: boolean;
  sideLabel: string;
  onValue: (v: string) => void;
  onReason: (r: string) => void;
}) {
  const { position, editable } = props;
  const value = useDebouncedWriter(position.value, props.onValue);
  const reason = useDebouncedWriter(position.reason, props.onReason);
  const [dictating, setDictating] = useState<'value' | 'reason' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dictate = async (target: 'value' | 'reason') => {
    setDictating(target);
    setError(null);
    try {
      const text = await recordAndTranscribe('en');
      if (!text) throw new Error('Nothing heard — try again');
      if (target === 'value') value.commitNow(text);
      else reason.commitNow(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mic failed');
    } finally {
      setDictating(null);
    }
  };

  if (!editable) {
    return (
      <div className="side">
        <div className="who">{props.sideLabel}</div>
        <div className="pos-value">{position.value || '—'}</div>
        {position.reason && <div className="pos-reason">{position.reason}</div>}
      </div>
    );
  }

  return (
    <div className="side mine">
      <div className="who">{props.sideLabel}</div>
      <div className="field-row">
        <input
          value={value.draft}
          onChange={e => value.set(e.target.value)}
          placeholder="Position"
        />
        <button
          type="button"
          className="btn micro"
          title="Fill from voice"
          onClick={() => dictate('value')}
          disabled={dictating !== null}
        >
          {dictating === 'value' ? 'Listening…' : 'Mic'}
        </button>
        <button
          type="button"
          className="btn micro ghost"
          title="Read aloud"
          onClick={() => speak(position.value || 'No position set')}
        >
          Listen
        </button>
      </div>
      <textarea
        className="reason"
        value={reason.draft}
        onChange={e => reason.set(e.target.value)}
        placeholder="Why? (optional)"
      />
      {error && <p className="error">{error}</p>}
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
                Party A value
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
                Party B value
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
  const [negotiations] = useTable(tables.negotiation);
  const [partiesAll] = useTable(tables.party);
  const [termsAll] = useTable(tables.term);
  const [positionsAll] = useTable(tables.position);
  const [offersAll] = useTable(tables.offer);
  const [offerTermsAll] = useTable(tables.offerTerm);
  const [proposalsAll] = useTable(tables.agentProposal);
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
  const finalizeCall = useReducer(reducers.finalizeDeal);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediating, setMediating] = useState(false);
  const [composer, setComposer] = useState<{ mode: 'offer' | 'counter'; offerId?: bigint } | null>(null);
  const [copied, setCopied] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

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
  const negEvents = useMemo(
    () => [...eventsAll].filter(e => e.negotiationId === negId).sort((a, b) => Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch)),
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

  const partyLabel = useCallback(
    (p: Party | undefined) => (p ? p.label : 'Empty seat'),
    []
  );
  const partyLabelById = useMemo(
    () => new Map(negParties.map(p => [String(p.id), p.label])),
    [negParties]
  );

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
      await navigator.clipboard.writeText(`${window.location.origin}/n/${code}`);
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

  const buildSnapshot = (): {
    title: string;
    category: string;
    status: string;
    parties: Array<{ side: string; label: string; online: boolean }>;
    terms: SnapshotTerm[];
    offers: SnapshotOffer[];
    events: Array<{ type: string; payload: string }>;
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
    };
  };

  const onMediate = async () => {
    if (!neg || mediating) return;
    setMediating(true);
    setError(null);
    try {
      const res = await fetch('/api/mediate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSnapshot()),
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

  const readProposalAloud = async (p: AgentProposal) => {
    setSpeakingId(String(p.id));
    try {
      await speak(
        `${p.diagnosis}. ${p.tradeoff ? 'The trade-off: ' + p.tradeoff : ''} ${p.reasoning}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'TTS failed');
    } finally {
      setSpeakingId(null);
    }
  };

  const pendingProposal = negProposals.find(p => p.status === 'pending');
  const latestProposal = negProposals[0];

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
        <div className="presence row">
          {negParties.map(p => (
            <span key={String(p.id)} className="presence-chip">
              <span className={`status-dot ${p.online ? 'on' : ''}`} />
              {p.label}
              {p.side === (mySide ?? '') ? ' (you)' : ''}
            </span>
          ))}
          {negPresence.length > 0 && (
            <span className="muted">{negPresence.length} connection{negPresence.length === 1 ? '' : 's'}</span>
          )}
        </div>
      </div>

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
                          updatedAt: neg.createdAt,
                        }
                      }
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
                          updatedAt: neg.createdAt,
                        }
                      }
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
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={!myParty || busy !== null}
              onClick={() => setComposer({ mode: 'offer' })}
            >
              Make offer
            </button>
            {neg.status === 'proposed' && myParty && (
              <button
                type="button"
                className="btn ok"
                disabled={busy !== null}
                onClick={() => finalizeCall({ negotiationId: neg.id })}
              >
                Finalize deal
              </button>
            )}
          </div>
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
        </section>
      )}

      <section className="panel stack">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>Offers</h2>
        {negOffers.length === 0 && <p className="muted">No offers yet.</p>}
        {negOffers.map(o => {
          const mine = myParty?.id === o.createdByPartyId;
          return (
            <div className={`offer-card ${o.status}`} key={String(o.id)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>
                  {partyLabelById.get(String(o.createdByPartyId)) ?? 'Party'} · {o.status}
                </strong>
                <span className="muted">{fmtTime(o.createdAt.microsSinceUnixEpoch)}</span>
              </div>
              {o.note && <p className="offer-note">{o.note}</p>}
              {negOfferTerms
                .filter(ot => ot.offerId === o.id)
                .map(ot => {
                  const t = negTerms.find(term => term.id === ot.termId);
                  return (
                    <div className="sides" key={String(ot.id)}>
                      <span className="side mini">{t?.name ?? 'Term'}: {ot.valueA}</span>
                      <span className="side mini">{ot.valueB}</span>
                    </div>
                  );
                })}
              {o.status === 'pending' && (
                <div className="row">
                  {mine ? (
                    <span className="muted">Awaiting the other party…</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn ok"
                        disabled={busy !== null}
                        onClick={async () => {
                          setBusy('Accepting…');
                          try {
                            await acceptOffer({ offerId: o.id });
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Accept failed');
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="btn warn"
                        disabled={busy !== null}
                        onClick={async () => {
                          setBusy('Rejecting…');
                          try {
                            await rejectOffer({ offerId: o.id });
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Reject failed');
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={busy !== null}
                        onClick={() => setComposer({ mode: 'counter', offerId: o.id })}
                      >
                        Counter
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {composer?.mode === 'counter' && (
          <OfferComposer
            terms={negTerms}
            initial={
              composer.offerId
                ? (() => {
                    const map: Record<string, TermValues> = {};
                    for (const ot of negOfferTerms.filter(ot => ot.offerId === composer.offerId)) {
                      map[String(ot.termId)] = { valueA: ot.valueA, valueB: ot.valueB };
                    }
                    return map;
                  })()
                : currentValues
            }
            initialNote={
              negOffers.find(o => o.id === composer.offerId)?.note ?? ''
            }
            submitLabel="Counter-offer — adjust and send"
            onSubmit={async (note, items) => {
              await counterOffer({ negotiationId: neg.id, note, terms: items });
              setComposer(null);
            }}
            onCancel={() => setComposer(null)}
          />
        )}
      </section>

      <section className="panel mediator stack">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>
          Mediator
        </h2>
        <p className="muted">
          A neutral pass over the term sheet, your reasons, and the offer history. Certified fair. Shows up live on both sides.
        </p>
        {!agreed && (
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={!myParty || mediating}
              onClick={onMediate}
            >
              {mediating ? 'Mediating…' : 'Ask the mediator'}
            </button>
            {latestProposal && (
              <button
                type="button"
                className="btn ghost"
                disabled={speakingId !== null}
                onClick={() => readProposalAloud(latestProposal)}
              >
                {speakingId === String(latestProposal.id) ? 'Speaking…' : 'Hear it out'}
              </button>
            )}
          </div>
        )}

        {pendingProposal && (
          <div className="proposal-card stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>Proposal</strong>
              <span className="tag pending">pending</span>
            </div>
            <p className="diagnosis">{pendingProposal.diagnosis}</p>
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
                  disabled={busy !== null}
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
                  Accept proposal
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
            The mediator’s terms were accepted — deal done.
          </p>
        )}
      </section>

      {agreed && (
        <section className="deal-banner">
          <h2>Deal reached</h2>
          <p className="muted">
            Both sides agreed on all {gapAgreed} aligned terms — a shared record, closed out in Settle.
          </p>
        </section>
      )}

      <section className="panel stack">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>Activity</h2>
        {negEvents.length === 0 && <p className="muted">Nothing yet.</p>}
        <ul className="history">
          {negEvents.map(e => (
            <li key={String(e.id)}>
              {EVENT_LABELS[e.type] ?? e.type} · {fmtTime(e.createdAt.microsSinceUnixEpoch)}
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="error" style={{ marginTop: '1rem' }}>{error}</p>}
    </main>
  );
}