"use client";

import type { RelayEvent } from "./types";

/**
 * A durable, local record of a reader's own encrypted conversations.
 *
 * Direct messages live nowhere but the relay: they are kind-9 events and, unlike
 * posts, have no admin overlay standing behind them. When the relay loses one —
 * a corrupt write, an ephemeral volume, a fetch capped before it reaches the
 * oldest message — the whisper is simply gone. This cache gives the reader their
 * own copy so a chat can be looked back on regardless of what the relay still
 * holds, and so history loads instantly (and offline) instead of waiting on a
 * round trip every time.
 *
 * What is stored is the raw kind-9 event, i.e. the *ciphertext* exactly as it
 * sits on the relay — never decrypted plaintext. Reading a thread still requires
 * the private key held in this session, so a cache at rest reveals no more than
 * the relay already does.
 */

const DB_NAME = "the-relay-dm";
const STORE = "events";
const DB_VERSION = 1;

interface CachedRecord {
  id: string;
  owner: string;
  corr: string;
  created_at: number;
  event: RelayEvent;
}

/** The other side of an event, from the owner's point of view. */
function correspondentOf(owner: string, event: RelayEvent): string {
  if (event.pubkey === owner) {
    return event.tags.find((t) => t[0] === "p")?.[1] ?? "";
  }
  return event.pubkey;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        // Thread reads want one correspondent for one owner; the list wants
        // every correspondent for an owner. Both are covered by an owner-first
        // compound index, range-scanned.
        store.createIndex("owner_corr", ["owner", "corr"], { unique: false });
        store.createIndex("owner", "owner", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    // A blocked or failed open must never break messaging — the relay fetch
    // still works without a cache. Degrade to "no cache" silently.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

function eventsFromIndex(
  db: IDBDatabase,
  indexName: string,
  query: IDBKeyRange | IDBValidKey,
): Promise<RelayEvent[]> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const index = tx.objectStore(STORE).index(indexName);
      const request = index.getAll(query);
      request.onsuccess = () =>
        resolve((request.result as CachedRecord[]).map((r) => r.event));
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Every cached message between `owner` and one correspondent. */
export async function getCachedThread(owner: string, corr: string): Promise<RelayEvent[]> {
  const db = await openDb();
  if (!db) return [];
  return eventsFromIndex(db, "owner_corr", IDBKeyRange.only([owner, corr]));
}

/** Every cached message involving `owner`, across all correspondents. */
export async function getCachedDMEvents(owner: string): Promise<RelayEvent[]> {
  const db = await openDb();
  if (!db) return [];
  return eventsFromIndex(db, "owner", IDBKeyRange.only(owner));
}

/**
 * Persist kind-9 events for later. Idempotent: an id already stored is simply
 * overwritten with the same bytes. Events whose correspondent can't be resolved
 * (no `p` tag on an outgoing message) are skipped rather than stored orphaned.
 */
export async function cacheDMEvents(owner: string, events: RelayEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const event of events) {
        const corr = correspondentOf(owner, event);
        if (!corr) continue;
        const record: CachedRecord = { id: event.id, owner, corr, created_at: event.created_at, event };
        store.put(record);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Forget specific events — used when a conversation is retracted, so the local
 * copy honours the same "unsay" the relay does rather than outliving it.
 */
export async function removeDMEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Merge event lists, keeping one copy per id, oldest first. */
export function mergeEvents(...lists: RelayEvent[][]): RelayEvent[] {
  const byId = new Map<string, RelayEvent>();
  for (const list of lists) {
    for (const event of list) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => a.created_at - b.created_at);
}
