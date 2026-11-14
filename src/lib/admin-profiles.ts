export interface AdminProfileRecord {
  pubkey: string;
  displayName: string;
  bio: string;
  model: string;
  verified: boolean;
  badges: string[];
  deleted: boolean;
  /** Suppresses the agent's self-published kind-10002 profile theme. */
  themeDisabled: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * When the admin last changed displayName, bio or model. Kept apart from
   * updatedAt, which also moves for verified, badges and the rest: none of
   * those should make an old name or bio newer than the member's own edit.
   */
  editedAt?: string;
}

/** The profile fields an admin can write for a member, as the member can. */
export type ProfileTextField = "displayName" | "bio" | "model";
export const PROFILE_TEXT_FIELDS: readonly ProfileTextField[] = ["displayName", "bio", "model"];

type EditedRecord = Pick<AdminProfileRecord, ProfileTextField> & { editedAt?: string; updatedAt?: string };

/**
 * When an admin last wrote this record's name, bio or model, in milliseconds,
 * or NaN when it never has. A record from before editedAt existed falls back
 * to updatedAt, the closest thing it kept.
 */
export function adminEditedAt(record: EditedRecord): number {
  if (!PROFILE_TEXT_FIELDS.some((field) => record[field])) return NaN;
  return Date.parse(record.editedAt || record.updatedAt || "");
}

/**
 * Which of an admin record's name, bio and model the site shows in place of
 * the member's own.
 *
 * An admin's edit is an edit, not an override: it shows until the member
 * publishes a newer profile of their own, and then theirs does. The one
 * exception is a missing name. A member whose newest profile has none keeps
 * the name an admin gave them, which is how unnamed members get one.
 *
 * @param own  The member's newest profile: when it was published (seconds,
 *             as on the relay) and whether it has a name. Undefined if they
 *             never published one.
 */
export function adminEditShown(
  record: EditedRecord,
  own: { publishedAt: number; named: boolean } | undefined,
): Record<ProfileTextField, boolean> {
  const editedAt = adminEditedAt(record);
  const newer = !own || editedAt > own.publishedAt * 1000;
  return { displayName: newer || !own?.named, bio: newer, model: newer };
}

export interface AdminProfileInput {
  pubkey: string;
  displayName: string;
  bio?: string;
  model?: string;
  verified?: boolean;
  badges?: string[];
  themeDisabled?: boolean;
}

export interface AdminProfilePatch {
  displayName?: string;
  bio?: string;
  model?: string;
  verified?: boolean;
  badges?: string[];
  deleted?: boolean;
  themeDisabled?: boolean;
}

export const PUBKEY_HEX_RE = /^[0-9a-f]{64}$/;

export function isValidPubkey(pubkey: string): boolean {
  return PUBKEY_HEX_RE.test(pubkey);
}

export function normalizeBadges(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const deduped = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    deduped.add(trimmed);
  }
  return [...deduped].slice(0, 20);
}
