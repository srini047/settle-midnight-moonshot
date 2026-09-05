'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from '../src/module_bindings';
import { getAllStates, getDistricts } from 'india-state-district';
import mammoth from 'mammoth';

const INDIA_STATES = getAllStates();

type TermDraft = {
  name: string;
  valueA: string;
  reasonA: string;
  valueKind: string;
  unit: string;
};

type SupportingFile = {
  name: string;
  mimeType: string;
  content: string;
  data: Uint8Array;
};

const MAX_SUPPORTING_FILES = 5;
const MAX_SUPPORTING_FILE_BYTES = 2 * 1024 * 1024;

async function prepareSupportingFile(file: File): Promise<SupportingFile> {
  if (file.size > MAX_SUPPORTING_FILE_BYTES) throw new Error(`${file.name} is larger than 2 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(file.name);
  const isText = file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name);
  let content = '';
  if (isDocx) {
    content = (await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer })).value;
  } else if (isText) {
    content = await file.text();
  }
  return { name: file.name, mimeType: file.type || 'application/octet-stream', content, data: bytes };
}

const DEFAULT_TERMS: TermDraft[] = [
  { name: 'Opening rental position', valueA: '', reasonA: '', valueKind: 'free_text', unit: '' },
];

export default function HomePage() {
  const router = useRouter();
  const { isActive } = useSpacetimeDB();
  const [negotiations] = useTable(tables.negotiation);
  const createNegotiation = useReducer(reducers.createNegotiation);
  const joinNegotiation = useReducer(reducers.joinNegotiation);

  const [title, setTitle] = useState('');
  const [jurisdictionState, setJurisdictionState] = useState('');
  const [jurisdictionCity, setJurisdictionCity] = useState('');
  const [jurisdictionStateCode, setJurisdictionStateCode] = useState('');
  const [propertyType, setPropertyType] = useState<'residential' | 'commercial'>('residential');
  const [partyALabel, setPartyALabel] = useState('Initiating party');
  const [terms, setTerms] = useState<TermDraft[]>(DEFAULT_TERMS);
  const [rentalContext, setRentalContext] = useState('');
  const [supportingFiles, setSupportingFiles] = useState<SupportingFile[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  const validate = () => {
    if (title.trim().length < 3) return 'Give the matter a title of at least 3 characters.';
    if (rentalContext.trim().length < 20 && supportingFiles.length === 0) return 'Describe the rental situation or attach a supporting file.';
    if (partyALabel.trim().length < 2) {
      return 'The initiating party label is required.';
    }
    if (jurisdictionState.trim().length < 2 || jurisdictionCity.trim().length < 2) {
      return 'Add the Indian state and city so the mediator can research the correct law.';
    }
    if (terms.length === 0 || terms.some(item => item.name.trim().length < 2)) return 'Give your opening terms a title.';
    if (terms.some(item => !item.valueA.trim())) return 'Enter an opening value for every term.';
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

  const extractRentalTerms = async () => {
    if (extracting || busy) return;
    if (rentalContext.trim().length < 20 && supportingFiles.length === 0) {
      setError('Describe the rental situation or attach a supporting file before extracting terms.');
      return;
    }
    setExtracting(true);
    setError(null);
    setAnalysisNotice('');
    try {
      const response = await fetch('/api/extract-rental', {
        method: 'POST',
        body: (() => {
          const form = new FormData();
          form.append('context', rentalContext);
          form.append('propertyType', propertyType);
          form.append('state', jurisdictionState);
          form.append('city', jurisdictionCity);
          for (const file of supportingFiles) {
            form.append('files', new Blob([file.data], { type: file.mimeType }), file.name);
          }
          return form;
        })(),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(typeof failure?.error === 'string' ? failure.error : 'Analysis failed. Please try again.');
      }
      const data = (await response.json()) as { terms?: Array<{ name: string; valueA: string; reasonA: string; valueKind?: string; unit?: string }> };
      if (!Array.isArray(data.terms)) throw new Error('Analysis returned an invalid response. Your draft has not changed.');
      const seen = new Set<string>();
      const uniqueTerms = data.terms.filter(item => {
        if (!item || typeof item.name !== 'string' || typeof item.valueA !== 'string' || typeof item.reasonA !== 'string') {
          throw new Error('Analysis returned an invalid response. Your draft has not changed.');
        }
        const key = `${item.name.trim()}\n${item.valueA.trim()}\n${item.reasonA.trim()}`.toLowerCase();
        if (!item.name.trim() || !item.valueA.trim() || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!uniqueTerms.length) throw new Error('No opening position could be drafted. Your draft is unchanged; enter it manually.');
      setTerms(uniqueTerms.map(item => ({
        name: item.name.trim(),
        valueA: item.valueA.trim(),
        reasonA: item.reasonA.trim(),
        valueKind: item.valueKind || 'free_text',
        unit: item.unit || '',
      })));
      setAnalysisNotice('Analysis replaced the opening values below. Review or edit them before creating the room.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not extract rental terms';
      setError(message);
      setAnalysisNotice(message);
    } finally {
      setExtracting(false);
    }
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isActive || extracting || busy) return;
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
          category: 'Lease or tenancy',
          partyALabel,
          partyBLabel: '',
          jurisdictionState,
          jurisdictionCity,
          propertyType,
          supportingContext: rentalContext.trim(),
          supportDocuments: supportingFiles,
           terms: terms.map(term => ({
             name: term.name.trim(),
             valueA: term.valueA.trim(),
             reasonA: term.reasonA.trim(),
             valueB: '',
             reasonB: '',
             valueKind: term.valueKind,
             unit: term.unit,
             validationRule: 'none',
             validationTarget: '',
             mediatorPreference: '',
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
      const parts = joinCode.trim().split(/[/?#]/).filter(Boolean);
      const code = (parts[parts.length - 1] ?? joinCode.trim()).toUpperCase();
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
      <p className="product-kicker">Rental negotiation agent</p>
      <h1 className="brand">Settle</h1>
      <p className="lede">
        Turn a rental disagreement into a shared, researched path to agreement.
      </p>

      <section className="panel stack">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem' }}>
          Start a rental negotiation
        </h2>
        <form className="stack landing-form" onSubmit={onCreate}>
          <div className="form-section-heading">
            <span>01</span>
            <div>
              <h3>Rental situation</h3>
              <p>Describe what is happening in plain language. The agent will identify possible terms.</p>
            </div>
          </div>
          <label>
            Title
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Equity split / Rent allocation / Delivery date"
              required
            />
          </label>
          <div className="sides">
            <label>
              Indian state
              <select value={jurisdictionStateCode} onChange={e => {
                const code = e.target.value;
                setJurisdictionStateCode(code);
                setJurisdictionState(INDIA_STATES.find(state => state.code === code)?.name ?? '');
                setJurisdictionCity('');
              }} required>
                <option value="">Select state</option>
                {INDIA_STATES.map(state => <option key={state.code} value={state.code}>{state.name}</option>)}
              </select>
            </label>
            <label>
              District
              <select value={jurisdictionCity} onChange={e => setJurisdictionCity(e.target.value)} disabled={!jurisdictionStateCode} required>
                <option value="">Select district</option>
                {getDistricts(jurisdictionStateCode).map(district => <option key={district} value={district}>{district}</option>)}
              </select>
            </label>
          </div>
          <label>
            Premises type
            <select value={propertyType} onChange={e => setPropertyType(e.target.value as 'residential' | 'commercial')}>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
            </select>
            <span className="field-help">The mediator uses this to separate residential tenancy rules from commercial lease rules.</span>
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
              <h3>Context and opening terms</h3>
              <p>Type your opening terms below, or let Analyze fill the same fields from your context.</p>
            </div>
          </div>

          <label>
            Rental context
            <textarea
              rows={6}
              value={rentalContext}
              onChange={e => setRentalContext(e.target.value)}
              placeholder="Example: I rent a two-bedroom flat in Mumbai. The landlord wants to increase rent next month and keep the full deposit for repainting. I want a predictable increase and a fair repair process."
              maxLength={100000}
              required={supportingFiles.length === 0}
              readOnly={extracting || busy}
            />
            <span className="field-help">Both parties will see this context. It helps the mediator research the right law and market evidence.</span>
            <span className="label-with-help">
              Attach context files (optional)
              <button type="button" className="help-icon" title="Attach a lease, notice, receipt, image, or other rental evidence. Files are shared with both parties and the mediator." aria-label="About context files">?</button>
            </span>
            <input
              type="file"
              multiple
              disabled={extracting || busy}
              accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/*"
              onChange={async e => {
                const input = e.currentTarget;
                const files = Array.from(e.target.files ?? []);
                if (supportingFiles.length + files.length > MAX_SUPPORTING_FILES) {
                  setError(`You can attach up to ${MAX_SUPPORTING_FILES} files.`);
                  input.value = '';
                  return;
                }
                try {
                  const next = await Promise.all(files.map(prepareSupportingFile));
                  setSupportingFiles(previous => [...previous, ...next]);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not read file');
                }
                input.value = '';
              }}
            />
            {supportingFiles.length > 0 && (
              <div className="file-list">
                {supportingFiles.map((file, index) => (
                  <div className="file-chip" key={`${file.name}-${index}`}>
                    <span>{file.name}</span>
                    <button type="button" disabled={extracting || busy} onClick={() => setSupportingFiles(files => files.filter((_, i) => i !== index))}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="btn ghost" aria-controls="opening-terms" disabled={extracting || busy || (rentalContext.trim().length < 20 && supportingFiles.length === 0)} onClick={() => void extractRentalTerms()}>
              {extracting ? 'Analyzing context…' : 'Analyze context and files'}
            </button>
          </label>

          <section id="opening-terms" className="term-card stack" aria-labelledby="opening-terms-heading" aria-busy={extracting}>
            <h3 id="opening-terms-heading">Your opening terms</h3>
            <p id="opening-terms-help" className="field-help">
              Each row is one value. Write them manually or use Analyze above; analyzing again replaces this list.
            </p>
            <p role="status" className={analysisNotice.startsWith('No opening') ? 'analysis-status warning' : 'muted'}>
              {extracting ? 'Analyzing your context and files...' : analysisNotice}
            </p>
            <div className="compact-term-list">
              {terms.map((item, index) => (
                <div className="compact-term-row" key={`${item.name}-${index}`}>
                  <input
                    aria-label={`Term ${index + 1} name`}
                    value={item.name}
                    onChange={e => setTerms(previous => previous.map((current, i) => i === index ? { ...current, name: e.target.value } : current))}
                    readOnly={extracting || busy}
                    placeholder="Term, e.g. Monthly rent"
                    required
                  />
                  <input
                    aria-label={`Term ${index + 1} opening value`}
                    value={item.valueA}
                    onChange={e => { setTerms(previous => previous.map((current, i) => i === index ? { ...current, valueA: e.target.value } : current)); setAnalysisNotice(''); }}
                    readOnly={extracting || busy}
                    placeholder="Your value"
                    required
                  />
                  <input
                    aria-label={`Term ${index + 1} unit`}
                    value={item.unit}
                    onChange={e => setTerms(previous => previous.map((current, i) => i === index ? { ...current, unit: e.target.value } : current))}
                    readOnly={extracting || busy}
                    placeholder="Unit, e.g. INR/month"
                  />
                </div>
              ))}
            </div>
          </section>

          <div className="row">
            <button type="submit" className="btn" disabled={!isActive || busy || extracting}>
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
