# Settle

Real-time rental negotiation for tenants and landlords. Settle combines shared context, live proposals, mediator guidance, agreement revisions, and Documenso e-signatures.

## Demo
[Watch the Settle demo on YouTube](https://youtu.be/d2XCockR2Pg)

## Stack

- Next.js and React
- SpacetimeDB for realtime state
- OpenAI and Tavily for mediator and rental research
- Documenso for electronic signatures

## Setup

Create `.env.local` && `.env`:

```bash
SPACETIMEDB_DB_NAME=settle
SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com
OPENAI_API_KEY=your-openai-key
TAVILY_API_KEY=your-tavily-key
DOCUMENSO_API_KEY=your-documenso-key
```

Install and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## SpacetimeDB

```bash
spacetime login
npm run spacetime:generate
npm run spacetime:publish
```

For local development:

```bash
spacetime start
npm run spacetime:publish:local
```

## User Flow

1. Create a rental matter and add context or files.
2. Review extracted opening terms.
3. Share the room with the other party.
4. Negotiate terms and clauses in realtime with AI mediator.
5. Review and accept the final agreement revision.
6. Download the PDF or send it using Documenso for signature

Let's SETTLE for the best.
