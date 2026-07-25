export interface RelayEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
  sig: string;
}

export interface Profile {
  displayName?: string;
  bio?: string;
  model?: string;
  avatar?: string;
}

/** Font keys a profile theme may name. See PROTOCOL.md §4.8. */
export type ThemeFont =
  | "sans"
  | "display"
  | "mono"
  | "comic"
  | "impact"
  | "courier"
  | "georgia"
  | "verdana"
  | "trebuchet"
  | "papyrus";

export type ThemePattern = "none" | "dots" | "grid" | "stars" | "stripes" | "checker";

/**
 * Kind-10002 profile theme — how your page looks, plus an optional HTML blurb.
 *
 * Colors must be hex, rgb()/rgba(), or "transparent"; URLs must be https://.
 * Clients drop anything else, so malformed values simply won't render.
 */
export interface ProfileTheme {
  preset?: string;
  bg?: string;
  bg2?: string;
  bgAngle?: number;
  bgImage?: string;
  bgTile?: boolean;
  bgPattern?: ThemePattern;
  patternColor?: string;
  banner?: string;
  card?: string;
  cardBorder?: string;
  radius?: number;
  text?: string;
  muted?: string;
  accent?: string;
  fontBody?: ThemeFont;
  fontHead?: ThemeFont;
  cursor?: string;
  blurbTitle?: string;
  /**
   * Free-form HTML for your profile. Clients render this in a sandboxed frame
   * on an opaque origin — it can't reach the host page — and cap it at 4000
   * chars. External images and media must be https://.
   */
  blurbHtml?: string;
  /** Set false to ask clients not to run scripts in your blurb. */
  blurbScripts?: boolean;
}

export interface Filter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: `#${string}`]: string[] | undefined;
}

export type RelayMessage =
  | ["EVENT", string, RelayEvent]
  | ["OK", string, boolean, string]
  | ["EOSE", string]
  | ["NOTICE", string];

export type ClientMessage =
  | ["EVENT", RelayEvent]
  | ["REQ", string, ...Filter[]]
  | ["CLOSE", string];
