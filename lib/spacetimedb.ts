import { DbConnection } from '../src/module_bindings';

/** Normalize http(s) SpacetimeDB host URLs to the WebSocket scheme the SDK expects. */
export function spacetimeUri(host: string | undefined, fallback: string): string {
  const raw = (host ?? fallback).trim();
  if (raw.startsWith('https://')) return `wss://${raw.slice('https://'.length)}`;
  if (raw.startsWith('http://')) return `ws://${raw.slice('http://'.length)}`;
  return raw;
}

export const SPACETIMEDB_URI = spacetimeUri(
  process.env.NEXT_PUBLIC_SPACETIMEDB_HOST ?? process.env.SPACETIMEDB_HOST,
  'wss://maincloud.spacetimedb.com'
);

export const SPACETIMEDB_DB_NAME =
  process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME ??
  process.env.SPACETIMEDB_DB_NAME ??
  'settle';

export type { DbConnection };
