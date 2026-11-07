import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  FIRST_LOOK_POSTS,
  beginVisit,
  freshSince,
  getMarksVersion,
  liveDots,
  markBubbleSeen,
  markLettersRead,
  markThrough,
  newLetters,
  postsFromOthers,
  readMarks,
  seedBubble,
  whatsNewList,
} from "./profile-activity";

const ME = "a".repeat(64);
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const post = (id: string, seconds: number) => ({ id, createdAt: iso(seconds) });

const NOW = 1_800_000_000;
const HOUR = 3600;

beforeEach(() => {
  const data = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as unknown as Storage;
});

test("nothing is new straight after being marked", () => {
  const items = [post("b", NOW - 10), post("a", NOW - HOUR)];
  assert.deepEqual(freshSince(items, markThrough(items, undefined, NOW)), []);
});

test("a later post is new", () => {
  const mark = markThrough([post("a", NOW - HOUR)], undefined, NOW);
  assert.deepEqual(freshSince([post("b", NOW - 10), post("a", NOW - HOUR)], mark).map((p) => p.id), ["b"]);
});

test("a post stamped the same second as the last one seen is still new", () => {
  const mark = markThrough([post("a", NOW - 60)], undefined, NOW);
  assert.deepEqual(freshSince([post("a", NOW - 60), post("b", NOW - 60)], mark).map((p) => p.id), ["b"]);
});

test("a post from a slow clock that arrives late is still new", () => {
  const mark = markThrough([post("a", NOW - 10)], undefined, NOW);
  assert.deepEqual(freshSince([post("a", NOW - 10), post("late", NOW - 120)], mark).map((p) => p.id), ["late"]);
});

test("a post dated in the future does not bury what comes after it", () => {
  const mark = markThrough([post("future", NOW + 30 * 24 * HOUR)], undefined, NOW);
  assert.equal(mark.at, NOW);
  // Seen once, so it does not come back on every look until that date arrives.
  assert.deepEqual(freshSince([post("future", NOW + 30 * 24 * HOUR)], mark), []);
  assert.deepEqual(freshSince([post("next", NOW + 60)], mark).map((p) => p.id), ["next"]);
});

test("a mark never moves backward when the newest post has been removed", () => {
  const first = markThrough([post("gone", NOW - 10)], undefined, NOW);
  assert.equal(markThrough([post("old", NOW - HOUR)], first, NOW).at, first.at);
});

test("an empty list marks the present, so the first post after it counts", () => {
  const mark = markThrough([], undefined, NOW);
  assert.deepEqual(freshSince([post("first", NOW + 5)], mark).map((p) => p.id), ["first"]);
});

test("What's New leaves out your own posts", () => {
  const posts = [{ agent: { pubkey: ME } }, { agent: { pubkey: "b".repeat(64) } }];
  assert.deepEqual(postsFromOthers(posts, ME), [posts[1]]);
});

test("a first look gets the latest posts rather than an empty room", () => {
  const posts = Array.from({ length: FIRST_LOOK_POSTS + 5 }, (_, i) => post(`p${i}`, NOW - i));
  assert.deepEqual(whatsNewList(posts, null), posts.slice(0, FIRST_LOOK_POSTS));
});

test("after that it is every post since, with no cap", () => {
  const posts = Array.from({ length: FIRST_LOOK_POSTS + 5 }, (_, i) => post(`p${i}`, NOW - i));
  const since = { at: NOW - HOUR, ids: [] };
  assert.equal(whatsNewList(posts, since).length, posts.length);
});

test("a letter stops being new once it is read", () => {
  const letters = [{ id: "one" }, { id: "two" }];
  assert.deepEqual(newLetters(letters), letters);
  assert.deepEqual(newLetters(letters, ["one"]), [{ id: "two" }]);
});

const quiet = { marks: {}, roomPosts: [], ownPosts: [], ownComments: [], notificationsUnread: 0 };

test("with nothing going on, no bubble has a dot", () => {
  assert.deepEqual(liveDots(quiet), { "whats-new": false, notifications: false, posts: false, comments: false });
});

test("a regular's old posts do not light a dot before there is a mark", () => {
  const dots = liveDots({ ...quiet, ownPosts: [post("old", NOW)], ownComments: [post("old2", NOW)] });
  assert.equal(dots.posts, false);
  assert.equal(dots.comments, false);
});

test("each dot lights for its own bubble alone", () => {
  const marks = {
    "whats-new": markThrough([], undefined, NOW),
    posts: markThrough([], undefined, NOW),
    comments: markThrough([], undefined, NOW),
  };
  const later = [post("new", NOW + 60)];
  assert.deepEqual(liveDots({ ...quiet, marks, roomPosts: later }), {
    "whats-new": true, notifications: false, posts: false, comments: false,
  });
  assert.deepEqual(liveDots({ ...quiet, marks, ownPosts: later }), {
    "whats-new": false, notifications: false, posts: true, comments: false,
  });
  assert.deepEqual(liveDots({ ...quiet, marks, ownComments: later }), {
    "whats-new": false, notifications: false, posts: false, comments: true,
  });
  assert.deepEqual(liveDots({ ...quiet, marks, notificationsUnread: 2 }), {
    "whats-new": false, notifications: true, posts: false, comments: false,
  });
});

test("the first look lights What's New", () => {
  assert.equal(liveDots({ ...quiet, roomPosts: [post("any", NOW)] })["whats-new"], true);
});

test("seeding starts a bubble's history without lighting its dot, and only once", () => {
  seedBubble(ME, "posts", [post("old", NOW - HOUR)]);
  const seeded = readMarks(ME).posts;
  assert.deepEqual(freshSince([post("old", NOW - HOUR)], seeded), []);

  seedBubble(ME, "posts", [post("newer", NOW)]);
  assert.deepEqual(readMarks(ME).posts, seeded);
});

test("coming back to the page mid-visit keeps the same list", () => {
  markBubbleSeen(ME, "whats-new", [post("old", NOW - HOUR)]);
  const before = readMarks(ME)["whats-new"]!;

  const start = NOW * 1000;
  assert.deepEqual(beginVisit(ME, start), before);
  markBubbleSeen(ME, "whats-new", [post("new", NOW)]);

  // Back from reading a post: the mark has moved, and the list must not.
  assert.deepEqual(beginVisit(ME, start + 60_000), before);
});

test("a visit after a long enough gap starts from where the last one left off", () => {
  markBubbleSeen(ME, "whats-new", [post("old", NOW - HOUR)]);
  const start = NOW * 1000;
  beginVisit(ME, start);
  markBubbleSeen(ME, "whats-new", [post("new", NOW)]);
  const after = readMarks(ME)["whats-new"]!;

  assert.deepEqual(beginVisit(ME, start + 31 * 60_000), after);
});

test("an ongoing visit is kept alive by being looked at", () => {
  markBubbleSeen(ME, "whats-new", [post("old", NOW - HOUR)]);
  const before = readMarks(ME)["whats-new"]!;
  const start = NOW * 1000;
  beginVisit(ME, start);
  beginVisit(ME, start + 20 * 60_000);
  assert.deepEqual(beginVisit(ME, start + 40 * 60_000), before);
});

test("the very first visit has nothing to count from", () => {
  assert.equal(beginVisit(ME, NOW * 1000), null);
});

test("marks belong to one key", () => {
  markLettersRead(ME, ["one"]);
  assert.deepEqual(readMarks(ME).letters, ["one"]);
  assert.deepEqual(readMarks("b".repeat(64)), {});
});

test("reading the same letter twice keeps one mark", () => {
  markLettersRead(ME, ["one"]);
  markLettersRead(ME, ["one", "two"]);
  assert.deepEqual(readMarks(ME).letters, ["one", "two"]);
});

test("marking what was already marked does not wake the listeners", () => {
  const items = [post("a", NOW - 10)];
  markBubbleSeen(ME, "posts", items);
  const version = getMarksVersion();
  markBubbleSeen(ME, "posts", items);
  assert.equal(getMarksVersion(), version);
});

test("a broken or disabled store costs a dot, never the page", () => {
  globalThis.localStorage = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  } as unknown as Storage;
  assert.deepEqual(readMarks(ME), {});
  assert.doesNotThrow(() => markBubbleSeen(ME, "posts", [post("a", NOW)]));
  assert.doesNotThrow(() => markLettersRead(ME, ["one"]));
});
