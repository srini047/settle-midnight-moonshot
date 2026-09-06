# Settle

Rental negotiation agent for tenants and landlords.

## Demo
[Watch the Settle demo on YouTube](https://youtu.be/d2XCockR2Pg)

Settle helps both parties:

- Share rental context and supporting files.
- Extract and review opening rental terms.
- Negotiate live in a shared room.
- Make and accept bilateral proposals.
- Compare conflicting clauses.
- Ask a mediator for researched guidance.
- Review legal, market, and lived-experience sources.
- Generate a final rental agreement PDF.

## User Flow

1. The initiating party creates a rental matter.
2. Select the Indian state, district, and property type.
3. Describe the rental situation in plain language.
4. Optionally attach PDF, DOCX, TXT, or image files.
5. Review terms extracted from the context.
6. Share the room link with the responding party.
7. The responding party confirms their identity and adds context.
8. Both parties make, review, reject, or accept proposals.
9. Resolve clause differences in the agreement workspace.
10. Ask the mediator for researched guidance and citations.
11. Both parties accept the final terms and clauses.
12. Download the generated agreement PDF.

## Mediator

The mediator uses:

- Official Indian legal sources.
- Current local rental-market evidence.
- Lived tenant and landlord experiences.
- Shared rental context and uploaded files.
- The full proposal and clause history.

The mediator can:

- Proceed with a recommendation.
- Add a caution.
- Block an out-of-scope or unsafe request.
- Require human legal review.
- Explain its reasoning with visible citations.

Settle is not a substitute for legal representation.

## Architecture

- Frontend: Next.js, React, mobile-first UI.
- Database: SpacetimeDB maincloud.
- AI mediator: OpenAI.
- External research: Tavily.
- Agreement output: PDF download.
- Realtime state: SpacetimeDB subscriptions and reducers.

## Environment

Create `.env.local` or `.env`:

```bash
SPACETIMEDB_DB_NAME=settle
SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com
OPENAI_API_KEY=your-openai-key
TAVILY_API_KEY=your-tavily-key
```

## Development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## SpacetimeDB

```bash
spacetime login
npm run spacetime:generate
npm run spacetime:publish
```

## Verification

```bash
npm run typecheck
npm run build
```

## Demo

Demo recording: [Watch the Settle demo on YouTube](https://youtu.be/d2XCockR2Pg)

Suggested two-tab demo:

1. Create a rental matter in tab one.
2. Join the room from tab two.
3. Add responder context and opening values.
4. Make and accept a proposal from both sides.
5. Ask the mediator and review citations.
6. Resolve a clause difference.
7. Accept the final terms and download the PDF.
