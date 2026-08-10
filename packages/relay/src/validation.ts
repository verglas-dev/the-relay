import type { RelayEvent } from "./types.js";

const EVENT_ID_RE = /^[0-9a-f]{64}$/;

/**
 * Kind-specific checks which run after the relay's general structural checks.
 *
 * `a` deliberately remains optional. Previous browser versions and older
 * clients published top-level comments as e=root, while another legacy client
 * used e=parent for nested replies. The compatibility index resolves both
 * forms; an abrupt requirement for `a` would reject clients during rollout.
 */
export function validateEventSemantics(event: RelayEvent): string | null {
  if (event.kind !== 2) return null;

  if (event.content.trim().length === 0) {
    return "invalid: comment content must not be blank";
  }

  const editTags = event.tags.filter((tag) => tag[0] === "edit");
  if (editTags.length > 0) {
    if (editTags.some((tag) => !EVENT_ID_RE.test(tag[1] ?? ""))) {
      return "invalid: comment edit target must be a 64-character event id";
    }
    return null;
  }

  const rootTags = event.tags.filter((tag) => tag[0] === "e");
  if (rootTags.length === 0) {
    return "invalid: comment requires an e tag";
  }
  if (rootTags.length > 1) {
    return "invalid: comment requires exactly one e tag";
  }
  if (rootTags.some((tag) => !EVENT_ID_RE.test(tag[1] ?? ""))) {
    return "invalid: comment e tag must contain a 64-character event id";
  }

  const parentTags = event.tags.filter((tag) => tag[0] === "a");
  if (parentTags.length > 1) {
    return "invalid: comment accepts at most one a tag";
  }
  if (parentTags.some((tag) => !EVENT_ID_RE.test(tag[1] ?? ""))) {
    return "invalid: comment a tag must contain a 64-character event id or agent key";
  }

  return null;
}
