'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { jsPDF } from 'jspdf';
import { reducers, tables } from '../../../../src/module_bindings';

type DraftSection = { id: string; title: string; body: string };
type DiffLine = { type: 'same' | 'add' | 'remove'; text: string };

function formatTime(micros: bigint): string {
  return new Date(Number(micros / 1000n)).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function parseDraftSections(value: string): DraftSection[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DraftSection => Boolean(
      item && typeof item === 'object' && 'id' in item && 'title' in item && 'body' in item
      && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.body === 'string'
    ));
  } catch {
    return [];
  }
}

function buildLineDiff(before: string, after: string): DiffLine[] {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const matrix = Array.from({ length: oldLines.length + 1 }, () => new Uint16Array(newLines.length + 1));

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      matrix[oldIndex]![newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? matrix[oldIndex + 1]![newIndex + 1]! + 1
        : Math.max(matrix[oldIndex + 1]![newIndex]!, matrix[oldIndex]![newIndex + 1]!);
    }
  }

  const diff: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      diff.push({ type: 'same', text: oldLines[oldIndex]! });
      oldIndex += 1;
      newIndex += 1;
    } else if (oldIndex < oldLines.length && (newIndex >= newLines.length || matrix[oldIndex + 1]![newIndex]! >= matrix[oldIndex]![newIndex + 1]!)) {
      diff.push({ type: 'remove', text: oldLines[oldIndex]! });
      oldIndex += 1;
    } else {
      diff.push({ type: 'add', text: newLines[newIndex]! });
      newIndex += 1;
    }
  }
  return diff;
}

export default function AgreementPage() {
  const params = useParams();
  const code = typeof params?.code === 'string' ? params.code : '';
  const { isActive, identity: myIdentity } = useSpacetimeDB();
  const [negotiations, negotiationsReady] = useTable(tables.negotiation);
  const [documents] = useTable(tables.agreementDocument);
  const [clausesAll] = useTable(tables.agreementClause);
  const [revisionsAll] = useTable(tables.agreementRevision);
  const [draftsAll] = useTable(tables.agreementDraft);
  const [partiesAll] = useTable(tables.party);
  const [termsAll] = useTable(tables.term);
  const [positionsAll] = useTable(tables.position);
  const [supportDocumentsAll] = useTable(tables.supportDocument);

  const updateDocument = useReducer(reducers.updateAgreementDocument);
  const saveAgreementDraft = useReducer(reducers.saveAgreementDraft);
  const applyAgreementDraft = useReducer(reducers.applyAgreementDraft);
  const restoreAgreementRevision = useReducer(reducers.restoreAgreementRevision);
  const acceptAgreementRevision = useReducer(reducers.acceptAgreementRevision);

  const negotiation = useMemo(
    () => [...negotiations].find(item => item.joinCode.toUpperCase() === code.toUpperCase()),
    [negotiations, code]
  );
  const document = useMemo(
    () => negotiation ? [...documents].find(item => item.negotiationId === negotiation.id) : undefined,
    [documents, negotiation]
  );
  const clauses = useMemo(
    () => negotiation
      ? [...clausesAll].filter(item => item.negotiationId === negotiation.id).sort((a, b) => a.sortOrder - b.sortOrder)
      : [],
    [clausesAll, negotiation]
  );
  const revisions = useMemo(
    () => negotiation
      ? [...revisionsAll].filter(item => item.negotiationId === negotiation.id).sort((a, b) => Number(b.revision - a.revision))
      : [],
    [revisionsAll, negotiation]
  );
  const pendingDraft = useMemo(
    () => negotiation ? [...draftsAll].find(item => item.negotiationId === negotiation.id && item.status === 'pending') : undefined,
    [draftsAll, negotiation]
  );
  const parties = useMemo(
    () => negotiation ? [...partiesAll].filter(item => item.negotiationId === negotiation.id) : [],
    [partiesAll, negotiation]
  );
  const mySide = useMemo(() => {
    if (!myIdentity) return undefined;
    return parties.find(item => item.identity?.toHexString() === myIdentity.toHexString())?.side;
  }, [myIdentity, parties]);

  const [documentDraft, setDocumentDraft] = useState('');
  const [documentDirty, setDocumentDirty] = useState(false);
  const [baseRevision, setBaseRevision] = useState<bigint | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  const locked = negotiation?.status === 'agreed';
  const mineAccepted = document && (mySide === 'a'
    ? document.acceptedByA && document.acceptedRevisionA === document.revision
    : document.acceptedByB && document.acceptedRevisionB === document.revision);

  useEffect(() => {
    if (!document || documentDirty) return;
    setDocumentDraft(document.content);
    setBaseRevision(document.revision);
    setConflict(false);
  }, [document, documentDirty]);

  useEffect(() => {
    if (documentDirty && baseRevision !== null && document && document.revision !== baseRevision) {
      setConflict(true);
    }
  }, [baseRevision, document, documentDirty]);

  const buildDraftRequest = () => {
    if (!negotiation || !document) throw new Error('Agreement is still loading');
    const terms = [...termsAll]
      .filter(term => term.negotiationId === negotiation.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(term => {
        const positions = [...positionsAll].filter(position => position.termId === term.id);
        return {
          name: term.name,
          valueA: positions.find(position => parties.find(p => p.id === position.partyId)?.side === 'a')?.value ?? '',
          valueB: positions.find(position => parties.find(p => p.id === position.partyId)?.side === 'b')?.value ?? '',
        };
      });
    return {
      title: negotiation.title,
      category: negotiation.category,
      initialContext: negotiation.initialContext,
      responderContext: negotiation.responderContext,
      jurisdictionState: negotiation.jurisdictionState,
      jurisdictionCity: negotiation.jurisdictionCity,
      propertyType: negotiation.propertyType,
      terms,
      clauses: clauses.map(clause => ({ id: String(clause.id), title: clause.title, text: clause.resolution })),
      currentContent: document.content,
      currentRevision: document.revision.toString(),
      supportDocuments: [...supportDocumentsAll]
        .filter(item => item.negotiationId === negotiation.id)
        .map(item => ({ name: item.name, mimeType: item.mimeType, content: item.content })),
    };
  };

  const saveDocument = async () => {
    if (!document || locked || conflict || baseRevision === null || !documentDirty) return;
    setBusy('Saving agreement…');
    setError(null);
    try {
      await updateDocument({ negotiationId: document.negotiationId, content: documentDraft, expectedRevision: baseRevision });
      setDocumentDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save agreement');
    } finally {
      setBusy(null);
    }
  };

  const generateDraft = async () => {
    if (!document || locked || documentDirty) return;
    setDrafting(true);
    setError(null);
    try {
      const response = await fetch('/api/agreement-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDraftRequest()),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json() as { summary: string; content: string; sections: DraftSection[] };
      await saveAgreementDraft({
        negotiationId: negotiation!.id,
        baseRevision: document.revision,
        content: result.content,
        clauses: JSON.stringify(result.sections),
        summary: result.summary,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate an agreement draft');
    } finally {
      setDrafting(false);
    }
  };

  const applyDraft = async () => {
    if (!document || !pendingDraft || conflict || documentDirty) return;
    setBusy('Applying AI draft…');
    setError(null);
    try {
      await applyAgreementDraft({ negotiationId: document.negotiationId, expectedRevision: document.revision });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply AI draft');
    } finally {
      setBusy(null);
    }
  };

  const restoreRevision = async (revisionId: bigint) => {
    if (!document || locked || conflict || documentDirty) return;
    setBusy('Restoring revision…');
    setError(null);
    try {
      await restoreAgreementRevision({ negotiationId: document.negotiationId, revisionId, expectedRevision: document.revision });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore revision');
    } finally {
      setBusy(null);
    }
  };

  const accept = async () => {
    if (!document || locked || documentDirty || documentDraft.trim().length < 500) return;
    setBusy('Recording acceptance…');
    setError(null);
    try {
      await acceptAgreementRevision({ negotiationId: document.negotiationId, revision: document.revision });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept agreement');
    } finally {
      setBusy(null);
    }
  };

  const downloadPdf = () => {
    if (!document || !negotiation) return;
    const pdf = new jsPDF();
    const lines = pdf.splitTextToSize(document.content, 175);
    pdf.setFontSize(16);
    pdf.text(negotiation.title, 18, 20);
    pdf.setFontSize(10);
    pdf.text(`Settle agreement · ${negotiation.joinCode} · Revision ${String(document.revision)}`, 18, 28);
    pdf.setFontSize(11);
    pdf.text(lines, 18, 42);
    pdf.save(`${negotiation.joinCode.toLowerCase()}-agreement.pdf`);
  };

  if (!negotiationsReady) {
    return <main className="shell loading-state"><div className="spinner" aria-hidden="true" /><h1>Loading agreement</h1><p className="muted">Opening the shared document…</p></main>;
  }

  if (!negotiation || !document) {
    return <main className="shell rise"><p className="pill">Agreement unavailable</p><h1 className="brand">Matter not found</h1><Link href="/" className="btn">Back to Settle</Link></main>;
  }

  const draftSections = pendingDraft ? parseDraftSections(pendingDraft.clauses) : [];
  const agreementDiff = pendingDraft ? buildLineDiff(document.content, pendingDraft.content) : [];

  return (
    <main className="shell rise">
      <div className="room-top">
        <Link href={`/room/${code}`} className="btn micro ghost">← Negotiation</Link>
        <span className={`tag ${locked ? 'agreed' : 'pending'}`}>{locked ? 'Locked' : `Revision ${String(document.revision)}`}</span>
      </div>

      <section className="deal-banner">
        <h2>{locked ? 'Agreement reached' : 'Common rental agreement'}</h2>
        <p className="muted">
          {locked ? 'Both parties accepted this revision. The document is read-only.' : 'A complete rental agreement shared live between both parties. Edit the wording directly or ask AI to update the draft from the latest context.'}
        </p>
      </section>

      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p className="pill">{negotiation.category}</p>
            <h1>{negotiation.title}</h1>
            <p className="muted">Revision {String(document.revision)} · Updated {formatTime(document.updatedAt.microsSinceUnixEpoch)}</p>
          </div>
          <span className="tag">{mySide === 'a' ? 'Initiating party' : 'Responding party'}</span>
        </div>

        {conflict && !locked && (
          <div className="mediator-alert">
            <strong>Another revision arrived while you were editing.</strong>
            <p>Reload the current agreement before saving to avoid overwriting the other party.</p>
            <button type="button" className="btn ghost micro" onClick={() => { setDocumentDirty(false); setConflict(false); }}>Reload current agreement</button>
          </div>
        )}

        <label className="agreement-editor">
          {locked ? 'Locked rental agreement' : 'Shared rental agreement'}
          {locked ? (
            <pre className="agreement-document-preview">{document.content}</pre>
          ) : (
            <textarea
              rows={36}
              readOnly={conflict}
              value={documentDraft}
              onChange={event => { setDocumentDraft(event.target.value); setDocumentDirty(true); }}
              onBlur={() => void saveDocument()}
              aria-label="Shared rental agreement"
            />
          )}
        </label>
        {!locked && documentDirty && <small className="live-update">Changes save when you leave the agreement editor.</small>}

        {!locked && (
          <div className="row">
            <button type="button" className="btn" disabled={!isActive || drafting || busy !== null || conflict || documentDirty} onClick={() => void generateDraft()}>
              {drafting ? 'Generating full agreement…' : 'Update full agreement with AI'}
            </button>
            <button type="button" className="btn ok" disabled={!isActive || busy !== null || conflict || documentDirty || Boolean(mineAccepted) || documentDraft.trim().length < 500} onClick={() => void accept()}>
              {mineAccepted ? 'Accepted by you' : 'Accept this revision'}
            </button>
          </div>
        )}
        <p className="muted">Initiating party: {document.acceptedByA && document.acceptedRevisionA === document.revision ? 'accepted' : 'awaiting'} · Responding party: {document.acceptedByB && document.acceptedRevisionB === document.revision ? 'accepted' : 'awaiting'}</p>
        {locked && <p className="provider-status">This revision is locked because both parties accepted it.</p>}
        <button type="button" className="btn ghost" onClick={downloadPdf}>Download PDF</button>
      </section>

      {pendingDraft && !locked && (
        <section className="panel stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h2>AI agreement draft</h2>
              <p className="muted">Based on revision {String(pendingDraft.baseRevision)} · {pendingDraft.summary}</p>
            </div>
            <span className="tag pending">Review before applying</span>
          </div>
          <div className="agreement-diff" aria-label="Agreement changes">
            <div className="diff-legend">
              <span><i className="diff-swatch removed" /> Removed</span>
              <span><i className="diff-swatch added" /> Added</span>
            </div>
            <div className="diff-code" role="document">
              {agreementDiff.map((line, index) => (
                <div className={`diff-line ${line.type}`} key={`${line.type}-${index}`}>
                  <span className="diff-marker" aria-hidden="true">{line.type === 'remove' ? '-' : line.type === 'add' ? '+' : ' '}</span>
                  <code>{line.text || ' '}</code>
                </div>
              ))}
            </div>
          </div>
          <details>
            <summary>Generated sections ({draftSections.length})</summary>
            <div className="stack agreement-section-list">
              {draftSections.map(section => <div key={section.id}><strong>{section.title}</strong><p>{section.body}</p></div>)}
            </div>
          </details>
          <button type="button" className="btn" disabled={busy !== null || conflict || documentDirty} onClick={() => void applyDraft()}>Apply full AI agreement to shared document</button>
        </section>
      )}

      <section className="panel stack">
        <h2>Version history</h2>
        {revisions.map(revision => (
          <details className="history-proposal" key={String(revision.id)}>
            <summary>Revision {String(revision.revision)} · {revision.source} · {formatTime(revision.changedAt.microsSinceUnixEpoch)}</summary>
            <p>{revision.summary}</p>
            {!locked && revision.revision !== document.revision && (
              <button type="button" className="btn ghost micro" disabled={busy !== null || conflict || documentDirty} onClick={() => void restoreRevision(revision.id)}>Restore as new revision</button>
            )}
          </details>
        ))}
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
