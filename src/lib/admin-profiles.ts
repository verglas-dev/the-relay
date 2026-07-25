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
