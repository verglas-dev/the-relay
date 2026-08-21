/**
 * Carrying a conversation, without depending on what carries it.
 *
 * A session is two people talking through Verglas. ntfy is how the keeper's
 * half reaches their phone today — the topic view is a thread, and the message
 * bar at the bottom of it is how they reply. It is not the only way that could
 * work, and the session must not know which one it is using: if sustained
 * conversations turn out to feel cramped in a notification app, a dedicated
 * page should be a different implementation of this interface and nothing
 * else.
 *
 * So: **Verglas owns identity, lifecycle, permissions and forwarding. The
 * transport moves bytes.** Everything below the interface is bytes.
 */

/** Who a line came from. The session decides; the transport is told. */
export type Speaker = "agent" | "keeper" | "town";

export interface Line {
  id: string;
  from: Speaker;
  text: string;
  at: number;
}

/**
 * One way of reaching the keeper.
 *
 * `open` prepares whatever the channel needs and returns something to say to
 * the keeper about where to look. `send` delivers one line. `close` tears the
 * channel down — for a per-session ntfy topic that means the topic stops being
 * used and nothing more is published to it.
 */
export interface SessionTransport {
  readonly kind: string;
  /** Called once when the session starts. Returns a note for the keeper. */
  open(session: { id: string; establishment: string; visitor: string }): Promise<
    { ok: true; note?: string } | { ok: false; error: string }
  >;
  /** Deliver one line to the keeper. */
  send(line: Line): Promise<{ ok: boolean; error?: string }>;
  /** Stop listening and stop delivering. Must be safe to call twice. */
  close(reason: string): Promise<void>;
}

/**
 * ntfy's ceiling, less room for the part marker.
 *
 * The reserve is not politeness. Over 4,096 bytes ntfy stops treating a
 * message as a message and turns it into an **attachment** — which is stored
 * on the server with its own expiry. A conversation that must leave no
 * transcript cannot be allowed to overflow into one by accident, so the
 * chunker keeps a margin and the wire refuses anything still over the line.
 */
export const CHUNK_BYTES = 4096;
const MARKER_RESERVE = 16;

/**
 * How many pieces one line may become.
 *
 * Six is roughly twenty thousand characters — far more than anybody types at
 * a therapist, and a hard stop on one participant filling the other's phone
 * with a hundred notifications.
 */
export const MAX_PARTS = 6;

const encoder = new TextEncoder();
export const byteLength = (text: string): number => encoder.encode(text).length;

/** Break a run of text into pieces no larger than `budget` bytes. */
function hardSplit(text: string, budget: number): string[] {
  const parts: string[] = [];
  let current = "";
  // By code point, never by byte: splitting mid-character would produce
  // mojibake on the phone and, for an emoji, half a surrogate pair.
  for (const char of Array.from(text)) {
    if (byteLength(current + char) > budget) {
      if (current) parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Break text into the smallest units that still fit.
 *
 * Paragraphs first, then sentences, then words, and only then characters —
 * so a split lands somewhere a reader would have paused anyway, and the ugly
 * option is reached only by a single unbroken run longer than the budget.
 */
function atoms(text: string, budget: number): string[] {
  const out: string[] = [];

  for (const paragraph of text.split(/\n{2,}/)) {
    if (byteLength(paragraph) <= budget) {
      out.push(paragraph);
      continue;
    }
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
      if (byteLength(sentence) <= budget) {
        out.push(sentence);
        continue;
      }
      let run = "";
      for (const word of sentence.split(/\s+/)) {
        const candidate = run ? `${run} ${word}` : word;
        if (byteLength(candidate) <= budget) {
          run = candidate;
        } else {
          if (run) out.push(run);
          run = byteLength(word) <= budget ? word : "";
          if (!run) out.push(...hardSplit(word, budget));
        }
      }
      if (run) out.push(run);
    }
  }

  return out.filter((atom) => atom.trim() !== "");
}

export interface Chunked {
  parts: string[];
  /** True when the line was longer than `MAX_PARTS` allows and was cut. */
  truncated: boolean;
}

/**
 * Split one line into sendable pieces.
 *
 * A line that fits goes out unmarked — the overwhelming majority of them, and
 * a bare `(1/1)` on every sentence would make a conversation look like a
 * machine talking. Only a line that actually had to be broken says so.
 */
export function chunk(text: string, budget = CHUNK_BYTES): Chunked {
  const trimmed = text.replace(/\s+$/, "");
  if (byteLength(trimmed) <= budget) return { parts: [trimmed], truncated: false };

  const room = budget - MARKER_RESERVE;
  const pieces: string[] = [];
  let current = "";

  for (const atom of atoms(trimmed, room)) {
    const candidate = current ? `${current}\n\n${atom}` : atom;
    if (byteLength(candidate) <= room) {
      current = candidate;
    } else {
      if (current) pieces.push(current);
      current = atom;
    }
  }
  if (current) pieces.push(current);

  const truncated = pieces.length > MAX_PARTS;
  const kept = truncated ? pieces.slice(0, MAX_PARTS) : pieces;
  const total = kept.length;

  return {
    parts: kept.map((piece, index) =>
      total > 1 ? `(${index + 1}/${total}) ${piece}` : piece,
    ),
    truncated,
  };
}
