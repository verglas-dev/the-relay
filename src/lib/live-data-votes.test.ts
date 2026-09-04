import assert from "node:assert/strict";
import test from "node:test";
import type { RelayEvent } from "./types";
import { getRelayClient } from "./relay-client";
import {
  getCommentsForPost,
  getMyVote,
  getNotificationsForAgent,
  getPost,
  initLiveData,
  recordMyVote,
  resetLiveData,
} from "./live-data";

const hex = (seed: string, length: number) => seed.repeat(length).slice(0, length);
const id = (seed: string) => hex(seed, 64);
const pubkey = (seed: string) => hex(seed, 64);

const POST_AUTHOR = pubkey("a");
const COMMENT_AUTHOR = pubkey("b");
const COMMENT_UPVOTER = pubkey("c");
const COMMENT_DOWNVOTER = pubkey("d");
const POST_UPVOTER = pubkey("e");
const STRAY_VOTER = pubkey("f");

const POST_ID = id("1");
const COMMENT_ID = id("2");
const UNKNOWN_ID = id("9");

let counter = 0;
function event(kind: number, author: string, content: string, tags: string[][], eventId = id(String(++counter))): RelayEvent {
  return { id: eventId, pubkey: author, created_at: 1_700_000_000 + counter, kind, tags, content, sig: hex("0", 128) };
}

const stored: RelayEvent[] = [
  event(1, POST_AUTHOR, "A post worth discussing", [["m", "general"]], POST_ID),
  event(2, COMMENT_AUTHOR, "A comment worth voting on", [["e", POST_ID], ["a", POST_ID]], COMMENT_ID),
  event(3, COMMENT_UPVOTER, "+", [["e", COMMENT_ID]]),
  event(3, COMMENT_DOWNVOTER, "-", [["e", COMMENT_ID]]),
  event(3, POST_UPVOTER, "+", [["e", POST_ID]]),
  // Neither a post nor a comment: must be ignored without tripping anything.
  event(3, STRAY_VOTER, "+", [["e", UNKNOWN_ID]]),
];

/**
 * A relay that answers each REQ from `stored`, filtered by kind. The live
 * invalidation subscription (limit: 1) is left unanswered so its EOSE does
 * not schedule a second initialization behind the test's back.
 */
class FakeRelaySocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeRelaySocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    queueMicrotask(() => {
      this.readyState = FakeRelaySocket.OPEN;
      this.onopen?.();
    });
  }

  send(raw: string) {
    const [command, subId, ...filters] = JSON.parse(raw) as [string, string, ...Array<{ kinds?: number[]; limit?: number }>];
    if (command !== "REQ") return;
    const filter = filters[0] ?? {};
    if (filter.limit === 1) return;
    queueMicrotask(() => {
      for (const e of stored) {
        if (!filter.kinds || filter.kinds.includes(e.kind)) {
          this.onmessage?.({ data: JSON.stringify(["EVENT", subId, e]) });
        }
      }
      this.onmessage?.({ data: JSON.stringify(["EOSE", subId]) });
    });
  }

  close() {
    if (this.readyState === FakeRelaySocket.CLOSED) return;
    this.readyState = FakeRelaySocket.CLOSED;
    this.onclose?.();
  }
}

test("votes on comments are tallied, notified, and patched like votes on posts", async (t) => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  globalThis.WebSocket = FakeRelaySocket as unknown as typeof WebSocket;
  // Admin overlays are optional; an unreachable admin API means "no overrides".
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  t.after(() => {
    getRelayClient().disconnect();
    resetLiveData();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
  });

  resetLiveData();
  await initLiveData();

  const post = getPost(POST_ID);
  assert.ok(post, "the post is visible");
  assert.equal(post.upvotes, 1);
  assert.equal(post.downvotes, 0);

  const [comment] = getCommentsForPost(POST_ID);
  assert.ok(comment, "the comment is visible");
  assert.equal(comment.id, COMMENT_ID);
  assert.equal(comment.upvotes, 1);
  assert.equal(comment.downvotes, 1);
  assert.equal(comment.agent.stats.upvotes, 1);

  // Each voter's own choice survives a reload.
  assert.equal(getMyVote(COMMENT_UPVOTER, COMMENT_ID), "+");
  assert.equal(getMyVote(COMMENT_DOWNVOTER, COMMENT_ID), "-");
  assert.equal(getMyVote(POST_UPVOTER, COMMENT_ID), null);

  // An upvote on a comment notifies the comment's author, not the post's.
  const commentAuthorNotifications = getNotificationsForAgent(COMMENT_AUTHOR);
  assert.deepEqual(
    commentAuthorNotifications.map((n) => [n.type, n.actor.pubkey, n.postId, n.commentId]),
    [["upvote", COMMENT_UPVOTER, POST_ID, COMMENT_ID]]
  );
  // Newest first: the post upvote was published after the comment.
  const postAuthorNotifications = getNotificationsForAgent(POST_AUTHOR);
  assert.deepEqual(
    postAuthorNotifications.map((n) => [n.type, n.actor.pubkey, n.postId, n.commentId]),
    [
      ["upvote", POST_UPVOTER, POST_ID, undefined],
      ["comment", COMMENT_AUTHOR, POST_ID, COMMENT_ID],
    ]
  );
  // The stray vote reached nobody.
  assert.equal(getNotificationsForAgent(STRAY_VOTER).length, 0);

  // A just-cast vote patches the cached comment in place, both directions.
  recordMyVote(COMMENT_DOWNVOTER, COMMENT_ID, "+");
  assert.equal(comment.upvotes, 2);
  assert.equal(comment.downvotes, 0);
  assert.equal(comment.agent.stats.upvotes, 2);

  recordMyVote(COMMENT_DOWNVOTER, COMMENT_ID, null);
  assert.equal(comment.upvotes, 1);
  assert.equal(comment.downvotes, 0);
  assert.equal(getMyVote(COMMENT_DOWNVOTER, COMMENT_ID), null);

  recordMyVote(COMMENT_UPVOTER, COMMENT_ID, "-");
  assert.equal(comment.upvotes, 0);
  assert.equal(comment.downvotes, 1);
});
