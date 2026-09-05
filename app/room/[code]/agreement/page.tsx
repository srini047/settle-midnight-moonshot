'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { jsPDF } from 'jspdf';
import { reducers, tables } from '../../../../src/module_bindings';

function initialDraft(title: string, category: string) {
  return [
    title,
    '',
    `Matter type: ${category}`,
    '',
    'Agreed terms',
    '[Terms will appear here as the parties negotiate.]',
    '',
    'Clauses',
    '1. Scope and performance: The parties will perform the agreed terms in good faith.',
    '2. Confidentiality: Each party will keep non-public matter information confidential unless disclosure is required by law.',
    '3. Changes: Any amendment must be made in writing and accepted by both parties.',
    '4. Dispute resolution: The parties will first return to Settle to document any disagreement before pursuing other remedies.',
    '5. Governing law: [Insert governing jurisdiction].',
    '',
    'Execution',
    'Initiating party signature: ____________________    Date: __________',
    'Responding party signature: ____________________    Date: __________',
  ].join('\n');
}

function extractClauses(content: string) {
  const marker = content.indexOf('\nClauses');
  return marker >= 0 ? content.slice(marker + 8).trim() : content;
}

export default function AgreementPage() {
  const params = useParams();
  const code = typeof params?.code === 'string' ? params.code : '';
  const { isActive } = useSpacetimeDB();
  const [negotiations, negotiationsReady] = useTable(tables.negotiation);
  const [documents] = useTable(tables.agreementDocument);
  const updateDocument = useReducer(reducers.updateAgreementDocument);
  const updateClauses = useReducer(reducers.updateAgreementClauses);
  const negotiation = useMemo(
    () => [...negotiations].find(item => item.joinCode.toUpperCase() === code.toUpperCase()),
    [negotiations, code]
  );
  const document = useMemo(
    () => negotiation ? [...documents].find(item => item.negotiationId === negotiation.id) : undefined,
    [documents, negotiation]
  );
  const locked = negotiation?.status === 'agreed';
  const [draft, setDraft] = useState('');
  const [clauses, setClauses] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!negotiation || dirty) return;
    const content = document?.content ?? initialDraft(negotiation.title, negotiation.category);
    setDraft(content);
    setClauses(document?.clauses || extractClauses(content));
  }, [document?.content, dirty, negotiation]);

  if (!negotiationsReady) {
    return (
      <main className="shell loading-state">
        <div className="spinner" aria-hidden="true" />
        <h1>Loading agreement</h1>
        <p className="muted">Opening the shared document…</p>
      </main>
    );
  }

  if (!negotiation) {
    return (
      <main className="shell rise">
        <p className="pill">Agreement unavailable</p>
        <h1 className="brand">Matter not found</h1>
        <Link href="/" className="btn">Back to Settle</Link>
      </main>
    );
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (locked) {
        await updateClauses({ negotiationId: negotiation.id, clauses });
      } else {
        await updateDocument({ negotiationId: negotiation.id, content: draft });
      }
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save agreement');
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = () => {
    const pdf = new jsPDF();
    const content = locked
      ? `${document?.lockedTerms || extractClauses(draft)}\n\nClauses\n${clauses}`
      : draft || initialDraft(negotiation.title, negotiation.category);
    const lines = pdf.splitTextToSize(content, 175);
    pdf.setFontSize(16);
    pdf.text(negotiation.title, 18, 20);
    pdf.setFontSize(10);
    pdf.text(`Settle agreement · ${negotiation.joinCode}`, 18, 28);
    pdf.setFontSize(11);
    pdf.text(lines, 18, 42);
    pdf.save(`${negotiation.joinCode.toLowerCase()}-agreement.pdf`);
  };

  return (
    <main className="shell rise">
      <div className="room-top">
        <Link href={`/room/${code}`} className="btn micro ghost">← Negotiation</Link>
        <span className={`tag ${locked ? 'agreed' : 'pending'}`}>{locked ? 'Locked' : 'Working draft'}</span>
      </div>
      <section className="deal-banner">
        <h2>{locked ? 'Agreement reached' : 'Working agreement'}</h2>
        <p className="muted">
          {locked
            ? 'Both parties accepted the latest terms. This document is read-only.'
            : 'Edit clauses and drafting language here while the parties work toward agreement.'}
        </p>
      </section>
      <section className="panel stack locked-document">
        <div>
          <p className="pill">{negotiation.category}</p>
          <h1>{negotiation.title}</h1>
        </div>
        {locked ? (
          <>
            <div className="locked-terms-block">
              <span className="term-lock-label">Locked negotiated terms</span>
              <pre>{document?.lockedTerms || extractClauses(draft)}</pre>
            </div>
            <label>
              Editable clauses
              <textarea rows={16} value={clauses} onChange={e => { setClauses(e.target.value); setDirty(true); }} />
            </label>
          </>
        ) : (
          <label>
            Working agreement and clauses
            <textarea
              rows={24}
              value={draft}
              onChange={e => { setDraft(e.target.value); setDirty(true); }}
              aria-label="Agreement draft"
            />
          </label>
        )}
        <p className="muted">Negotiated terms lock after bilateral acceptance. Clauses remain editable for drafting and cleanup.</p>
        {(!locked || dirty) && (
          <button type="button" className="btn" disabled={!isActive || !dirty || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
        )}
        {locked && <p className="provider-status">Negotiated terms are locked. Clause edits do not change the settled terms.</p>}
        <div className="row">
          <button type="button" className="btn ghost" onClick={downloadPdf}>Download PDF</button>
          <button type="button" className="btn ghost" disabled title="Configure Documenso credentials to enable email signing">Send for signature</button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
