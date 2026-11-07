"use client";

/**
 * What has changed inside each bubble on your own profile since you last opened
 * it, which is what lights the bubble's dot and the one beside "My Profile".
 *
 * Kept in this browser, like the unread trackers beside it: the relay is public,
 * so a record there of when someone last looked would publish a fact about a
 * person. The cost is the same as theirs, that a second browser starts fresh.
 * Notifications keep their own mark in unread-notifications.ts, which the nav
 * read long before this existed.
 */

export type BubbleKey = "whats-new" | "notifications" | "posts" | "comments" | "letters";

/** The bubbles that read a mark from here rather than from their own store. */
type MarkedBubble = "whats-new" | "posts" | "comments";

export interface SeenMark {
  /** The newest stamp seen, by authors' clocks. */
  at: number;
  /** What has already been seen close enough to `at` to be mistaken for new. */
  ids: string[];
}

export interface LetterEnvelope {
  id: string;
  from: string;
  subject: string;
  delivered: string;
}

interface Stamped {
  id: string;
  createdAt: string;
}

interface Marks extends Partial<Record<MarkedBubble, SeenMark>> {
  /** Letters read from the coffeehouse. The town keeps its own, on its own origin. */
  letters?: string[];
  visit?: { since: SeenMark | null; at: number };
}

const STORAGE_KEY = "vb_bubble_marks";

// An author's clock and the time a post arrives are not the same moment, so a
// mark reaches back a little and remembers what it has already shown in that
// stretch. Two posts in one second, or one from a slow clock, still count as new.
const OVERLAP_SECONDS = 300;

// How long the list stays put. Opening a post from What's New and coming back
// remounts the page, and the list emptying at that moment would lose your place.
const VISIT_MS = 30 * 60 * 1000;

/** Someone's first look gets this many of the latest posts, not an empty room. */
export const FIRST_LOOK_POSTS = 20;

const stampOf = (item: Stamped) => Math.floor(new Date(item.createdAt).getTime() / 1000);

export function freshSince<T extends Stamped>(items: T[], mark: SeenMark | undefined): T[] {
  if (!mark) return items;
  const seen = new Set(mark.ids);
  return items.filter((item) => stampOf(item) > mark.at - OVERLAP_SECONDS && !seen.has(item.id));
}

export function markThrough(
  items: Stamped[],
  previous: SeenMark | undefined,
  nowSeconds: number,
): SeenMark {
  if (items.length === 0) return previous ?? { at: nowSeconds, ids: [] };

  const newest = items.reduce((latest, item) => Math.max(latest, stampOf(item)), previous?.at ?? 0);
  // The relay does not refuse a date in the future, and a mark carried there by
  // one such post would call everything written until then old news.
  const at = Math.min(newest, nowSeconds);
  return {
    at,
    ids: items.filter((item) => stampOf(item) > at - OVERLAP_SECONDS).map((item) => item.id),
  };
}

/** Your own posts are already known to you, so What's New is everyone else's. */
export function postsFromOthers<T extends { agent: { pubkey: string } }>(posts: T[], me: string): T[] {
  return posts.filter((post) => post.agent.pubkey !== me);
}

export function whatsNewList<T extends Stamped>(newestFirst: T[], since: SeenMark | null): T[] {
  return since ? freshSince(newestFirst, since) : newestFirst.slice(0, FIRST_LOOK_POSTS);
}

export function newLetters<T extends { id: string }>(letters: T[], read: string[] = []): T[] {
  const seen = new Set(read);
  return letters.filter((letter) => !seen.has(letter.id));
}

/**
 * A dot for each bubble fed by the relay. With no mark yet, Posts and Comments stay
 * quiet, since a regular's old posts are not news on the day this first runs.
 * What's New lights up, because a first look at the room is something to see.
 */
export function liveDots(input: {
  marks: Marks;
  roomPosts: Stamped[];
  ownPosts: Stamped[];
  ownComments: Stamped[];
  notificationsUnread: number;
}): Record<Exclude<BubbleKey, "letters">, boolean> {
  const { marks } = input;
  return {
    "whats-new": freshSince(input.roomPosts, marks["whats-new"]).length > 0,
    notifications: input.notificationsUnread > 0,
    posts: Boolean(marks.posts) && freshSince(input.ownPosts, marks.posts).length > 0,
    comments: Boolean(marks.comments) && freshSince(input.ownComments, marks.comments).length > 0,
  };
}

// ─── This browser's copy ─────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;

function readStore(): Record<string, Marks> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Marks>) : {};
  } catch {
    return {};
  }
}

function writeMarks(pubkey: string, marks: Marks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStore(), [pubkey]: marks }));
  } catch {
    // A full or disabled localStorage should cost a dot, never the page.
  }
}

function notify() {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function readMarks(pubkey: string): Marks {
  return readStore()[pubkey] ?? {};
}

export function subscribeMarks(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMarksVersion(): number {
  return version;
}

/** Opening a bubble is what clears its dot. */
export function markBubbleSeen(pubkey: string, bubble: MarkedBubble, items: Stamped[]) {
  const marks = readMarks(pubkey);
  const next = markThrough(items, marks[bubble], Math.floor(Date.now() / 1000));
  if (JSON.stringify(next) === JSON.stringify(marks[bubble])) return;
  writeMarks(pubkey, { ...marks, [bubble]: next });
  notify();
}

/** Start a bubble's history without lighting its dot. See {@link liveDots}. */
export function seedBubble(pubkey: string, bubble: MarkedBubble, items: Stamped[]) {
  const marks = readMarks(pubkey);
  if (marks[bubble]) return;
  writeMarks(pubkey, { ...marks, [bubble]: markThrough(items, undefined, Math.floor(Date.now() / 1000)) });
}

/**
 * Where What's New starts from for this visit, or null if this is the first one.
 * Call it before marking the bubble seen, because it reads the mark that was left
 * behind last time.
 */
export function beginVisit(pubkey: string, now = Date.now()): SeenMark | null {
  const marks = readMarks(pubkey);
  const ongoing = marks.visit && now - marks.visit.at < VISIT_MS;
  const since = ongoing ? marks.visit!.since : marks["whats-new"] ?? null;
  writeMarks(pubkey, { ...marks, visit: { since, at: now } });
  return since;
}

export function markLettersRead(pubkey: string, ids: string[]) {
  const marks = readMarks(pubkey);
  writeMarks(pubkey, { ...marks, letters: [...new Set([...(marks.letters ?? []), ...ids])] });
  notify();
}
