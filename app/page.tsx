'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from '../src/module_bindings';

const CATEGORIES = [
  'Commercial terms',
  'Lease or tenancy',
  'Settlement deadline',
  'Services or scope',
  'Ownership or equity',
  'Custom matter',
] as const;

type TermDraft = {
  name: string;
  valueA: string;
  valueB: string;
  reasonA: string;
  reasonB: string;
};

type SupportingFile = {
  name: string;
  mimeType: string;
  content: string;
  data: Uint8Array;
};

const DEFAULT_TERMS: TermDraft[] = [
  {
    name: 'Subject matter',
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
  const [category, setCategory] = useState<string>('Commercial terms');
  const [customMatter, setCustomMatter] = useState('');
  const [partyALabel, setPartyALabel] = useState('Initiating party');
  const [terms, setTerms] = useState<TermDraft[]>(DEFAULT_TERMS);
  const [supportingContext, setSupportingContext] = useState('');
  const [supportingFiles, setSupportingFiles] = useState<SupportingFile[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  const validate = () => {
    if (title.trim().length < 3) return 'Give the matter a title of at least 3 characters.';
    if (category === 'Custom matter' && customMatter.trim().length < 10) {
      return 'Describe the custom matter in at least 10 characters.';
    }
    if (partyALabel.trim().length < 2) {
      return 'The initiating party label is required.';
    }
    if (terms.length === 0) return 'Add at least one negotiation term.';
    if (terms.some(term => term.name.trim().length < 2)) return 'Every term needs a name.';
    if (terms.some(term => !term.valueA.trim() && !term.valueB.trim())) {
      return 'Give each term at least one opening position.';
    }
    return null;
  };

  useEffect(() => {
    if (!pendingCode) return;
    const found = [...negotiations].find(
      n => n.joinCode.toUpperCase() === pendingCode.toUpperCase()
    );
    if (found) {
      router.push(`/room/${found.joinCode}`);
    }
  }, [negotiations, pendingCode, router]);

  const updateTerm = (index: number, patch: Partial<TermDraft>) => {
    setTerms(prev => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isActive) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const before = new Set([...negotiations].map(n => n.joinCode));
      await createNegotiation({
        title,
        category,
        partyALabel,
          partyBLabel: '',
          supportingContext: [
            category === 'Custom matter' ? `Custom matter description:\n${customMatter.trim()}` : '',
            supportingContext.trim(),
          ].filter(Boolean).join('\n\n'),
          supportDocuments: supportingFiles,
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
      router.push(`/room/${newest.joinCode}`);
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
      {!isActive && (
        <p className="muted connection-help">
          Settle is reconnecting to the shared table. You can prepare the matter now;
          creation and joining will unlock when the connection is ready.
        </p>
      )}
      <h1 className="brand">Settle</h1>
      <p className="lede">
        Can&apos;t agree? Put it on one live negotiation table. Two parties. Shared terms.
        Mediator in the middle.
      </p>

      <section className="panel stack">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem' }}>
          Start a negotiation
        </h2>
        <form className="stack landing-form" onSubmit={onCreate}>
          <div className="form-section-heading">
            <span>01</span>
            <div>
              <h3>Matter</h3>
              <p>Give the mediator the basic shape of the dispute.</p>
            </div>
          </div>
          <label>
            Matter type
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="field-help">This gives the mediator context and labels the room.</span>
          </label>
          {category === 'Custom matter' && (
            <label>
              Describe the matter
              <textarea
                rows={4}
                value={customMatter}
                onChange={e => setCustomMatter(e.target.value)}
                placeholder="Explain what the parties are trying to resolve."
                maxLength={5000}
                required
              />
              <span className="field-help">This description is shared with the mediator as background context.</span>
            </label>
          )}
          <label>
            Dispute title
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Equity split / Rent allocation / Delivery date"
              required
            />
          </label>
          <div className="form-section-heading">
            <span>02</span>
            <div>
              <h3>Parties</h3>
              <p>Use the names or legal roles each side recognizes.</p>
            </div>
          </div>
          <div className="sides">
            <label>
              Initiating party label
              <input
                value={partyALabel}
                onChange={e => setPartyALabel(e.target.value)}
                required
              />
            </label>
          </div>

          <div className="form-section-heading">
            <span>03</span>
            <div>
              <h3>Opening position</h3>
              <p>These positions are preserved as the initial record.</p>
            </div>
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
                  Initiating party position
                  <input
                    value={term.valueA}
                    onChange={e => updateTerm(index, { valueA: e.target.value })}
                    placeholder="e.g. 55%"
                  />
                </label>
              </div>
              <div className="sides">
                <label>
                  Initiating party reason
                  <textarea
                    rows={3}
                    value={term.reasonA}
                    onChange={e => updateTerm(index, { reasonA: e.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}

          <div className="form-section-heading">
            <span>04</span>
            <div>
              <h3>Context</h3>
              <p>Optional background material for the mediator.</p>
            </div>
          </div>

          <label>
            <span className="label-with-help">
              Supporting context (optional)
              <button type="button" className="help-icon" title="Context gives the mediator background facts, clauses, or documents. It is shared with both parties and is not itself a negotiated term." aria-label="About supporting context">?</button>
            </span>
            <textarea
              rows={4}
              value={supportingContext}
              onChange={e => setSupportingContext(e.target.value)}
              placeholder="Paste a clause, background facts, or instructions the mediator should consider."
              maxLength={100000}
            />
            <input
              type="file"
              multiple
              accept="*/*"
              onChange={async e => {
                const input = e.currentTarget;
                const files = Array.from(e.target.files ?? []);
                const next = await Promise.all(files.map(async file => {
                  const bytes = new Uint8Array(await file.arrayBuffer());
                  const readable = file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name);
                  return {
                    name: file.name,
                    mimeType: file.type || 'application/octet-stream',
                    content: readable ? await file.text() : '',
                    data: bytes,
                  };
                }));
                setSupportingFiles(previous => [...previous, ...next]);
                input.value = '';
              }}
            />
            {supportingFiles.length > 0 && (
              <div className="file-list">
                {supportingFiles.map((file, index) => (
                  <div className="file-chip" key={`${file.name}-${index}`}>
                    <span>{file.name}</span>
                    <button type="button" onClick={() => setSupportingFiles(files => files.filter((_, i) => i !== index))}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </label>

          <div className="row">
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
