/**
 * What a profile costs on the wire.
 *
 * A kind-0 event carries the whole profile — name, bio, model, and, when
 * somebody uploads a picture from their machine, the picture itself as a data
 * URL. The relay caps `content` at 8192 characters and rejects the event
 * outright above it, which means an avatar does not have a fixed budget: it
 * has whatever the rest of the profile has not already spent.
 *
 * That was the bug this module exists to prevent. The shrinker aimed at a
 * constant 7000 characters on the assumption that "the rest… run to a few
 * hundred", while the editor published *both* spellings of the name and bio —
 * `name`/`displayName` and `about`/`bio` — so a 550-character bio actually
 * costs 1100. A picture that fitted the constant could still push the event
 * past the cap, and the relay would refuse the save with no obvious link back
 * to the length of somebody's bio.
 *
 * So the measurement and the publish are the same function now. If the shape
 * of the content changes, both move together.
 *
 * Pure and isomorphic.
 */

/** Mirrors `MAX_CONTENT_LENGTH` in the relay and the bridge. */
export const MAX_CONTENT_LENGTH = 8192;

/**
 * Headroom held back from the avatar.
 *
 * Nothing should land within a few characters of a hard rejection just
 * because somebody added a word to their bio between choosing the picture and
 * pressing save.
 */
export const SAFETY_MARGIN = 96;

export interface ProfileFields {
  name: string;
  bio: string;
  model: string;
  /** A data URL or an ordinary link. Omitted when empty. */
  avatar?: string;
}

/**
 * Exactly what the editor publishes.
 *
 * Both spellings are deliberate — the SDK writes `displayName`/`bio` and this
 * editor writes `name`/`about`, and dropping either would blank the other
 * side's fields on the next save. It costs the duplication, and the budget
 * below accounts for it rather than pretending it away.
 */
export function buildProfileContent(fields: ProfileFields): string {
  return JSON.stringify({
    name: fields.name,
    about: fields.bio,
    displayName: fields.name,
    bio: fields.bio,
    model: fields.model,
    avatar: fields.avatar?.trim() || undefined,
  });
}

/** What the profile costs with no picture in it. */
export function profileCost(fields: Omit<ProfileFields, "avatar">): number {
  return buildProfileContent({ ...fields, avatar: "" }).length;
}

/**
 * How many characters a picture may occupy, given everything else.
 *
 * Can be zero or negative: a long enough bio leaves no room for a picture at
 * all, and the caller is expected to say so in those words rather than let the
 * shrinker fail with something about compression.
 */
export function avatarBudget(fields: Omit<ProfileFields, "avatar">): number {
  // The empty `avatar: ""` in the baseline already pays for the key, so what
  // is left is the value's own length.
  return MAX_CONTENT_LENGTH - SAFETY_MARGIN - profileCost(fields);
}

/** Would this profile be accepted? */
export function profileFits(fields: ProfileFields): boolean {
  return buildProfileContent(fields).length <= MAX_CONTENT_LENGTH;
}

/**
 * Why a profile is too big, in words that name the part the writer controls.
 *
 * "The relay rejected your profile" is true and useless. A person who has just
 * added a picture needs to know that their bio is what is squeezing it, and
 * roughly by how much.
 */
export function profileTooBig(fields: ProfileFields): string | null {
  const total = buildProfileContent(fields).length;
  if (total <= MAX_CONTENT_LENGTH) return null;

  const over = total - MAX_CONTENT_LENGTH;
  if (!fields.avatar?.trim()) {
    return `Your profile is ${over} characters too long. Shorten the bio.`;
  }
  return (
    `Your profile is ${over} characters too long with that picture in it. ` +
    `Shorten your bio by about ${Math.ceil(over / 2)} characters — it is stored twice, ` +
    `so every character you cut saves two — or choose a simpler picture.`
  );
}
