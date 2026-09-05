'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from '../src/module_bindings';

const CATEGORIES = [
  'Price',
  'Rent',
  'Deadline',
  'Work split',
  'Co-founder decision',
  'Custom',
] as const;

type TermDraft = {
  name: string;
  valueA: string;
  valueB: string;
  reasonA: string;
  reasonB: string;
};

const DEFAULT_TERMS: TermDraft[] = [
  {
    name: 'Primary term',
    valueA: '',
    valueB: '',
    reasonA: '',
    reasonB: '',
  },
];

export default function HomePage() {
  const router = useRouter();
  const { isActive } = useSpacetimeDB();
  const [negotiations] = useTable(tables.negotiation);
  const createNegotiation = useReducer(reducers.createNegotiation);
  const joinNegotiation = useReducer(reducers.joinNegotiation);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('Custom');
  const [partyALabel, setPartyALabel] = useState('Party A');
  const [partyBLabel, setPartyBLabel] = useState('Party B');
  const [terms, setTerms] = useState<TermDraft[]>(DEFAULT_TERMS);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingCode) return;
    const found = [...negotiations].find(
      n => n.joinCode.toUpperCase() === pendingCode.toUpperCase()
    );
    if (found) {
      router.push(`/n/${found.joinCode}`);
    }
  }, [negotiations, pendingCode, router]);

  const updateTerm = (index: number, patch: Partial<TermDraft>) => {
    setTerms(prev => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isActive) return;
    setBusy(true);
    setError(null);
    try {
      const before = new Set([...negotiations].map(n => n.joinCode));
      await createNegotiation({
        title,
        category,
        partyALabel,
        partyBLabel,
        terms: terms.map(t => ({
          name: t.name,
          valueA: t.valueA,
          valueB: t.valueB,
          reasonA: t.reasonA,
          reasonB: t.reasonB,
        })),
      });
      // Wait for subscription insert; also track via effect when join code appears.
      const waitForNew = window.setInterval(() => {
        const created = [...negotiations].find(n => !before.has(n.joinCode));
        // negotiations from closure may be stale; effect handles navigation via pending poll below
        void created;
      }, 200);
      window.setTimeout(() => window.clearInterval(waitForNew), 4000);
      setPendingCode('__awaiting__');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create negotiation');
      setBusy(false);
    }
  };

  // After create, pick the newest negotiation owned by watching list growth
  useEffect(() => {
    if (pendingCode !== '__awaiting__') return;
    if (negotiations.length === 0) return;
    const newest = [...negotiations].sort((a, b) => {
      const am = Number(a.createdAt.microsSinceUnixEpoch);
      const bm = Number(b.createdAt.microsSinceUnixEpoch);
      return bm - am;
    })[0];
    if (newest) {
      setBusy(false);
      router.push(`/n/${newest.joinCode}`);
    }
  }, [negotiations, pendingCode, router]);

  const onJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isActive || !joinCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const code = joinCode.trim().toUpperCase();
      await joinNegotiation({ joinCode: code });
      setPendingCode(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join');
      setBusy(false);
    }
  };

  return (
    <main className="shell rise">
      <p className="pill">
        <span className={`status-dot ${isActive ? 'on' : ''}`} />
        {isActive ? 'Live on maincloud' : 'Connecting…'}
      </p>
      <h1 className="brand">Settle</h1>
      <p className="lede">
        Can&apos;t agree? Put it on one live negotiation table. Two parties. Shared terms.
        Mediator in the middle.
      </p>

      <section className="panel stack">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem' }}>
          Start a negotiation
        </h2>
        <form className="stack" onSubmit={onCreate}>
          <label>
            What are you negotiating?
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dispute title
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Equity split / Rent allocation / Delivery date"
              required
            />
          </label>
          <div className="sides">
            <label>
              Party A label
              <input
                value={partyALabel}
                onChange={e => setPartyALabel(e.target.value)}
                required
              />
            </label>
            <label>
              Party B label
              <input
                value={partyBLabel}
                onChange={e => setPartyBLabel(e.target.value)}
                required
              />
            </label>
          </div>

          {terms.map((term, index) => (
            <div className="term-card stack" key={index}>
              <label>
                Term
                <input
                  value={term.name}
                  onChange={e => updateTerm(index, { name: e.target.value })}
                  required
                />
              </label>
              <div className="sides">
                <label>
                  Party A position
                  <input
                    value={term.valueA}
                    onChange={e => updateTerm(index, { valueA: e.target.value })}
                    placeholder="e.g. 55%"
                  />
                </label>
                <label>
                  Party B position
                  <input
                    value={term.valueB}
                    onChange={e => updateTerm(index, { valueB: e.target.value })}
                    placeholder="e.g. 45%"
                  />
                </label>
              </div>
              <div className="sides">
                <label>
                  Party A reason
                  <input
                    value={term.reasonA}
                    onChange={e => updateTerm(index, { reasonA: e.target.value })}
                  />
                </label>
                <label>
                  Party B reason
                  <input
                    value={term.reasonB}
                    onChange={e => updateTerm(index, { reasonB: e.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}

          <div className="row">
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                setTerms(prev => [
                  ...prev,
                  { name: '', valueA: '', valueB: '', reasonA: '', reasonB: '' },
                ])
              }
            >
              Add term
            </button>
            <button type="submit" className="btn" disabled={!isActive || busy}>
              {busy ? 'Opening room…' : 'Create room'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel stack">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem' }}>
          Join with a code
        </h2>
        <form className="row" onSubmit={onJoin}>
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            style={{ flex: 1, minWidth: 140 }}
            required
          />
          <button type="submit" className="btn ghost" disabled={!isActive || busy}>
            Join
          </button>
        </form>
      </section>

      {error && <p className="error" style={{ marginTop: '1rem' }}>{error}</p>}
    </main>
  );
}
