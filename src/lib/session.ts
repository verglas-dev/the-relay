import { randomUUID } from "node:crypto";
import type { Line, SessionTransport, Speaker } from "@/lib/session-transport";

/**
 * A conversation, while it is happening.
 *
 * Verglas owns this: who is in the room, when it started, who may speak, when
 * it ends, and where each line goes. The transport underneath only moves
 * bytes, and could be swapped for a page or a bridge without a line of this
 * file changing.
 *
 * **Nothing here touches disk, and that is the whole promise.** There is no
 * store module, no JSON file, no write chain — the other half of this feature
 * has all three and this deliberately has none. The lines exist in one
 * process's memory for as long as two people are talking, and when the session
 * ends they are dropped. "No transcripts, ever" is kept by having nowhere to
 * write one, which is the only version of that promise worth making.
 *
 * A consequence worth stating plainly: this holds in one process. Run two
 * instances behind a load balancer and a session started on one is invisible
 * to the other. The deployment is a single container (`docs/DEPLOYMENT.md`),
 * so that is true today; it is the first thing to fix if that ever changes,
 * and the fix is a shared transport, never a shared transcript.
 */

/** Silence for this long, once somebody is actually in, and the room is empty. */
export const IDLE_MINUTES = 20;

/**
 * How long a room waits for a visitor who never turns up.
 *
 * A session is created the moment the keeper opens the door, before the
 * visitor has walked in — and sometimes they never do: the notification was
 * tapped by accident, the agent's page was closed, the ring was stale. Holding
 * the room for the full idle timeout in that case locks the keeper out of
 * their own establishment for twenty minutes over a visit that never happened.
 * Short, because nothing is lost by being wrong: they can ring again.
 */
export const UNVISITED_MINUTES = 3;
/** Nothing runs longer than this, however chatty. */
export const MAX_MINUTES = 180;
/**
 * How many lines are held for an agent that has not collected them yet.
 *
 * A buffer, not a history. It exists so a poll every few seconds cannot miss
 * anything, and it is small on purpose.
 */
export const BUFFER_LINES = 60;

export interface Session {
  /** The ring the door was opened on. The agent already holds it. */
  id: string;
  establishment: string;
  visitorPubkey: string;
  visitorLabel: string;
  startedAt: number;
  lastAt: number;
  /** Where the keeper should tap to find the thread. */
  note: string | null;
  transport: SessionTransport;
  /**
   * Whether the visitor ever actually turned up — polled, or said something.
   *
   * Until they do, this room is only a door somebody opened, and it steps
   * aside quickly for the next ring.
   */
  arrived: boolean;
  /** Held for collection, then dropped. Never written down. */
  buffer: Line[];
  /** Monotonic, so a poller can ask for "anything after this". */
  cursor: number;
  ending: boolean;
}

/**
 * The live sessions.
 *
 * Hung off `globalThis` because Next reloads modules in development and a
 * plain module-level `Map` would drop every conversation on a hot reload.
 */
const registry: Map<string, Session> = ((
  globalThis as unknown as { __verglasSessions?: Map<string, Session> }
).__verglasSessions ??= new Map());

export function getSession(id: string): Session | null {
  const session = registry.get(id);
  if (!session) return null;
  if (expired(session)) {
    void endSession(id, "nobody was there");
    return null;
  }
  return session;
}

function expired(session: Session, now = Date.now()): boolean {
  if (now - session.startedAt > MAX_MINUTES * 60_000) return true;
  // Nobody ever came in: let go of the room quickly.
  if (!session.arrived) return now - session.startedAt > UNVISITED_MINUTES * 60_000;
  return now - session.lastAt > IDLE_MINUTES * 60_000;
}

/** Is this establishment already talking to somebody? */
export function sessionAt(slug: string): Session | null {
  for (const session of registry.values()) {
    if (session.establishment === slug && !expired(session)) return session;
  }
  return null;
}

function append(session: Session, from: Speaker, text: string): Line {
  const line: Line = { id: randomUUID(), from, text, at: Date.now() };
  session.buffer.push(line);
  // A rolling window. Anything the agent did not collect in sixty lines is
  // gone, which is the intended behaviour rather than a limitation.
  if (session.buffer.length > BUFFER_LINES) session.buffer.shift();
  session.cursor += 1;
  session.lastAt = line.at;
  return line;
}

/**
 * Open a room.
 *
 * One at a time per establishment: a keeper has one pair of ears, and a second
 * agent let in while the first is mid-sentence would be talking into the same
 * thread as somebody else.
 */
export async function startSession(params: {
  id: string;
  establishment: string;
  visitorPubkey: string;
  visitorLabel: string;
  /** When the bell was rung. Decides who wins if the room is occupied. */
  rungAt: number;
  transport: SessionTransport;
}): Promise<{ ok: true; session: Session } | { ok: false; error: string }> {
  const existing = registry.get(params.id);
  if (existing && !expired(existing)) return { ok: true, session: existing };

  /**
   * A room admits one visitor at a time — a keeper has one pair of ears.
   *
   * Who wins when it is occupied depends on *when the newcomer rang*, and that
   * subtlety is not academic. Doorbell notifications are cached so a sleeping
   * phone still finds them, which means a keeper's lock screen accumulates
   * every unanswered ring and each one stays tappable. Letting any of them
   * take the room turns an old notification tapped by accident into somebody
   * being thrown out of a conversation mid-sentence — which is exactly what
   * happened: a visitor got in and was evicted seconds later by a ring from
   * ten minutes earlier.
   *
   * So only a ring made *after* the current session began may take over. That
   * is a keeper deliberately admitting somebody new, and it wins. A ring from
   * before it is stale, and the room says so instead.
   */
  const busy = sessionAt(params.establishment);
  if (busy && busy.id !== params.id) {
    if (params.rungAt < busy.startedAt) {
      return {
        ok: false,
        error: "Somebody else is in there, and that ring is older than their visit.",
      };
    }
    await endSession(busy.id, "the keeper let somebody else in");
  }

  const now = Date.now();
  const session: Session = {
    id: params.id,
    establishment: params.establishment,
    visitorPubkey: params.visitorPubkey,
    visitorLabel: params.visitorLabel,
    startedAt: now,
    lastAt: now,
    note: null,
    transport: params.transport,
    arrived: false,
    buffer: [],
    cursor: 0,
    ending: false,
  };

  const opened = await params.transport.open({
    id: session.id,
    establishment: params.establishment,
    visitor: params.visitorLabel,
  });
  if (!opened.ok) return { ok: false, error: opened.error };

  session.note = opened.note ?? null;
  registry.set(session.id, session);
  return { ok: true, session };
}

/**
 * The visitor says something.
 *
 * Appended for their own client to echo back, then handed to the transport.
 * A line that could not be carried is reported rather than silently kept —
 * an agent talking to nobody should be told.
 */
export async function saySomething(
  id: string,
  text: string,
): Promise<{ ok: true; line: Line } | { ok: false; error: string }> {
  const session = getSession(id);
  if (!session) return { ok: false, error: "That session is over." };

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Nothing to say." };

  session.arrived = true;
  const line = append(session, "agent", trimmed);
  const sent = await session.transport.send(line);
  if (!sent.ok) {
    append(session, "town", `That did not reach them — ${sent.error ?? "the connection failed"}.`);
  }
  return { ok: true, line };
}

/**
 * The keeper said something, from their phone.
 *
 * Called by the transport when a reply arrives, never by a request — which is
 * why it takes no credentials: whoever can publish to the session's channel
 * has already proved they are the keeper by holding it.
 */
export function hearFromKeeper(id: string, text: string): void {
  const session = registry.get(id);
  if (!session || session.ending) return;
  append(session, "keeper", text.trim());
}

/** A note from the town itself — arrivals, departures, trouble. */
export function townSays(id: string, text: string): void {
  const session = registry.get(id);
  if (!session) return;
  append(session, "town", text);
}

/** Everything said since a cursor. The agent's side of the conversation. */
export function linesSince(
  id: string,
  after: number,
): { lines: Line[]; cursor: number; live: boolean } | null {
  const session = getSession(id);
  if (!session) return null;

  // Reading is arriving. A visitor whose client is polling is in the room,
  // whether or not they have said anything yet — somebody sitting quietly is
  // still somebody sitting there.
  if (!session.arrived) {
    session.arrived = true;
    session.lastAt = Date.now();
  }

  // The cursor counts every line ever appended; the buffer holds the last
  // few. The difference is how far back a caller may reach.
  const firstHeld = session.cursor - session.buffer.length;
  const from = Math.max(0, after - firstHeld);
  return {
    lines: session.buffer.slice(from),
    cursor: session.cursor,
    live: !session.ending,
  };
}

/**
 * Close the room.
 *
 * The buffer is emptied here rather than left for the garbage collector to
 * get to eventually. It costs one line of code and it means the words are
 * gone at a moment somebody can point at.
 */
export async function endSession(id: string, reason: string): Promise<void> {
  const session = registry.get(id);
  if (!session || session.ending) return;
  session.ending = true;
  registry.delete(id);

  try {
    await session.transport.close(reason);
  } finally {
    session.buffer.length = 0;
  }
}

/** Close anything that has gone quiet. Called opportunistically, not on a timer. */
export async function sweepSessions(): Promise<void> {
  for (const [id, session] of Array.from(registry.entries())) {
    if (expired(session)) await endSession(id, "nobody was there");
  }
}
