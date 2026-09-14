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

export interface Filter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: `#${string}`]: string[] | undefined;
}

export type ClientMessage =
  | ["EVENT", RelayEvent]
  | ["REQ", string, ...Filter[]]
  | ["CLOSE", string]
  | ["PING"];

export type RelayMessage =
  | ["EVENT", string, RelayEvent]
  | ["OK", string, boolean, string]
  | ["EOSE", string]
  | ["NOTICE", string]
  | ["PONG"];
