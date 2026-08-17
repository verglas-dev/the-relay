import type { RelayEvent } from "./types.js";

const EVENT_ID_RE = /^[0-9a-f]{64}$/;
// Same shape as an event id — 32 bytes of hex — but named for what it holds.
const PUBKEY_RE = /^[0-9a-f]{64}$/;
const FILTER_KEYS = new Set(["ids", "authors", "kinds", "since", "until", "limit"]);

export interface FilterValidationOptions {
  maxFilters?: number;
  maxLimit?: number;
  maxValues?: number;
}

/**
 * Validate untrusted REQ filters before they reach the SQLite query builder.
 *
 * JSON parsed from the wire is not a `Filter` merely because TypeScript says
 * so. The query builder calls array methods and binds numbers directly; a
 * string where `#m` should be an array used to throw out of the WebSocket
 * message handler and terminate the relay process.
 */
export function validateFilters(
  filters: unknown[],
  options: FilterValidationOptions = {},
): string | null {
  const maxFilters = options.maxFilters ?? 10;
  const maxLimit = options.maxLimit ?? 1000;
  const maxValues = options.maxValues ?? 1000;

  if (filters.length === 0 || filters.length > maxFilters) {
    return `REQ requires 1–${maxFilters} filters`;
  }

  let valueCount = 0;
  for (const [index, candidate] of filters.entries()) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return `REQ filter ${index + 1} must be an object`;
    }
    const filter = candidate as Record<string, unknown>;
    let hasSelector = false;

    for (const [key, value] of Object.entries(filter)) {
      if (!FILTER_KEYS.has(key) && !key.startsWith("#")) {
        return `REQ filter ${index + 1} has unsupported field ${key}`;
      }

      if (key === "limit") {
        if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maxLimit) {
          return `REQ filter ${index + 1} limit must be an integer from 1 to ${maxLimit}`;
        }
        continue;
      }

      if (key === "since" || key === "until") {
        if (!Number.isSafeInteger(value) || (value as number) < 0) {
          return `REQ filter ${index + 1} ${key} must be a non-negative integer`;
        }
        hasSelector = true;
        continue;
      }

      if (key.startsWith("#")) {
        if (key.length === 1 || key.length > 65) {
          return `REQ filter ${index + 1} has an invalid tag field`;
        }
        if (!Array.isArray(value) || value.length === 0) {
          return `REQ filter ${index + 1} ${key} must be a non-empty string array`;
        }
        if (value.some((entry) => typeof entry !== "string" || entry.length > 1024)) {
          return `REQ filter ${index + 1} ${key} values must be strings of at most 1024 characters`;
        }
        valueCount += value.length;
        hasSelector = true;
        continue;
      }

      if (!Array.isArray(value) || value.length === 0) {
        return `REQ filter ${index + 1} ${key} must be a non-empty array`;
      }
      if (key === "kinds") {
        if (value.some((entry) => !Number.isSafeInteger(entry) || entry < 0 || entry > 65535)) {
          return `REQ filter ${index + 1} kinds must contain integers from 0 to 65535`;
        }
      } else if (value.some((entry) => typeof entry !== "string" || !EVENT_ID_RE.test(entry))) {
        return `REQ filter ${index + 1} ${key} must contain 64-character lowercase hex values`;
      }
      valueCount += value.length;
      hasSelector = true;
    }

    if (
      typeof filter.since === "number" &&
      typeof filter.until === "number" &&
      filter.since > filter.until
    ) {
      return `REQ filter ${index + 1} since must not exceed until`;
    }
    if (!hasSelector) {
      return `REQ filter ${index + 1} needs at least one selector`;
    }
  }

  if (valueCount > maxValues) {
    return `REQ contains too many selector values (max ${maxValues})`;
  }
  return null;
}

/**
 * Kind-specific checks which run after the relay's general structural checks.
 *
 * `a` deliberately remains optional. Previous browser versions and older
 * clients published top-level comments as e=root, while another legacy client
 * used e=parent for nested replies. The compatibility index resolves both
 * forms; an abrupt requirement for `a` would reject clients during rollout.
 */
export function validateEventSemantics(event: RelayEvent): string | null {
  // Identity-successor attestation: both keys must be present and well-formed
  // before it is stored, because a malformed one indexes as a silent no-op and
  // the operator would be told the recovery succeeded.
  if (event.kind === 10003) {
    const oldPubkey = event.tags.find((tag) => tag[0] === "old")?.[1] ?? "";
    const newPubkey = event.tags.find((tag) => tag[0] === "p")?.[1] ?? "";
    if (!PUBKEY_RE.test(oldPubkey)) {
      return "invalid: identity successor requires an old tag with a 64-character pubkey";
    }
    if (!PUBKEY_RE.test(newPubkey)) {
      return "invalid: identity successor requires a p tag with a 64-character pubkey";
    }
    if (oldPubkey === newPubkey) {
      return "invalid: identity successor old and p tags must differ";
    }
    return null;
  }

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
