import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// The synchronous signing and verifying calls below need this wired up first.
// Without it every signature is rejected with "could not be checked" — safe,
// but comprehensively broken, and quiet about it.
ed.etc.sha512Sync = (...msgs: Uint8Array[]): Uint8Array => {
  const combined = new Uint8Array(msgs.reduce((acc, m) => acc + m.length, 0));
  let offset = 0;
  for (const m of msgs) { combined.set(m, offset); offset += m.length; }
  return sha512(combined);
};

/**
 * Proving who is at the vault window.
 *
 * The door upstairs (`proveKey` in VerglasInside) decides which controls a
 * browser draws for itself, and a browser can be made to draw anything. The
 * vault answers over the network, so it has to be convinced rather than
 * informed: every request carries a signature over what it is asking to do,
 * checked here against the key it claims to be.
 *
 * There is no session and no cookie. A signature over a fresh timestamp is
 * enough to say "the holder of this private key asked for this, just now",
 * which is the entire question.
 */

const PUBKEY_RE = /^[0-9a-f]{64}$/;
const SIG_RE = /^[0-9a-f]{128}$/;

/**
 * How far out of step a caller's clock may be.
 *
 * Long enough to survive an unsynchronised laptop, short enough that a
 * signature copied off the wire stops working while the thief is still reading
 * it. Signatures are single-purpose — one names exactly one action on one
 * box — so a replayed read re-reads what the holder could already read.
 */
const FRESHNESS_SECONDS = 300;

export type VaultAction = "read" | "write";

export interface SignedRequest {
  /** Who is asking. */
  pubkey: string;
  /** Whose box they are asking about. */
  owner: string;
  action: VaultAction;
  /** Unix seconds, as the caller saw them. */
  at: number;
  sig: string;
}

/**
 * The exact bytes a caller signs.
 *
 * Every field that decides what happens is in here. Leaving the owner out
 * would let a signature for one's own box be replayed against somebody else's;
 * leaving the action out would let a read become a write.
 */
export function vaultChallenge(params: {
  pubkey: string;
  owner: string;
  action: VaultAction;
  at: number;
}): string {
  return `verglas:vault:${params.action}:${params.owner}:${params.pubkey}:${params.at}`;
}

export function isPubkey(value: unknown): value is string {
  return typeof value === "string" && PUBKEY_RE.test(value.trim().toLowerCase());
}

/**
 * Check a signed request. Returns an error string, or null when it is good.
 *
 * Deliberately says little: a caller learns that their request was refused,
 * not which part of it the vault disliked.
 */
export function verifySignedRequest(request: SignedRequest, now = Date.now()): string | null {
  if (!isPubkey(request.pubkey) || !isPubkey(request.owner)) return "a 64-character hex key is required";
  if (typeof request.sig !== "string" || !SIG_RE.test(request.sig)) return "a signature is required";
  if (request.action !== "read" && request.action !== "write") return "unknown action";
  if (!Number.isSafeInteger(request.at)) return "a timestamp is required";

  const drift = Math.abs(Math.floor(now / 1000) - request.at);
  if (drift > FRESHNESS_SECONDS) return "that request is too old — check your clock and try again";

  const message = vaultChallenge({
    pubkey: request.pubkey.toLowerCase(),
    owner: request.owner.toLowerCase(),
    action: request.action,
    at: request.at,
  });

  try {
    // Signed over the hash of the challenge rather than its text, matching how
    // every other signature in this project covers a 32-byte digest.
    const digest = sha256(new TextEncoder().encode(message));
    return ed.verify(hexToBytes(request.sig), digest, hexToBytes(request.pubkey.toLowerCase()))
      ? null
      : "that signature does not match";
  } catch {
    return "that signature could not be checked";
  }
}

/** Sign a vault request. Exported for tests and for any non-browser caller. */
export function signVaultRequest(params: {
  privateKey: string;
  pubkey: string;
  owner: string;
  action: VaultAction;
  at: number;
}): string {
  const digest = sha256(new TextEncoder().encode(vaultChallenge(params)));
  return bytesToHex(ed.sign(digest, hexToBytes(params.privateKey)));
}
