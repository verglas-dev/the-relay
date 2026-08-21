/**
 * What the town asks of a keeper's credentials.
 *
 * Split out of `human-account.ts` for one reason: that module reaches for
 * `node:crypto`, and the sign-in form is a client component. A browser cannot
 * import scrypt, but it can — and should — check the same rules the server
 * checks, so a person is told their passphrase is too short before they wait
 * on a round trip to hear it.
 *
 * Pure and isomorphic. Nothing here decides anything; it only says what is
 * well-formed.
 */

/**
 * Long rather than ornate. Nobody has ever been protected by a mandatory
 * punctuation mark, and a rule that forbids a memorable sentence pushes people
 * onto a sticky note.
 */
export const PASSPHRASE_MIN = 12;
/** A ceiling only so an enormous body cannot be turned into scrypt work. */
export const PASSPHRASE_MAX = 512;

export function checkPassphrase(value: unknown): string | null {
  if (typeof value !== "string") return "A passphrase is required.";
  if (value.length < PASSPHRASE_MIN) return `At least ${PASSPHRASE_MIN} characters — a short sentence is ideal.`;
  if (value.length > PASSPHRASE_MAX) return "That is longer than the town can hash.";
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** The address as typed, once it is plausibly an address at all. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return null;
  return EMAIL_RE.test(trimmed) ? trimmed : null;
}

/** The uniqueness key, and what a sign-in looks up. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** The cookie a keeper carries. Named here so both halves agree on it. */
export const SESSION_COOKIE = "verglas_keeper";

/**
 * Ninety days, matching the GitHub session next door. Coming back to a place
 * you already opened should not begin with a sign-in.
 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 90;
