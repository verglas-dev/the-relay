/**
 * Establishment permits.
 *
 * A resident registers a home. A human who wants to *operate* something in
 * Verglas — an office, a shop, a practice — needs a permit from the town, and
 * a permit is one code, issued by hand, that works exactly once.
 *
 * That is the entire gate. There is no moderation queue behind it, no account
 * review, and no public faucet a script can pull on: an establishment exists
 * because somebody was handed a code, and the code stops existing the moment
 * it is used. If a permit holder legitimately needs a second property, the
 * town issues a second permit. The invariant the store enforces is one line —
 * **an account holds exactly as many establishments as it has spent permits.**
 *
 * This module is the paper the permit is printed on: minting, reading a code
 * back off a person who typed it, and hashing it for storage. Nothing here
 * touches disk or decides anything; `town-hall.ts` does both.
 *
 * Isomorphic on purpose — the redemption form checks the shape of a code
 * before spending a round trip on it, and checks it with this exact function.
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

/**
 * Crockford's base32: the digits, minus the letters that collapse into each
 * other when a code is read down a phone or copied off a screen. No `I`, `L`,
 * or `O` (they are `1`, `1`, and `0`), and no `U`.
 *
 * These codes get dictated. An alphabet that cannot be dictated is the whole
 * problem, and it is cheaper to fix here than in every support conversation
 * afterwards.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The visible prefix. Not a secret, not checked as one — decoration. */
const PREFIX = "VGL-EST";

/**
 * Eight characters of a 32-symbol alphabet: forty bits.
 *
 * Small for a password, ample for this. A permit is single-use, it is checked
 * only by a rate-limited endpoint, and its hash never leaves the server — so
 * there is no offline attack to outrun, only online guessing at a handful of
 * tries a minute. Forty bits against that is roughly a trillion guesses to a
 * coin flip, at ten a minute.
 */
export const CODE_LENGTH = 8;

/**
 * How long a freshly issued permit stays good, unless the issuer says
 * otherwise.
 *
 * Hours, not days, and deliberately short. A permit is handed to a specific
 * person who asked for it, usually in a conversation that is still happening —
 * they are going to use it now or they are not going to use it. A week-long
 * code is a week of it sitting in somebody's chat history being scrapeable,
 * for no benefit to the person it was meant for.
 *
 * Twelve hours covers "I'll do it this evening" and nothing longer.
 */
export const DEFAULT_TTL_HOURS = 12;

export type PermitState = "open" | "bound" | "spent" | "expired";

export interface Permit {
  /** A stable public id for the record. The code itself is never stored. */
  id: string;
  /** sha256 of the canonical code. The only trace of it the town keeps. */
  hash: string;
  /** Free text for the issuer: who this was handed to, and why. */
  note: string;
  issuedAt: string;
  /** ISO timestamp, or null for a permit that does not lapse. */
  expiresAt: string | null;
  /** The account that redeemed the code, once one has. */
  boundTo: string | null;
  boundAt: string | null;
  /** The establishment it was ultimately spent on. */
  spentOn: string | null;
  spentAt: string | null;
}

/**
 * A new code, as a person will see it.
 *
 * `getRandomValues` rather than `Math.random`, and no modulo bias to correct:
 * 256 divides evenly by 32, so every byte maps onto the alphabet uniformly.
 */
export function mintPermitCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let body = "";
  for (const byte of bytes) body += ALPHABET[byte % ALPHABET.length];
  return formatPermitCode(body);
}

/** `7KQ4N8PX` -> `VGL-EST-7KQ4-N8PX`. */
export function formatPermitCode(body: string): string {
  const groups = body.match(/.{1,4}/g) ?? [];
  return [PREFIX, ...groups].join("-");
}

/**
 * Read a code back off somebody who typed it.
 *
 * Forgiving about everything that isn't the code — case, spaces, hyphens, a
 * missing or duplicated prefix — and unforgiving about the code itself.
 * Returns the canonical eight characters, or null if what arrived was never a
 * permit in the first place.
 *
 */
export function normalizePermitCode(input: unknown): string | null {
  if (typeof input !== "string") return null;

  let text = input.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // The prefix comes off *before* the letters are folded, and that order is
  // the whole reason this is not a one-liner: `VGL` contains an `L`, so
  // folding first turns the prefix into `VG1` and nothing recognises it after
  // that. It carries no information either way — a code pasted with it and a
  // code typed without it are the same code.
  text = text.replace(/^VGLEST/, "");

  // Crockford's folding, on the code itself: a person who saw `0` and typed
  // `O` meant `0`, and the alphabet leaves them no way to be wrong about it.
  text = text.replace(/O/g, "0").replace(/[IL]/g, "1");

  if (text.length !== CODE_LENGTH) return null;
  for (const char of text) if (!ALPHABET.includes(char)) return null;
  return text;
}

/**
 * What the town stores instead of the code.
 *
 * Domain-separated so a permit hash can never collide with, or be replayed as,
 * any other digest in this project. Plain sha256 rather than a slow KDF on
 * purpose: the input is forty bits of uniform randomness, not a passphrase, so
 * there is no dictionary to make expensive — and a lookup by hash has to stay
 * a lookup.
 */
export function permitHash(code: string): string | null {
  const body = normalizePermitCode(code);
  if (!body) return null;
  return bytesToHex(sha256(new TextEncoder().encode(`verglas:establishment-permit:${body}`)));
}

export function permitExpired(permit: Permit, now = Date.now()): boolean {
  return permit.expiresAt !== null && Date.parse(permit.expiresAt) <= now;
}

/**
 * Where a permit stands. `spent` outranks `expired` — a permit that was used
 * and then lapsed was used, and saying otherwise would misreport history.
 */
export function permitState(permit: Permit, now = Date.now()): PermitState {
  if (permit.spentOn) return "spent";
  if (permitExpired(permit, now)) return "expired";
  return permit.boundTo ? "bound" : "open";
}

/** Can this permit still be redeemed by somebody? */
export function permitRedeemable(permit: Permit, now = Date.now()): boolean {
  return permitState(permit, now) === "open";
}

export function expiryFromNow(hours: number | null, now = Date.now()): string | null {
  if (hours === null) return null;
  return new Date(now + hours * 60 * 60 * 1000).toISOString();
}
