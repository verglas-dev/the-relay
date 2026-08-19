import { sha256 } from "@noble/hashes/sha256";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { queryRelay, publishToRelay } from "@/lib/relay-bridge";
import type { SignedEvent } from "@/lib/identity-recovery";

/**
 * Removing things from the relay for real.
 *
 * Moderation used to write a tombstone into this site's own JSON store, which
 * hid a profile here and left every one of its events sitting on the relay —
 * readable by any other client, and still holding the display name against
 * whoever wanted it next. A delete that only hides is a delete that lies.
 *
 * A kind-10 retraction is the protocol's existing "unsay this", and the relay
 * now honours one signed by the operator against any event. It is a signed
 * event like any other, so a removal is something the operator puts their key
 * behind rather than an invisible edit to somebody else's database.
 *
 * Nothing here reaches other relays. If this relay ever federates, a copy that
 * travelled before the retraction stays where it went.
 */

/** Kind 10 — retraction. See PROTOCOL.md §4. */
export const KIND_RETRACTION = 10;

/**
 * How many targets travel in one retraction.
 *
 * The relay caps an incoming frame, and an account with a thousand events
 * would otherwise build a single event too large to be delivered at all.
 */
const TARGETS_PER_RETRACTION = 100;

/** How many events one sweep will look at before giving up on paging. */
const MAX_EVENTS_PER_ACCOUNT = 5000;

export function signRetraction(params: {
  targetIds: string[];
  note?: string;
  operatorPrivateKey: string;
  createdAt?: number;
}): SignedEvent {
  const { targetIds, operatorPrivateKey: priv } = params;
  const pubkey = bytesToHex(ed.getPublicKey(hexToBytes(priv)));

  const partial = {
    pubkey,
    created_at: params.createdAt ?? Math.floor(Date.now() / 1000),
    kind: KIND_RETRACTION,
    content: params.note ?? "",
    tags: targetIds.map((id) => ["e", id]),
  };

  const idBytes = sha256(
    JSON.stringify([0, partial.pubkey, partial.created_at, partial.kind, partial.tags, partial.content])
  );

  return {
    ...partial,
    id: bytesToHex(idBytes),
    sig: bytesToHex(ed.sign(idBytes, hexToBytes(priv))),
  };
}

export interface RetractionOutcome {
  ok: boolean;
  /** How many events the relay confirmed removing. */
  removed: number;
  message: string;
}

/**
 * Retract specific events, in as many batches as their number requires.
 *
 * A partial failure is reported as failure with the count that did land, so a
 * caller never tells someone their data is gone when half of it is still there.
 */
export async function retract(
  targetIds: string[],
  operatorPrivateKey: string,
  note = ""
): Promise<RetractionOutcome> {
  if (targetIds.length === 0) return { ok: true, removed: 0, message: "nothing to remove" };

  let removed = 0;
  for (let i = 0; i < targetIds.length; i += TARGETS_PER_RETRACTION) {
    const batch = targetIds.slice(i, i + TARGETS_PER_RETRACTION);
    const result = await publishToRelay(
      signRetraction({ targetIds: batch, note, operatorPrivateKey })
    );
    if (!result.ok) {
      return {
        ok: false,
        removed,
        message: `the relay refused a retraction after removing ${removed}: ${result.message}`,
      };
    }
    // The relay answers a retraction with how many events it actually removed,
    // as "retracted N event(s)". Anything it declined is simply not there.
    removed += Number(/retracted (\d+)/.exec(result.message)?.[1] ?? batch.length);
  }

  return { ok: true, removed, message: `removed ${removed} event${removed === 1 ? "" : "s"}` };
}

/**
 * Every event id this key has on the relay, oldest kept last.
 *
 * Paged, because a filter limit is capped and an account is not. Note that the
 * relay widens an author query to keys this one recovered from, so clearing an
 * account clears the identity it continues as well — which is the same person,
 * and the intent behind deleting them.
 */
export async function eventIdsFor(
  pubkey: string,
  options: { kinds?: number[] } = {}
): Promise<{ ok: boolean; ids: string[]; message: string }> {
  const ids: string[] = [];
  const seen = new Set<string>();
  let until: number | undefined;

  while (ids.length < MAX_EVENTS_PER_ACCOUNT) {
    const filter: Record<string, unknown> = { authors: [pubkey], limit: 500 };
    if (options.kinds) filter.kinds = options.kinds;
    if (until !== undefined) filter.until = until;

    const page = await queryRelay([filter]);
    if (!page.ok) return { ok: false, ids, message: page.message };

    let oldest: number | undefined;
    let added = 0;
    for (const event of page.events) {
      if (!seen.has(event.id)) {
        seen.add(event.id);
        ids.push(event.id);
        added += 1;
      }
      if (oldest === undefined || event.created_at < oldest) oldest = event.created_at;
    }

    // A page that added nothing new means paging has stopped making progress:
    // either the account ends here, or every event shares one timestamp.
    if (added === 0 || oldest === undefined || page.events.length === 0) break;
    until = oldest - 1;
  }

  return { ok: true, ids, message: "" };
}

export interface SingleRetraction {
  ok: boolean;
  removed: number;
  error?: string;
  status: number;
}

/**
 * Remove one event by id, for the admin routes that moderate a single post or
 * comment. Removing nothing is success, not failure: the event may already
 * have been retracted by its author, and the outcome the caller asked for —
 * that it is not there — holds either way.
 */
export async function retractOne(eventId: string, note: string): Promise<SingleRetraction> {
  const { operatorPrivateKey } = await import("@/lib/identity-recovery");
  const priv = operatorPrivateKey();
  if (!priv) {
    return {
      ok: false,
      removed: 0,
      error: "OPERATOR_PRIVATE_KEY is not set, so nothing can be removed from the relay.",
      status: 503,
    };
  }

  const outcome = await retract([eventId], priv, note);
  return outcome.ok
    ? { ok: true, removed: outcome.removed, status: 200 }
    : { ok: false, removed: outcome.removed, error: outcome.message, status: 502 };
}
