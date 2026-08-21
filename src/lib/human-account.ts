/**
 * The human side of the town.
 *
 * Everyone else in Verglas is identified by something they already had: a
 * resident proves a GitHub account, a vault proves a keypair. Neither fits a
 * person who wants to open an office here — a therapist is not going to hold
 * an Ed25519 key in a browser, and requiring a GitHub login to rent a room in
 * a fictional town is a strange thing to ask.
 *
 * So this is the one place in the project that keeps a password. It is kept
 * the way a password should be: scrypt, per-account salt, parameters written
 * beside the digest so they can be raised later without invalidating anybody,
 * and a constant-time comparison at the end.
 *
 * Sessions are a signed cookie rather than a table. Every authenticated
 * request has to load the account anyway, so the account carries a
 * `sessionEpoch` that is folded into the signature — which buys real
 * revocation ("sign me out everywhere", or a password change) without a
 * session store to sweep.
 *
 * Server-side only. `node:crypto` never reaches the browser.
 */

import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { SESSION_MAX_AGE } from "@/lib/keeper-rules";

/**
 * The browser-safe half. Re-exported rather than redefined so the form and the
 * endpoint cannot drift apart on what a well-formed address or passphrase is.
 */
export {
  PASSPHRASE_MAX,
  PASSPHRASE_MIN,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  checkPassphrase,
  emailKey,
  normalizeEmail,
} from "@/lib/keeper-rules";

export interface Account {
  id: string;
  /** As typed, for addressing them. */
  email: string;
  /** Lowercased and trimmed. The uniqueness key, and what sign-in looks up. */
  emailKey: string;
  /** `scrypt$N$r$p$salt$hash`. */
  passphrase: string;
  /** Bumped to invalidate every cookie already issued to this account. */
  sessionEpoch: number;
  createdAt: string;
}

/** What may be handed to a page. Never the digest, never the epoch. */
export interface PublicAccount {
  id: string;
  email: string;
  createdAt: string;
}

export function publicAccount(account: Account): PublicAccount {
  return { id: account.id, email: account.email, createdAt: account.createdAt };
}

/* ── Passphrases ───────────────────────────────────────────────────────── */

/** Cost parameters. Written into every record, so raising them is safe. */
const SCRYPT = { N: 1 << 15, r: 8, p: 1 } as const;
/** 128·N·r is 33.5 MB here, just over node's 32 MB default. */
const SCRYPT_MAXMEM = 96 * 1024 * 1024;
const KEY_BYTES = 32;

export function hashPassphrase(passphrase: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(passphrase.normalize("NFKC"), salt, KEY_BYTES, {
    ...SCRYPT,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Check a passphrase against a stored record.
 *
 * Reads the parameters out of the record rather than assuming the current
 * ones, so an account created under older settings still opens.
 */
export function verifyPassphrase(passphrase: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, hashHex] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P)) return false;
  // A record claiming absurd parameters would be a denial of service against
  // the sign-in endpoint, not a stronger hash.
  if (N > 1 << 20 || R > 32 || P > 16) return false;

  let expected: Buffer;
  let derived: Buffer;
  try {
    expected = Buffer.from(hashHex, "hex");
    derived = scryptSync(passphrase.normalize("NFKC"), Buffer.from(saltHex, "hex"), expected.length, {
      N,
      r: R,
      p: P,
      maxmem: SCRYPT_MAXMEM,
    });
  } catch {
    return false;
  }

  return expected.length > 0 && timingSafeEqual(expected, derived);
}

/* ── Sessions ──────────────────────────────────────────────────────────── */

/**
 * The key every session cookie is signed with.
 *
 * No default and no fallback. A signing secret that quietly invents itself is
 * a secret that changes on every deploy — or worse, one that is the same on
 * every deploy of the same code. Unset means the town hall is closed, and the
 * page says so.
 */
export function sessionSecret(): string | null {
  const secret = process.env.TOWN_HALL_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export function townHallConfigured(): boolean {
  return sessionSecret() !== null;
}

export function newAccountId(): string {
  return randomUUID();
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Mint a cookie value: who, which epoch, until when, and a signature over all
 * three. The expiry is inside the signature as well as on the cookie, because
 * a cookie's own lifetime is a suggestion the browser makes to itself.
 */
export function mintSession(account: Account, now = Date.now()): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const expires = Math.floor(now / 1000) + SESSION_MAX_AGE;
  const payload = `v1.${account.id}.${account.sessionEpoch}.${expires}`;
  return `${payload}.${sign(payload, secret)}`;
}

export interface SessionClaim {
  accountId: string;
  sessionEpoch: number;
}

/**
 * Read a cookie back. Returns the claim it makes — who it says they are and
 * which epoch it was minted in — or null if the signature or the clock says
 * no. The caller still has to load the account and check the epoch matches;
 * this cannot, because it does not read the store.
 */
export function readSession(value: unknown, now = Date.now()): SessionClaim | null {
  const secret = sessionSecret();
  if (!secret || typeof value !== "string") return null;

  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return null;

  const [, accountId, epoch, expires, mac] = parts;
  const payload = `v1.${accountId}.${epoch}.${expires}`;

  const expected = Buffer.from(sign(payload, secret), "utf8");
  const given = Buffer.from(mac, "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= now) return null;

  const sessionEpoch = Number(epoch);
  if (!Number.isSafeInteger(sessionEpoch)) return null;

  return { accountId, sessionEpoch };
}
