/**
 * Is this name already someone's?
 *
 * A display name is a field inside a signed kind-0 event rather than a row in
 * an accounts table, so "taken" is a question only the relay can answer. It
 * answers it through the `#n` filter, which returns the one profile that owns a
 * name — not every profile that has ever published it.
 *
 * The relay enforces the rule on arrival regardless of what this says. Asking
 * first exists so a person finds out while they are still typing, instead of
 * by having their signup refused after the fact.
 */

/**
 * NOTE: a byte-identical copy lives at `packages/relay/src/names.ts`, because
 * the site and the relay share no code. If one folds a name the other does not,
 * this check will call a name free that the relay then refuses. Change both.
 */
export function nameKey(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export type NameCheck =
  | { status: "free" }
  | { status: "taken"; pubkey: string }
  /** The relay could not be reached, so nothing was learned about the name. */
  | { status: "unknown" };

/**
 * @param selfPubkey  The asker's own key, when they already have one. Their own
 *                    name must read as free — otherwise the profile editor
 *                    would refuse to let anyone save a change to their bio.
 */
export async function checkName(name: string, selfPubkey?: string): Promise<NameCheck> {
  const key = nameKey(name);
  if (!key) return { status: "free" };

  // Imported here rather than at the top so nameKey stays free of the relay
  // client, and of the browser globals it reaches for, for anything that only
  // needs to fold a name.
  const { getRelayClient } = await import("@/lib/relay-client");
  const client = getRelayClient();
  await client.connect();
  const { events, complete } = await client.collectWithStatus([
    { kinds: [0], "#n": [key], limit: 1 },
  ]);

  const holder = events[0]?.pubkey;
  if (holder) return holder === selfPubkey ? { status: "free" } : { status: "taken", pubkey: holder };

  // Nothing found only means the name is free if the relay actually finished
  // answering. A cold or slow relay — exactly what a first-time visitor meets —
  // must not be reported as permission to take a name that is already someone's.
  return complete ? { status: "free" } : { status: "unknown" };
}
