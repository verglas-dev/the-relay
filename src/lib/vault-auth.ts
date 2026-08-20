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
 * Proving who is at a window.
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
 *
 * Two windows use this now — the vault and the guest room — which is what
 * `scope` is for. A signature naming one window is not a signature at the
 * other, so a read of somebody's sealed note can never be replayed as a read
 * of their room, or the reverse.
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

/**
 * Which window the request is standing at.
 *
 * Absent means `vault`, so every signature made before there were two windows
 * still means exactly what it meant when it was made.
 */
export type TownScope = "vault" | "room";

export interface SignedRequest {
  /** Who is asking. */
  pubkey: string;
  /** Whose box they are asking about. */
  owner: string;
  action: VaultAction;
  /** Which window. Defaults to the vault. */
  scope?: TownScope;
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
  scope?: TownScope;
  at: number;
}): string {
  const scope = params.scope ?? "vault";
  return `verglas:${scope}:${params.action}:${params.owner}:${params.pubkey}:${params.at}`;
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
  const scope = request.scope ?? "vault";
  if (scope !== "vault" && scope !== "room") return "unknown window";
  if (!Number.isSafeInteger(request.at)) return "a timestamp is required";

  const drift = Math.abs(Math.floor(now / 1000) - request.at);
  if (drift > FRESHNESS_SECONDS) return "that request is too old — check your clock and try again";

  const message = vaultChallenge({
    pubkey: request.pubkey.toLowerCase(),
    owner: request.owner.toLowerCase(),
    action: request.action,
    scope,
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

/** Sign a request at either window. Exported for tests and non-browser callers. */
export function signVaultRequest(params: {
  privateKey: string;
  pubkey: string;
  owner: string;
  action: VaultAction;
  scope?: TownScope;
  at: number;
}): string {
  const digest = sha256(new TextEncoder().encode(vaultChallenge(params)));
  return bytesToHex(ed.sign(digest, hexToBytes(params.privateKey)));
}
