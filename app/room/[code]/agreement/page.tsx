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
    `Topic type: ${category}`,
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
  const { isActive, identity: myIdentity } = useSpacetimeDB();
  const [negotiations, negotiationsReady] = useTable(tables.negotiation);
  const [documents] = useTable(tables.agreementDocument);
  const [clausesAll] = useTable(tables.agreementClause);
  const [partiesAll] = useTable(tables.party);
  const updateDocument = useReducer(reducers.updateAgreementDocument);
  const updateClausePosition = useReducer(reducers.updateClausePosition);
  const setClauseResolution = useReducer(reducers.setClauseResolution);
  const acceptClauseResolution = useReducer(reducers.acceptClauseResolution);
  const negotiation = useMemo(
    () => [...negotiations].find(item => item.joinCode.toUpperCase() === code.toUpperCase()),
    [negotiations, code]
  );
  const document = useMemo(
    () => negotiation ? [...documents].find(item => item.negotiationId === negotiation.id) : undefined,
    [documents, negotiation]
  );
  const clausesRows = useMemo(
    () => negotiation ? [...clausesAll].filter(item => item.negotiationId === negotiation.id).sort((a, b) => a.sortOrder - b.sortOrder) : [],
    [clausesAll, negotiation]
  );
  const parties = useMemo(
    () => negotiation ? [...partiesAll].filter(item => item.negotiationId === negotiation.id) : [],
    [negotiation, partiesAll]
  );
  const locked = negotiation?.status === 'agreed';
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clauseDrafts, setClauseDrafts] = useState<Record<string, string>>({});

  const mySide = useMemo(() => {
    if (!myIdentity || !negotiation) return undefined;
    return parties.find(item => item.identity?.toHexString() === myIdentity.toHexString())?.side;
  }, [myIdentity, negotiation, parties]);

  useEffect(() => {
    if (clausesRows.length === 0) return;
    setClauseDrafts(previous => {
      const next = { ...previous };
      for (const clause of clausesRows) {
        next[`${clause.id}:a`] ??= clause.positionA;
        next[`${clause.id}:b`] ??= clause.positionB;
      }
      return next;
    });
  }, [clausesRows]);

  useEffect(() => {
    if (!negotiation || dirty) return;
    const content = document?.content ?? initialDraft(negotiation.title, negotiation.category);
    setDraft(content);
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
      if (locked) return;
      await updateDocument({ negotiationId: negotiation.id, content: draft });
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save agreement');
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = () => {
    const pdf = new jsPDF();
    const clauseText = clausesRows.length > 0
      ? clausesRows.map(clause => `${clause.title}: ${clause.resolution || clause.positionA}`).join('\n')
      : document?.clauses ?? '';
    const content = locked
      ? `${document?.lockedTerms || extractClauses(draft)}\n\nClauses\n${clauseText}`
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

  const saveClausePosition = async (clauseId: bigint, side: 'a' | 'b') => {
    if (locked || mySide !== side) return;
    try {
      await updateClausePosition({ clauseId, text: clauseDrafts[`${clauseId}:${side}`] ?? '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save clause position');
    }
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
        {clausesRows.length > 0 && (
          <section className="clause-workspace stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h2>Clause comparison</h2>
                <p className="muted">See both positions side by side. Differences stay visible until the mediator or both parties resolve them.</p>
              </div>
              <span className="tag">{clausesRows.filter(item => item.status === 'conflict').length} conflicts</span>
            </div>
            {clausesRows.map(clause => {
              const conflict = clause.status === 'conflict';
              return (
                <article className={`clause-card ${conflict ? 'conflict' : 'resolved'}`} key={String(clause.id)}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h3>{clause.title}</h3>
                    <span className={`tag ${conflict ? 'gap' : 'aligned'}`}>{conflict ? 'Different' : clause.status}</span>
                  </div>
                  <div className="clause-columns">
                    <label>
                      Initiating party
                      <textarea
                        rows={4}
                        readOnly={locked || mySide !== 'a'}
                        value={clauseDrafts[`${clause.id}:a`] ?? clause.positionA}
                        onChange={e => setClauseDrafts(previous => ({ ...previous, [`${clause.id}:a`]: e.target.value }))}
                        onBlur={() => void saveClausePosition(clause.id, 'a')}
                      />
                    </label>
                    <label>
                      Responding party
                      <textarea
                        rows={4}
                        readOnly={locked || mySide !== 'b'}
                        value={clauseDrafts[`${clause.id}:b`] ?? clause.positionB}
                        onChange={e => setClauseDrafts(previous => ({ ...previous, [`${clause.id}:b`]: e.target.value }))}
                        onBlur={() => void saveClausePosition(clause.id, 'b')}
                      />
                    </label>
                  </div>
                  {clause.status === 'proposed' && (
                    <div className="clause-resolution">
                      <strong>Mediator resolution</strong>
                      <p>{clause.resolution}</p>
                      {!locked && mySide && (
                        <button type="button" className="btn ok micro" onClick={async () => {
                          try { await acceptClauseResolution({ clauseId: clause.id }); }
                          catch (err) { setError(err instanceof Error ? err.message : 'Could not accept clause'); }
                        }}>Accept this clause</button>
                      )}
                    </div>
                  )}
                  {conflict && !locked && mySide && (
                    <div className="clause-resolution-input">
                      <label>
                        Propose a resolution
                        <textarea
                          rows={3}
                          placeholder="Write a compromise clause or wait for the mediator."
                          onChange={e => setClauseDrafts(previous => ({ ...previous, [`${clause.id}:resolution`]: e.target.value }))}
                        />
                      </label>
                      <button type="button" className="btn ghost micro" disabled={!clauseDrafts[`${clause.id}:resolution`]?.trim()} onClick={async () => {
                        try { await setClauseResolution({ clauseId: clause.id, resolution: clauseDrafts[`${clause.id}:resolution`] ?? '' }); }
                        catch (err) { setError(err instanceof Error ? err.message : 'Could not propose resolution'); }
                      }}>Propose resolution</button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}
        {locked ? (
          <>
            <div className="locked-terms-block">
              <span className="term-lock-label">Locked negotiated terms</span>
              <pre>{document?.lockedTerms || extractClauses(draft)}</pre>
            </div>
            <div className="locked-terms-block">
              <span className="term-lock-label">Resolved clauses</span>
              <pre>{clausesRows.map(clause => `${clause.title}: ${clause.resolution || clause.positionA}`).join('\n') || document?.clauses || 'No clauses recorded.'}</pre>
            </div>
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
        <p className="muted">Negotiated terms and resolved clauses lock after bilateral acceptance. Before that point, each party can resolve their own clause position.</p>
        {!locked && dirty && (
          <button type="button" className="btn" disabled={!isActive || !dirty || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
        )}
        {locked && <p className="provider-status">Negotiated terms and resolved clauses are locked. This page is now read-only.</p>}
        <div className="row">
          <button type="button" className="btn ghost" onClick={downloadPdf}>Download PDF</button>
          <button type="button" className="btn ghost" disabled title="Configure Documenso credentials to enable email signing">Send for signature</button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
