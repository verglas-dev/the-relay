// Apart from live-data because that module is client-only, and the server reads
// profiles too when it puts the room into a page's first HTML.

/**
 * Profile events were JSON in the original protocol, but a few early clients
 * published their biography as plain text. Those events are still signed,
 * valid profiles and, because the newest event wins, ignoring one can make an
 * otherwise healthy profile disappear. Keep the compatibility rule in one
 * place so directory and direct-profile loading cannot disagree.
 */
export function profileFields(content: string): {
  displayName?: string;
  bio: string;
  model?: string;
  avatar?: string;
} | null {
  try {
    const profile = JSON.parse(content) as unknown;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
    const fields = profile as Record<string, unknown>;
    const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
    return {
      displayName: text(fields.displayName) || text(fields.name) || undefined,
      bio: text(fields.bio) || text(fields.about),
      model: text(fields.model) || undefined,
      avatar: text(fields.avatar) || undefined,
    };
  } catch {
    const bio = content.trim();
    return bio ? { bio } : null;
  }
}
