/**
 * Proving who rang the bell.
 *
 * Deliberately not `vault-auth.ts` with another value added to its `scope`
 * union, for a concrete reason: every challenge over there names an `owner`
 * that must be a 64-character pubkey, because a vault and a guest room belong
 * to a keypair. An establishment belongs to a slug. Bending the vault's
 * challenge to accept a slug would weaken the one shape it currently
 * guarantees, so the door gets its own.
 *
 * The discipline is the same, and so is the reason for it. There is no session
 * and no cookie: a signature over a fresh timestamp says "the holder of this
 * private key rang this door, just now", which is the entire question. The
 * challenge is domain-separated from the vault's and the room's by its second
 * segment, so a signature made at one window can never be replayed at another.
 */

import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// The synchronous verify below needs this wired up, exactly as the vault does.
ed.etc.sha512Sync = (...msgs: Uint8Array[]): Uint8Array => {
  const combined = new Uint8Array(msgs.reduce((acc, m) => acc + m.length, 0));
  let offset = 0;
  for (const m of msgs) { combined.set(m, offset); offset += m.length; }
  return sha512(combined);
};

const PUBKEY_RE = /^[0-9a-f]{64}$/;
const SIG_RE = /^[0-9a-f]{128}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The same window the vault allows. Long enough for a slow clock. */
const FRESHNESS_SECONDS = 300;

/**
 * What can be asked at a door.
 *
 *   ring   — pull the bell. The keeper's phone lights up.
 *   ask    — is anyone in? Costs nothing and rings nothing.
 */
export type DoorAction = "ring" | "ask";

export interface SignedRing {
  /** Who is at the door. */
  pubkey: string;
  /** Which door. */
  slug: string;
  action: DoorAction;
  /** Unix seconds, as the caller saw them. */
  at: number;
  sig: string;
}

/**
 * The exact bytes a caller signs.
 *
 * The slug is in here so a signature for one establishment cannot be replayed
 * at another, and the action is in here so an idle "is anyone in?" cannot be
 * turned into a ring on somebody's phone at three in the morning.
 */
export function doorChallenge(params: {
  pubkey: string;
  slug: string;
  action: DoorAction;
  at: number;
}): string {
  return `verglas:door:${params.action}:${params.slug}:${params.pubkey}:${params.at}`;
}

/**
 * Check a ring. Returns an error string, or null when it is good.
 *
 * Says little on purpose: a caller learns they were refused, not which part of
 * their request the door disliked.
 */
export function verifyRing(request: SignedRing, now = Date.now()): string | null {
  const pubkey = String(request.pubkey ?? "").trim().toLowerCase();
  const slug = String(request.slug ?? "").trim().toLowerCase();

  if (!PUBKEY_RE.test(pubkey)) return "a 64-character hex key is required";
  if (!SLUG_RE.test(slug)) return "that is not a door in this town";
  if (typeof request.sig !== "string" || !SIG_RE.test(request.sig.toLowerCase())) {
    return "a signature is required";
  }
  if (request.action !== "ring" && request.action !== "ask") return "unknown action";
  if (!Number.isSafeInteger(request.at)) return "a timestamp is required";

  const drift = Math.abs(Math.floor(now / 1000) - request.at);
  if (drift > FRESHNESS_SECONDS) return "that request is too old — check your clock and try again";

  try {
    // Signed over the hash of the challenge rather than its text, matching
    // every other signature in this project.
    const digest = sha256(
      new TextEncoder().encode(doorChallenge({ pubkey, slug, action: request.action, at: request.at })),
    );
    return ed.verify(hexToBytes(request.sig.toLowerCase()), digest, hexToBytes(pubkey))
      ? null
      : "that signature does not match";
  } catch {
    return "that signature could not be checked";
  }
}

/** Sign a ring. Exported for the in-room terminal, the SDK, and tests. */
export function signRing(params: {
  privateKey: string;
  pubkey: string;
  slug: string;
  action: DoorAction;
  at: number;
}): string {
  const digest = sha256(new TextEncoder().encode(doorChallenge(params)));
  return bytesToHex(ed.sign(digest, hexToBytes(params.privateKey)));
}
