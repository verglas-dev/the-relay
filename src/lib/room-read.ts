import { listAdminComments } from "./admin-comment-store";
import { listAdminPosts } from "./admin-post-store";
import { listAdminProfiles } from "./admin-store";
import { bridgeDisabled, queryRelay } from "./relay-bridge";
import { buildRoom, type Room } from "./room-snapshot";
import { listNewPosts, type NewPost } from "./whats-new";

export interface RoomRead {
  room: Room;
  newPosts: NewPost[];
  /** Older posts exist that this copy did not read. */
  full: boolean;
  oldest: number;
  fetchedAt: number;
}

export interface RoomReader {
  /** Waits as long as a read takes, up to READ_TIMEOUT_MS. */
  current(): Promise<RoomRead | null>;
  /** Gives up sooner, because a person is waiting for this page to appear. */
  forPage(waitMs?: number): Promise<RoomRead | null>;
}

// The most the relay allows in one request. Enough for this room many times over,
// and what stops a flood of posts from taking this small server's memory with it.
// Past it the first HTML is missing the oldest events, and the browser's fuller
// read corrects whatever that costs.
const EVENTS_TO_READ = 1000;
const VOTES_TO_READ = 500;

// Every caller shares one read of the relay, so pages and agents cost it the same
// whether there are two of them or two hundred: at most four short sockets every
// 30 seconds, which is well inside the relay's 60 requests a minute for this server.
const TTL_MS = 30_000;
const RETRY_AFTER_FAILURE_MS = 5_000;

// Every waiting request shares one read, so a read that never finishes would
// hold them all open, and every request after them. queryRelay gives up on its
// own; this covers anything else that might not.
const READ_TIMEOUT_MS = 25_000;

// A brief relay outage should not make the room vanish, but moderation has to
// keep applying, so an old copy is only trusted for so long.
const STALE_LIMIT_MS = 5 * 60_000;

// Past this a page goes out with its loading state, as every page here used to,
// and the browser fills it in. The read carries on for whoever comes next.
const PAGE_WAIT_MS = 1_500;

async function readRoomFromRelay(): Promise<RoomRead | null> {
  const fetchedAt = Date.now();

  // Separate requests because the relay applies one limit across all the filters
  // in a request, so asking for votes alongside posts would cut both short.
  const [posts, comments, votes, people] = await Promise.all([
    queryRelay([{ kinds: [1], limit: EVENTS_TO_READ }]),
    queryRelay([{ kinds: [2], limit: EVENTS_TO_READ }]),
    queryRelay([{ kinds: [3], limit: VOTES_TO_READ }]),
    queryRelay([{ kinds: [0, 4, 5], limit: EVENTS_TO_READ }]),
  ]);
  if (!posts.complete || !comments.complete || !votes.complete || !people.complete) return null;

  // Moderation failing is a reason to answer with nothing. A list that cannot
  // tell what has been taken down should not hand it to anyone, which is also why
  // these are strict: a store that cannot be parsed must not read as empty here.
  const [adminPosts, adminProfiles, adminComments] = await Promise.all([
    listAdminPosts({ includeDeleted: true, strict: true }),
    listAdminProfiles({ includeDeleted: true, strict: true }),
    listAdminComments({ includeDeleted: true, strict: true }),
  ]);

  const profiles = people.events.filter((event) => event.kind === 0);
  return {
    room: buildRoom(
      {
        profiles,
        posts: posts.events,
        comments: comments.events,
        votes: votes.events,
        follows: people.events.filter((event) => event.kind !== 0),
        adminProfiles,
        adminPosts,
        adminComments,
      },
      Math.floor(fetchedAt / 1000),
    ),
    newPosts: listNewPosts({ posts: posts.events, profiles, adminPosts, adminProfiles }),
    full: posts.events.length >= EVENTS_TO_READ,
    oldest: posts.events.reduce((oldest, event) => Math.min(oldest, event.created_at), Infinity),
    fetchedAt,
  };
}

export function createRoomReader(
  load: () => Promise<RoomRead | null>,
  now: () => number = Date.now,
): RoomReader {
  let copy: RoomRead | null = null;
  let loading: Promise<RoomRead | null> | null = null;
  let lastFailure = -Infinity;

  const usable = () => (copy && now() - copy.fetchedAt < STALE_LIMIT_MS ? copy : null);

  async function loadInTime(): Promise<RoomRead | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS);
    });
    try {
      return await Promise.race([load(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function current(): Promise<RoomRead | null> {
    if (copy && now() - copy.fetchedAt < TTL_MS) return copy;

    if (!loading && now() - lastFailure >= RETRY_AFTER_FAILURE_MS) {
      loading = loadInTime()
        .catch(() => null)
        .then((next) => {
          if (next) copy = next;
          else lastFailure = now();
          loading = null;
          return next;
        });
    }

    const fresh = loading ? await loading : null;
    return fresh ?? usable();
  }

  async function forPage(waitMs = PAGE_WAIT_MS): Promise<RoomRead | null> {
    let timer: NodeJS.Timeout | undefined;
    const gaveUp = new Promise<RoomRead | null>((resolve) => {
      timer = setTimeout(() => resolve(usable()), waitMs);
    });
    try {
      return await Promise.race([current(), gaveUp]);
    } finally {
      clearTimeout(timer);
    }
  }

  return { current, forPage };
}

// On globalThis because Next can load a route handler and each page with their own
// copy of a module, and every copy would otherwise hold its own read of the relay.
const shared = globalThis as unknown as { __relayRoomReader?: RoomReader };

function reader(): RoomReader {
  shared.__relayRoomReader ??= createRoomReader(readRoomFromRelay);
  return shared.__relayRoomReader;
}

export function currentRoom(): Promise<RoomRead | null> {
  return reader().current();
}

/** The room for a page's first HTML, or null to ship the page without it. */
export async function readRoomForPage(): Promise<Room | null> {
  if (bridgeDisabled()) return null;
  return (await reader().forPage())?.room ?? null;
}
