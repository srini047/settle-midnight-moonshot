import { DbConnection } from '../src/module_bindings';
import { SPACETIMEDB_DB_NAME, SPACETIMEDB_URI } from './spacetimedb';

export type RoomStatusSnapshot = {
  roomId: string;
  negotiation: {
    id: string;
    title: string;
    category: string;
    status: string;
    initialContext: string;
    responderContext: string;
    jurisdictionState: string;
    jurisdictionCity: string;
    propertyType: string;
    acceptedByA: boolean;
    acceptedByB: boolean;
    definitionsConfirmedByA: boolean;
    definitionsConfirmedByB: boolean;
  };
  parties: Array<{ id: string; side: string; label: string; online: boolean; joined: boolean }>;
  terms: Array<{ id: string; name: string; sortOrder: number; positions: Array<{ side: string; value: string; reason: string }> }>;
  offers: Array<{ id: string; status: string; note: string; createdBySide: string; terms: Array<{ termId: string; valueA: string; valueB: string }> }>;
  proposals: Array<{ id: string; status: string; decision: string; diagnosis: string; concerns: string; requiredChanges: string; createdAt: string }>;
  messages: Array<{ speaker: string; body: string; perspective: string; createdAt: string }>;
  clauses: Array<{ id: string; title: string; status: string; resolution: string; sortOrder: number }>;
  agreement: {
    content: string;
    revision: string;
    acceptedByA: boolean;
    acceptedByB: boolean;
    acceptedRevisionA: string;
    acceptedRevisionB: string;
  } | null;
  revisions: Array<{ revision: string; source: string; summary: string; changedAt: string }>;
  events: Array<{ type: string; payload: string; createdAt: string }>;
};

function safeRoomId(value: string): string {
  const roomId = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,32}$/.test(roomId)) throw new Error('Enter a valid room ID');
  return roomId;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function timestampValue(value: { microsSinceUnixEpoch: bigint }): string {
  return value.microsSinceUnixEpoch.toString();
}

export async function readRoomStatus(roomInput: string): Promise<RoomStatusSnapshot | null> {
  const roomId = safeRoomId(roomInput);
  return new Promise((resolve, reject) => {
    let connection: DbConnection | undefined;
    let finished = false;
    const timeout = setTimeout(() => finish(new Error('SpacetimeDB status lookup timed out')), 12_000);

    const finish = (error?: Error, result?: RoomStatusSnapshot | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      connection?.disconnect();
      if (error) reject(error);
      else resolve(result ?? null);
    };

    try {
      connection = DbConnection.builder()
        .withUri(SPACETIMEDB_URI)
        .withDatabaseName(SPACETIMEDB_DB_NAME)
        .onConnect(conn => {
          connection = conn;
          conn.subscriptionBuilder()
            .onApplied(() => {
              const negotiation = [...conn.db.negotiation.iter()].find(row => row.joinCode === roomId);
              if (!negotiation) {
                finish(undefined, null);
                return;
              }
              const id = negotiation.id.toString();
              const relatedQueries = [
                `SELECT * FROM party WHERE negotiation_id = ${id}`,
                `SELECT * FROM term WHERE negotiation_id = ${id}`,
                `SELECT * FROM position WHERE negotiation_id = ${id}`,
                `SELECT * FROM offer WHERE negotiation_id = ${id}`,
                'SELECT * FROM offer_term',
                `SELECT * FROM agent_proposal WHERE negotiation_id = ${id}`,
                `SELECT * FROM mediator_message WHERE negotiation_id = ${id}`,
                `SELECT * FROM agreement_clause WHERE negotiation_id = ${id}`,
                `SELECT * FROM agreement_document WHERE negotiation_id = ${id}`,
                `SELECT * FROM agreement_revision WHERE negotiation_id = ${id}`,
                `SELECT * FROM agreement_draft WHERE negotiation_id = ${id}`,
                `SELECT * FROM event WHERE negotiation_id = ${id}`,
              ];
              conn.subscriptionBuilder()
                .onApplied(() => {
                  const parties = [...conn!.db.party.iter()];
                  const terms = [...conn!.db.term.iter()];
                  const positions = [...conn!.db.position.iter()];
                  const offers = [...conn!.db.offer.iter()];
                  const offerTerms = [...conn!.db.offerTerm.iter()];
                  const proposals = [...conn!.db.agentProposal.iter()];
                  const messages = [...conn!.db.mediatorMessage.iter()];
                  const clauses = [...conn!.db.agreementClause.iter()];
                  const document = [...conn!.db.agreementDocument.iter()][0];
                  const revisions = [...conn!.db.agreementRevision.iter()];
                  const events = [...conn!.db.event.iter()];
                  const sideByPartyId = new Map(parties.map(party => [party.id.toString(), party.side]));

                  finish(undefined, {
                    roomId,
                    negotiation: {
                      id,
                      title: negotiation.title,
                      category: negotiation.category,
                      status: negotiation.status,
                      initialContext: negotiation.initialContext,
                      responderContext: negotiation.responderContext,
                      jurisdictionState: negotiation.jurisdictionState,
                      jurisdictionCity: negotiation.jurisdictionCity,
                      propertyType: negotiation.propertyType,
                      acceptedByA: negotiation.acceptedByA,
                      acceptedByB: negotiation.acceptedByB,
                      definitionsConfirmedByA: negotiation.definitionsConfirmedByA,
                      definitionsConfirmedByB: negotiation.definitionsConfirmedByB,
                    },
                    parties: parties.map(party => ({
                      id: party.id.toString(),
                      side: party.side,
                      label: party.label,
                      online: party.online,
                      joined: Boolean(party.identity),
                    })),
                    terms: terms.sort((a, b) => a.sortOrder - b.sortOrder).map(term => ({
                      id: term.id.toString(),
                      name: term.name,
                      sortOrder: term.sortOrder,
                      positions: positions.filter(position => position.termId === term.id).map(position => ({
                        side: sideByPartyId.get(position.partyId.toString()) ?? 'unknown',
                        value: position.value,
                        reason: position.reason,
                      })),
                    })),
                    offers: offers.map(offer => ({
                      id: offer.id.toString(),
                      status: offer.status,
                      note: offer.note,
                      createdBySide: sideByPartyId.get(offer.createdByPartyId.toString()) ?? 'unknown',
                      terms: offerTerms.filter(item => item.offerId === offer.id).map(item => ({
                        termId: item.termId.toString(),
                        valueA: item.valueA,
                        valueB: item.valueB,
                      })),
                    })),
                    proposals: proposals.map(proposal => ({
                      id: proposal.id.toString(),
                      status: proposal.status,
                      decision: proposal.decision,
                      diagnosis: proposal.diagnosis,
                      concerns: proposal.concerns,
                      requiredChanges: proposal.requiredChanges,
                      createdAt: timestampValue(proposal.createdAt),
                    })),
                    messages: messages.map(message => ({
                      speaker: message.speaker,
                      body: message.body,
                      perspective: message.perspective,
                      createdAt: timestampValue(message.createdAt),
                    })),
                    clauses: clauses.sort((a, b) => a.sortOrder - b.sortOrder).map(clause => ({
                      id: clause.id.toString(),
                      title: clause.title,
                      status: clause.status,
                      resolution: clause.resolution,
                      sortOrder: clause.sortOrder,
                    })),
                    agreement: document ? {
                      content: document.content,
                      revision: document.revision.toString(),
                      acceptedByA: document.acceptedByA,
                      acceptedByB: document.acceptedByB,
                      acceptedRevisionA: document.acceptedRevisionA.toString(),
                      acceptedRevisionB: document.acceptedRevisionB.toString(),
                    } : null,
                    revisions: revisions.sort((a, b) => Number(b.revision - a.revision)).map(revision => ({
                      revision: revision.revision.toString(),
                      source: revision.source,
                      summary: revision.summary,
                      changedAt: timestampValue(revision.changedAt),
                    })),
                    events: events.sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch)).map(event => ({
                      type: event.type,
                      payload: event.payload,
                      createdAt: timestampValue(event.createdAt),
                    })),
                  });
                })
                .onError(() => finish(new Error('Could not read the room tables')))
                .subscribe(relatedQueries);
            })
            .onError(() => finish(new Error('Could not validate the room ID')))
            .subscribe(`SELECT * FROM negotiation WHERE join_code = ${sqlString(roomId)}`);
        })
        .onConnectError((_ctx, error) => finish(error))
        .build();
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Could not connect to SpacetimeDB'));
    }
  });
}
