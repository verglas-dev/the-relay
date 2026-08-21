/**
 * What the town remembers about a doorbell.
 *
 * Almost nothing, and that is the design rather than an omission. The mockup
 * that started this says it plainly — *no conversation logs, no transcripts,
 * ever; only minimal event data: who rang, when, whether the door opened* —
 * and the cheapest way to keep that promise is to have nowhere to write the
 * rest down.
 *
 * So a ring holds four facts and one secret. There is no message field, and
 * when the door opens, nothing that happens on the other side of it comes back
 * here.
 */

/** A ring waits this long. Past it, the moment has passed. */
export const RING_TTL_MINUTES = 30;

export type RingState = "waiting" | "opened" | "declined" | "expired";

export interface Ring {
  id: string;
  slug: string;
  /** Who rang. Their key, and their address if they have one in town. */
  pubkey: string;
  handle: string | null;
  rungAt: string;
  state: Exclude<RingState, "expired">;
  answeredAt: string | null;
  /**
   * Authorises the two buttons on the keeper's notification.
   *
   * The buttons are pressed by the ntfy app on a phone, which carries no
   * session — so the authority has to travel with the notification. One
   * secret, one ring, spent the moment the door is answered.
   */
  answerKey: string;
  /** Whether the phone actually got it. A ring nobody heard still happened. */
  delivered: boolean;
}

/** What the ringer is allowed to see: the answer, and nothing about the keeper. */
export interface PublicRing {
  id: string;
  slug: string;
  state: RingState;
  rungAt: string;
  answeredAt: string | null;
}

export function ringExpired(ring: Ring, now = Date.now()): boolean {
  return (
    ring.state === "waiting" &&
    Date.parse(ring.rungAt) + RING_TTL_MINUTES * 60_000 <= now
  );
}

/**
 * Where a ring stands.
 *
 * Expiry is derived rather than swept. A background job that marks rings stale
 * is a background job that can be down, and a ring that reads "waiting" three
 * days later would have the keeper answering a door nobody is standing at.
 */
export function ringState(ring: Ring, now = Date.now()): RingState {
  return ringExpired(ring, now) ? "expired" : ring.state;
}

export function publicRing(ring: Ring, now = Date.now()): PublicRing {
  return {
    id: ring.id,
    slug: ring.slug,
    state: ringState(ring, now),
    rungAt: ring.rungAt,
    answeredAt: ring.answeredAt,
  };
}

/** Still worth answering? */
export function ringAnswerable(ring: Ring, now = Date.now()): boolean {
  return ringState(ring, now) === "waiting";
}
