import assert from "node:assert/strict";
import test from "node:test";
import type { AdminCommentRecord } from "./admin-comments";
import type { AdminPostRecord } from "./admin-posts";
import type { AdminProfileRecord } from "./admin-profiles";
import { COMMENT_REFERENCE_REPAIRS } from "./comment-reference-repairs";
import {
  FOLLOW_KIND,
  UNFOLLOW_KIND,
  getAgentComments,
  getAgentPosts,
  getAgents,
  getCommentsForPost,
  getHotPosts,
  getMostUpvotedAgents,
  getNewPosts,
  getPost,
  getRootPostId,
  getSubmoltPosts,
  getTopPosters,
  getTopRepliers,
  initLiveData,
  resetLiveData,
} from "./live-data";
import type { BridgeEvent } from "./relay-bridge";
import { getRelayClient } from "./relay-client";
import {
  agentComments,
  agentPosts,
  buildRoom,
  findPost,
  hotPosts,
  mostUpvoted,
  newestPosts,
  regulars,
  tableCounts,
  tablePosts,
  topPosters,
  topRepliers,
  type RoomSources,
} from "./room-snapshot";
import { submolts } from "./submolts";

const key = (seed: string) => seed.repeat(64).slice(0, 64);
const ALICE = key("a");
const BOB = key("b");
const CAROL = key("c");
const DANA = key("d"); // hidden by an admin
const ERIN = key("e"); // pinned by an admin
const FERN = key("f"); // never published a profile

let clock = 1_700_000_000;
let nextId = 1;
function event(kind: number, pubkey: string, content: string, tags: string[][] = [], id?: string): BridgeEvent {
  clock += 60;
  return {
    id: id ?? (nextId++).toString(16).padStart(64, "0"),
    pubkey,
    created_at: clock,
    kind,
    tags,
    content,
    sig: "0".repeat(128),
  };
}

const profile = (pubkey: string, fields: unknown) => event(0, pubkey, JSON.stringify(fields));

const [repairedComment, repair] = [...COMMENT_REFERENCE_REPAIRS.entries()][0];

// Each post, comment, vote, and follow here is one of the shapes the site has to
// get right, because each has gone wrong somewhere before.
const plainPost = event(1, ALICE, "Hello the room\nA second line", [["m", "general"], ["t", "hello"]]);
const aliasedPost = event(1, BOB, "At the kitchen table", [["m", "kitchen"]]);
const untabledPost = event(1, CAROL, "With no table at all");
const builderPost = event(1, ALICE, "A long-winded build log", [["m", "builders"]]);
const movedPost = event(1, BOB, "Moderation moves me", [["m", "ai"], ["t", "before"]]);
const removedPost = event(1, ALICE, "Taken down", [["m", "general"]]);
const hiddenAuthorPost = event(1, DANA, "From someone removed", [["m", "general"]]);
const editedPost = event(1, CAROL, "Before the edit", [["m", "introductions"]]);
const forgedEditPost = event(1, ERIN, "Nobody else can edit me", [["m", "introductions"]]);
const moderatedAfterEdit = event(1, FERN, "Edited, then moderated", [["m", "nowhere-on-the-list"]]);
const repairedRoot = event(1, ALICE, "The post a repair points at", [["m", "ai"]], repair.postId);

const topComment = event(2, BOB, "A top-level comment", [["e", plainPost.id], ["a", plainPost.id, "reply"]]);
const reply = event(2, CAROL, "A reply", [["e", plainPost.id], ["a", topComment.id, "reply"]]);
const legacyParent = event(2, ALICE, "e points at the parent, no a", [["e", reply.id]]);
const legacyAuthor = event(2, FERN, "a holds the author's key", [["e", plainPost.id], ["a", CAROL]]);
const blankComment = event(2, BOB, "   ", [["e", plainPost.id], ["a", topComment.id, "reply"]]);
const underBlank = event(2, ERIN, "Replied to a blank", [["e", plainPost.id], ["a", blankComment.id, "reply"]]);
const editedComment = event(2, ALICE, "Before", [["e", aliasedPost.id], ["a", aliasedPost.id, "reply"]]);
const forgedComment = event(2, BOB, "Only mine to edit", [["e", aliasedPost.id], ["a", aliasedPost.id, "reply"]]);
const moderatedComment = event(2, CAROL, "Needs correcting", [["e", aliasedPost.id], ["a", aliasedPost.id, "reply"]]);
const repairedByModeration = event(2, BOB, " ", [["e", aliasedPost.id], ["a", aliasedPost.id, "reply"]]);
const removedComment = event(2, ERIN, "Taken down", [["e", aliasedPost.id], ["a", aliasedPost.id, "reply"]]);
const onRemovedPost = event(2, BOB, "Under a removed post", [["e", removedPost.id], ["a", removedPost.id, "reply"]]);
const byHidden = event(2, DANA, "From someone removed", [["e", plainPost.id], ["a", plainPost.id, "reply"]]);
const unresolved = event(2, FERN, "Refers to nothing", [["e", key("9")]]);
const repaired = event(2, CAROL, "Tagged wrongly, repaired by hand", [["e", key("8")]], repairedComment);

const allEvents: BridgeEvent[] = [
  profile(ALICE, { displayName: "Old Alice", bio: "Old" }),
  profile(ALICE, { displayName: "Alice", bio: "Newer **bio**", model: "m1", avatar: "https://example.com/a.png" }),
  event(0, BOB, "A bio from an early client, in plain text"),
  profile(CAROL, { name: "Carol by name", about: "An about" }),
  profile(DANA, { displayName: "Dana" }),
  profile(ERIN, { displayName: "Erin as published", bio: "Her words" }),

  plainPost, aliasedPost, untabledPost, builderPost, movedPost, removedPost, hiddenAuthorPost,
  editedPost, forgedEditPost, moderatedAfterEdit, repairedRoot,
  event(1, CAROL, "After the edit", [["edit", editedPost.id]]),
  event(1, BOB, "Forged edit", [["edit", forgedEditPost.id]]),
  event(1, FERN, "The author's edit", [["edit", moderatedAfterEdit.id]]),

  topComment, reply, legacyParent, legacyAuthor, blankComment, underBlank, editedComment, forgedComment,
  moderatedComment, repairedByModeration, removedComment, onRemovedPost, byHidden, unresolved, repaired,
  event(2, ALICE, "After", [["edit", editedComment.id]]),
  event(2, ALICE, "Forged", [["edit", forgedComment.id]]),

  event(3, BOB, "+", [["e", plainPost.id]]),
  event(3, CAROL, "+", [["e", plainPost.id]]),
  event(3, ERIN, "-", [["e", plainPost.id]]),
  event(3, ALICE, "+", [["e", plainPost.id]]), // an author upvoting themselves
  event(3, ALICE, "-", [["e", movedPost.id]]),
  event(3, BOB, "0", [["e", builderPost.id]]), // a cleared vote
  event(3, ALICE, "+", [["e", topComment.id]]),
  event(3, ERIN, "-", [["e", reply.id]]),
  event(3, CAROL, "+", [["e", key("7")]]), // on nothing
  event(3, DANA, "+", [["e", untabledPost.id]]), // from someone removed
  event(3, key("1"), "+", [["e", builderPost.id]]), // no profile, and it files them as a regular
  event(3, key("2"), "+", [["e", removedPost.id]]), // on a removed post, so it does not
  event(3, key("3"), "+", [["e", removedComment.id]]), // on a removed comment, so it does not

  event(FOLLOW_KIND, ALICE, "", [["p", BOB]]),
  event(FOLLOW_KIND, CAROL, "", [["p", BOB]]),
  event(FOLLOW_KIND, CAROL, "", [["p", ALICE]]),
  event(UNFOLLOW_KIND, CAROL, "", [["p", ALICE]]), // the later one stands
  event(FOLLOW_KIND, ALICE, "", [["p", ALICE]]), // nobody follows themselves
  event(FOLLOW_KIND, ALICE, "", [["p", DANA]]), // the removed do not count
  event(FOLLOW_KIND, key("4"), "", [["p", ALICE]]), // no profile, and it files them too
];

const record = { createdAt: "2026-01-01", updatedAt: "2026-01-01" };
const adminProfiles: AdminProfileRecord[] = [
  { ...record, pubkey: DANA, displayName: "", bio: "", model: "", verified: false, badges: [], deleted: true, themeDisabled: true },
  { ...record, pubkey: ERIN, displayName: "Erin as pinned", bio: "", model: "m9", verified: true, badges: ["founder"], deleted: false, themeDisabled: false },
  { ...record, pubkey: key("5"), displayName: "Only an admin knows me", bio: "Pinned bio", model: "", verified: false, badges: [], deleted: false, themeDisabled: false },
];
const adminPosts: AdminPostRecord[] = [
  { ...record, id: removedPost.id, deleted: true },
  { ...record, id: movedPost.id, deleted: false, content: "Corrected", submolt: "builders", tags: ["after"] },
  { ...record, id: moderatedAfterEdit.id, deleted: false, content: "Moderation has the last word" },
];
const adminComments: AdminCommentRecord[] = [
  { ...record, id: moderatedComment.id, deleted: false, content: "Corrected" },
  { ...record, id: repairedByModeration.id, deleted: false, content: "Was blank, now has words" },
  { ...record, id: removedComment.id, deleted: true },
];

// What the relay does: newest first, then one limit across the request.
const newestFirst = (events: BridgeEvent[]) => [...events].sort((a, b) => b.created_at - a.created_at);

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
    // The live subscription: left unanswered so its EOSE does not start a second
    // load behind the test's back.
    if (filter.limit === 1) return;
    queueMicrotask(() => {
      const matching = newestFirst(allEvents).filter((e) => !filter.kinds || filter.kinds.includes(e.kind));
      for (const e of matching.slice(0, filter.limit)) {
        this.onmessage?.({ data: JSON.stringify(["EVENT", subId, e]) });
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

function sourcesFrom(events: BridgeEvent[]): RoomSources {
  const ofKind = (...kinds: number[]) => newestFirst(events).filter((e) => kinds.includes(e.kind));
  return {
    profiles: ofKind(0),
    posts: ofKind(1),
    comments: ofKind(2),
    votes: ofKind(3),
    follows: ofKind(FOLLOW_KIND, UNFOLLOW_KIND),
    adminProfiles,
    adminPosts,
    adminComments,
  };
}

// Through JSON as the data is on its way to a client component, which also drops
// fields that are present but undefined. A hot score moves with the clock, so the
// lists that use one compare by the order it produces.
function same(actual: unknown, expected: unknown, what: string) {
  const plain = (value: unknown) =>
    value === undefined
      ? undefined
      : JSON.parse(JSON.stringify(value, (name, field) => (name === "hotScore" ? undefined : field)));
  assert.deepEqual(plain(actual), plain(expected), what);
}

test("the server and the browser agree about the room", async (t) => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  globalThis.WebSocket = FakeRelaySocket as unknown as typeof WebSocket;
  globalThis.fetch = (async (url: string) => {
    if (url.endsWith("public-profiles")) return Response.json({ profiles: adminProfiles });
    if (url.endsWith("public-posts")) return Response.json({ posts: adminPosts });
    if (url.endsWith("public-comments")) return Response.json({ comments: adminComments });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  t.after(() => {
    getRelayClient().disconnect();
    resetLiveData();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
  });

  resetLiveData();
  await initLiveData();
  const room = buildRoom(sourcesFrom(allEvents), Math.floor(Date.now() / 1000));

  same(newestPosts(room, 100), getNewPosts(100), "newest posts");
  same(hotPosts(room, 100), getHotPosts(100), "hot posts");
  same(regulars(room), getAgents(), "regulars");
  same(topPosters(room, 100), getTopPosters(100), "most poured");
  same(topRepliers(room, 100), getTopRepliers(100), "most stirred");
  same(mostUpvoted(room, 100), getMostUpvotedAgents(100), "most toasted");

  for (const table of [...submolts.map((s) => s.name), "kitchen", "welcome", "nowhere-on-the-list", "unheard-of"]) {
    same(tablePosts(room, table), getSubmoltPosts(table), `table ${table}`);
  }
  for (const entry of submolts) {
    assert.equal(tableCounts(room)[entry.name], getSubmoltPosts(entry.name).length, `count for ${entry.name}`);
  }

  for (const post of allEvents.filter((e) => e.kind === 1)) {
    const found = findPost(room, post.id);
    same(found?.post, getPost(post.id), `post ${post.content}`);
    same(found?.comments ?? [], getPost(post.id) ? getCommentsForPost(post.id) : [], `comments on ${post.content}`);
  }

  for (const comment of allEvents.filter((e) => e.kind === 2)) {
    const rootId = getRootPostId(comment.id);
    same(findPost(room, comment.id)?.post.id, rootId && getPost(rootId)?.id, `root of comment ${comment.content}`);
  }

  for (const agent of [...getAgents(), { pubkey: DANA }]) {
    same(agentPosts(room, agent.pubkey), getAgentPosts(agent.pubkey), `posts by ${agent.pubkey}`);
    same(agentComments(room, agent.pubkey), getAgentComments(agent.pubkey), `comments by ${agent.pubkey}`);
  }

  // The comparisons above prove nothing if the fixture never reached these cases.
  assert.ok(getPost(plainPost.id), "the fixture has visible posts");
  assert.equal(getPost(removedPost.id), undefined, "the fixture has moderated posts");
  assert.equal(getPost(hiddenAuthorPost.id), undefined, "the fixture has hidden authors");
  assert.equal(getPost(movedPost.id)?.content, "Corrected", "the fixture has moderation overrides");
  assert.equal(getPost(editedPost.id)?.edited, true, "the fixture has edits");
  assert.equal(getCommentsForPost(repairedRoot.id).length, 1, "the fixture has a repaired reference");
  assert.ok(getCommentsForPost(plainPost.id).some((c) => c.id === underBlank.id && c.parentId === topComment.id), "the fixture walks past a blank");
  assert.ok(getAgents().some((a) => a.pubkey === key("1")), "the fixture files an upvoter as a regular");
  assert.ok(!getAgents().some((a) => a.pubkey === key("2")), "the fixture skips an upvoter of a removed post");
});

const base = (fields: Partial<RoomSources>): RoomSources => ({
  profiles: [],
  posts: [],
  comments: [],
  votes: [],
  follows: [],
  adminProfiles: [],
  adminPosts: [],
  adminComments: [],
  ...fields,
});

test("what moderation took down never reaches the room", () => {
  const room = buildRoom(sourcesFrom(allEvents), 1_800_000_000);
  const everything = JSON.stringify([room.posts, [...room.commentsByPost.values()], regulars(room)]);
  for (const words of ["Taken down", "From someone removed", "Under a removed post"]) {
    assert.ok(!everything.includes(words), words);
  }
  assert.ok(!room.agents.has(DANA));
  assert.equal(findPost(room, removedPost.id), null);
});

test("text-direction tricks and control characters do not reach the page, and line breaks do", () => {
  const room = buildRoom(
    base({
      profiles: [event(0, ALICE, JSON.stringify({ displayName: "Ali‮ce\r\nFake", bio: "A⁦b\u0007c" }))],
      posts: [event(1, ALICE, "safe‮txet\r\nSecond line\ttabbed\u0000")],
    }),
    1_800_000_000,
  );
  assert.equal(room.posts[0].content, "safe txet\nSecond line\ttabbed ");
  assert.equal(room.agents.get(ALICE)?.displayName, "Ali ce Fake");
  assert.equal(room.agents.get(ALICE)?.bio, "A b c");
});

test("a post is found by a comment's id, as older links ask for it", () => {
  const post = event(1, ALICE, "The root");
  const comment = event(2, BOB, "A comment", [["e", post.id], ["a", post.id, "reply"]]);
  const room = buildRoom(base({ posts: [post], comments: [comment] }), 1_800_000_000);
  assert.equal(findPost(room, comment.id)?.post.id, post.id);
  assert.equal(findPost(room, comment.id)?.comments.length, 1);
  assert.equal(findPost(room, "nothing-like-an-id"), null);
});

test("a table asked for by an old name finds its posts", () => {
  const room = buildRoom(base({ posts: [event(1, ALICE, "Hi", [["m", "welcome"]])] }), 1_800_000_000);
  assert.equal(tablePosts(room, "introductions").length, 1);
  assert.equal(tablePosts(room, "welcome").length, 1);
  assert.equal(tableCounts(room).introductions, 1);
});
