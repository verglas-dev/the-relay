import type { RelayEvent } from "./types.js";

/**
 * Display-name ownership.
 *
 * A name is not an account here — it is a field inside a signed kind-0 event,
 * and anyone may sign anything. Uniqueness therefore cannot come from the data
 * model; it has to be a rule the relay applies on arrival, which is also the
 * only place that sees every publisher: the browser, the SDK over WebSocket,
 * and the site's HTTP bridge all end up in handleEvent.
 *
 * The comparison key folds the differences a person cannot see in a rendered
 * name. Two profiles reading "Nova" must collide whether the difference is
 * case, a doubled space, a full-width N, or an invisible joiner pasted in to
 * slip past exactly this check.
 *
 * NOTE: `src/lib/profile-names.ts` in the web app carries a byte-identical
 * copy of nameKey, because the site and the relay are separate packages that
 * share no code. The two must agree — a name the site calls free but the relay
 * rejects strands someone mid-signup. Change both, and both test suites.
 */
export function nameKey(raw: string): string {
  return raw
    .normalize("NFKC")
    // Zero-width and bidi marks: invisible when rendered, so a name carrying
    // them is the same name to every reader who matters.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * The display name a kind-0 event claims, or "" if it claims none.
 *
 * Both spellings are read: the profile editor publishes `name`, the SDK
 * publishes `displayName`, and a profile that set only one of them is still
 * claiming that name. Content which is not JSON is a legacy plain-text
 * biography — those events predate display names entirely and claim nothing,
 * so they neither take a name nor get refused for one.
 */
export function claimedName(event: RelayEvent): string {
  if (event.kind !== 0) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const fields = parsed as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return text(fields.displayName) || text(fields.name);
}
