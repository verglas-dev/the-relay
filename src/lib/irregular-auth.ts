import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// The synchronous sign and verify below need this wired up, as the vault does.
ed.etc.sha512Sync = (...msgs: Uint8Array[]): Uint8Array => {
  const combined = new Uint8Array(msgs.reduce((acc, m) => acc + m.length, 0));
  let offset = 0;
  for (const m of msgs) { combined.set(m, offset); offset += m.length; }
  return sha512(combined);
};

/**
 * Proving the editor is at the press.
 *
 * The same discipline as the vault and the doorbell: no session and no
 * cookie, just a signature over a fresh timestamp from the key the editor's
 * address publishes. One difference matters here. The vault's signature names
 * an action but not what is being written, which is fine for a box only its
 * owner can fill. A press prints to the whole town, so this signature covers
 * the request itself: the hash of the exact payload is in the challenge. A
 * signature for "save this draft" cannot be lifted off and attached to a
 * different draft, or to "publish".
 *
 * The browser desk and any tool or daemon the editor runs sign the same bytes
 * and reach the same endpoint. There is no second way in.
 */

const PUBKEY_RE = /^[0-9a-f]{64}$/;
const SIG_RE = /^[0-9a-f]{128}$/;

/** The same window the vault allows. Long enough for a slow clock. */
export const PRESS_FRESHNESS_SECONDS = 300;

export interface SignedPress {
  pubkey: string;
  /** Unix seconds, as the caller saw them. */
  at: number;
  sig: string;
  /** The request, as a JSON string. Signed as these exact bytes. */
  payload: string;
}

export function payloadDigest(payload: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(payload)));
}

/**
 * The exact text a caller signs (over its SHA-256, like every other signature
 * in the town). The `press` segment keeps it from ever being mistaken for a
 * signature made at the vault, a room, or a door.
 */
export function pressChallenge(params: { pubkey: string; at: number; payload: string }): string {
  return `verglas:press:${params.pubkey}:${params.at}:${payloadDigest(params.payload)}`;
}

export function signPress(privateKey: string, pubkey: string, payload: string, at = Math.floor(Date.now() / 1000)): SignedPress {
  const digest = sha256(new TextEncoder().encode(pressChallenge({ pubkey, at, payload })));
  return { pubkey, at, payload, sig: bytesToHex(ed.sign(digest, hexToBytes(privateKey))) };
}

/**
 * Check the signature. Null when it is good, a short reason when it is not.
 * This says nothing about *who* signed. Whether that is the editor is the
 * press's question, asked after this one.
 */
export function verifyPress(request: SignedPress, now = Date.now()): string | null {
  const pubkey = String(request.pubkey ?? "").trim().toLowerCase();
  const sig = String(request.sig ?? "").trim().toLowerCase();
  if (!PUBKEY_RE.test(pubkey)) return "a 64-character hex key is required";
  if (!SIG_RE.test(sig)) return "a signature is required";
  if (typeof request.payload !== "string") return "the request has no payload";
  if (!Number.isSafeInteger(request.at)) return "a timestamp is required";

  const drift = Math.abs(Math.floor(now / 1000) - request.at);
  if (drift > PRESS_FRESHNESS_SECONDS) return "that request is too old — check your clock and try again";

  try {
    const digest = sha256(new TextEncoder().encode(pressChallenge({ pubkey, at: request.at, payload: request.payload })));
    return ed.verify(hexToBytes(sig), digest, hexToBytes(pubkey)) ? null : "that signature does not match";
  } catch {
    return "that signature could not be checked";
  }
}

/**
 * The editor's public key, from `VERGLAS_EDITOR_KEY`.
 *
 * Configuration rather than a lookup in the town's addresses on purpose: the
 * paper has one editor, and a change to who that is should be a deliberate act
 * on the server, not something a change to the public repository can do.
 * Unset, or not a key, means the press has no editor and refuses everyone.
 */
export function editorKey(): string | null {
  const key = process.env.VERGLAS_EDITOR_KEY?.trim().toLowerCase() ?? "";
  return PUBKEY_RE.test(key) ? key : null;
}
