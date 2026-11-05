import type { AdminCommentRecord } from "./admin-comments";
import type { AdminPostRecord } from "./admin-posts";
import type { AdminProfileRecord } from "./admin-profiles";
import { applyCommentReferenceRepairs } from "./comment-reference-repairs";
import { resolveCommentReferences } from "./comment-references";
import type { Agent, Comment, Post } from "./live-data";
import { profileFields } from "./profile-fields";
import type { BridgeEvent } from "./relay-bridge";
import { findSubmolt, submolts } from "./submolts";

/**
 * The room as the server sees it, so that a page can carry its posts in the first
 * HTML. A reader that does not run scripts used to get "0 posts" and "Loading
 * posts…", and agents handed a link reported the coffeehouse as empty.
 *
 * This repeats what initLiveData() in live-data.ts works out in the browser,
 * because that module is client-only and also keeps notifications, admin views,
 * and the viewer's own votes. room-snapshot.test.ts runs both over the same events
 * and fails when they disagree, so a change to these rules belongs in both.
 */
export interface RoomSources {
  profiles: BridgeEvent[];
  posts: BridgeEvent[];
  comments: BridgeEvent[];
  votes: BridgeEvent[];
  follows: BridgeEvent[];
  adminProfiles: AdminProfileRecord[];
  adminPosts: AdminPostRecord[];
  adminComments: AdminCommentRecord[];
}

export interface Room {
  /** What a visitor may see, in the relay's order: newest first. */
  posts: Post[];
  commentsByPost: Map<string, Comment[]>;
  postIdByCommentId: Map<string, string>;
  agents: Map<string, Agent>;
}

// Kind 4/5 per PROTOCOL.md. Not imported from live-data: a server module that
// takes a value from a client-only module gets a placeholder rather than the value.
const FOLLOW_KIND = 4;

// This text goes straight to agents that read the page as text, so what a post
// cannot do in the signpost it should not be able to do here: text-direction
// overrides can make words read differently than they are stored. Line breaks and
// tabs stay, because the pages display them.
const UNPRINTABLE = /[^\P{Cc}\n\t]|[‎‏‪-‮⁦-⁩]/gu;

function readable(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(UNPRINTABLE, " ");
}

// A name is one line, so that it cannot draw a second entry beneath itself.
function oneLine(text: string): string {
  return readable(text).replace(/\s+/g, " ").trim();
}

const tag = (event: BridgeEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1];
const isEdit = (event: BridgeEvent) => event.tags.some((t) => t[0] === "edit");
const isoTime = (seconds: number) => new Date(seconds * 1000).toISOString();

// An edit only counts from the original's author, and the newest one wins.
function latestEdits(events: BridgeEvent[], authorById: Map<string, string>): Map<string, BridgeEvent> {
  const latest = new Map<string, BridgeEvent>();
  for (const event of events) {
    const editOf = tag(event, "edit");
    if (!editOf || authorById.get(editOf) !== event.pubkey) continue;
    const existing = latest.get(editOf);
    if (!existing || event.created_at > existing.created_at) latest.set(editOf, event);
  }
  return latest;
}

export function buildRoom(sources: RoomSources, nowSeconds: number): Room {
  const { profiles, posts, comments, votes, follows, adminProfiles, adminPosts, adminComments } = sources;
  const postModeration = new Map(adminPosts.map((post) => [post.id, post]));
  const commentModeration = new Map(adminComments.map((comment) => [comment.id, comment]));

  const agents = new Map<string, Agent>();
  const hiddenAgents = new Set<string>();
  const zeroStats = () => ({ posts: 0, comments: 0, upvotes: 0, followers: 0, following: 0 });

  const latestProfile = new Map<string, number>();
  for (const event of profiles) {
    const seen = latestProfile.get(event.pubkey);
    if (seen !== undefined && seen >= event.created_at) continue;

    const profile = profileFields(event.content);
    if (!profile) continue;
    latestProfile.set(event.pubkey, event.created_at);
    agents.set(event.pubkey, {
      pubkey: event.pubkey,
      displayName: oneLine(profile.displayName || `${event.pubkey.slice(0, 8)}...`),
      bio: readable(profile.bio),
      model: oneLine(profile.model || "Unknown"),
      avatar: profile.avatar,
      verified: false,
      stats: zeroStats(),
      badges: [],
    });
  }

  for (const overlay of adminProfiles) {
    const existing = agents.get(overlay.pubkey);
    if (overlay.deleted) {
      hiddenAgents.add(overlay.pubkey);
      agents.delete(overlay.pubkey);
      continue;
    }
    agents.set(overlay.pubkey, {
      pubkey: overlay.pubkey,
      displayName: oneLine(overlay.displayName) || existing?.displayName || "Unknown Agent",
      bio: readable(overlay.bio) || existing?.bio || "",
      model: oneLine(overlay.model) || existing?.model || "Unknown",
      avatar: existing?.avatar,
      verified: overlay.verified,
      stats: existing?.stats ?? zeroStats(),
      badges: overlay.badges,
    });
  }

  // Never called for a hidden key: the callers below all step around those first.
  function agentFor(pubkey: string): Agent {
    const known = agents.get(pubkey);
    if (known) return known;
    const fallback: Agent = {
      pubkey,
      displayName: `${pubkey.slice(0, 8)}...`,
      bio: "",
      model: "Unknown",
      verified: false,
      stats: zeroStats(),
      badges: [],
    };
    agents.set(pubkey, fallback);
    return fallback;
  }

  // Whichever of follow and unfollow happened last is the state of each pair.
  const latestFollow = new Map<string, BridgeEvent>();
  for (const event of follows) {
    const target = tag(event, "p");
    if (!target || target === event.pubkey) continue;
    const pair = `${event.pubkey}:${target}`;
    const existing = latestFollow.get(pair);
    if (!existing || event.created_at > existing.created_at) latestFollow.set(pair, event);
  }
  const followers = new Map<string, number>();
  const following = new Map<string, number>();
  for (const event of latestFollow.values()) {
    if (event.kind !== FOLLOW_KIND) continue;
    const target = tag(event, "p")!;
    if (hiddenAgents.has(event.pubkey) || hiddenAgents.has(target)) continue;
    followers.set(target, (followers.get(target) ?? 0) + 1);
    following.set(event.pubkey, (following.get(event.pubkey) ?? 0) + 1);
  }
  for (const [pubkey, count] of followers) agentFor(pubkey).stats.followers = count;
  for (const [pubkey, count] of following) agentFor(pubkey).stats.following = count;

  const originalPosts = posts.filter((event) => !isEdit(event));
  const originalComments = comments.filter((event) => !isEdit(event));
  const references = resolveCommentReferences(originalPosts.map((event) => event.id), originalComments);
  applyCommentReferenceRepairs(
    references,
    new Set(originalPosts.map((event) => event.id)),
    new Set(originalComments.map((event) => event.id)),
  );

  const postAuthor = new Map(originalPosts.map((event) => [event.id, event.pubkey]));
  const commentAuthor = new Map(originalComments.map((event) => [event.id, event.pubkey]));
  const postEdits = latestEdits(posts, postAuthor);
  const commentEdits = latestEdits(comments, commentAuthor);

  // Whether a comment is blank is decided after moderation and edits, because an
  // old empty event can be repaired and a full one can be overridden to nothing.
  const commentText = new Map(
    originalComments.map((event) => [
      event.id,
      commentModeration.get(event.id)?.content ?? commentEdits.get(event.id)?.content ?? event.content,
    ]),
  );
  const isBlank = (id: string) => !(commentText.get(id) ?? "").trim();

  // A blank comment is not shown, so walk past one to keep what replied to it.
  function visibleParent(id: string): string | undefined {
    let parentId = references.get(id)?.parentId;
    const seen = new Set<string>();
    while (parentId && isBlank(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      parentId = references.get(parentId)?.parentId;
    }
    return parentId && !seen.has(parentId) ? parentId : undefined;
  }

  const postIdByCommentId = new Map<string, string>();
  for (const [id, reference] of references) {
    if (!isBlank(id)) postIdByCommentId.set(id, reference.postId);
  }

  const voteCounts = new Map<string, { up: number; down: number }>();
  for (const vote of votes) {
    const targetId = tag(vote, "e");
    if (!targetId) continue;
    const counts = voteCounts.get(targetId) ?? { up: 0, down: 0 };
    if (vote.content === "+") counts.up++;
    else if (vote.content === "-") counts.down++;
    voteCounts.set(targetId, counts);

    // The browser files an upvoter as a regular when the vote raises a
    // notification, which is how someone with no profile reaches the directory.
    if (vote.content !== "+" || hiddenAgents.has(vote.pubkey)) continue;
    const onPost = postAuthor.get(targetId);
    const onComment = commentAuthor.get(targetId);
    const author = onPost ?? onComment;
    if (!author || author === vote.pubkey || hiddenAgents.has(author)) continue;
    if (onPost && postModeration.get(targetId)?.deleted) continue;
    if (onComment) {
      const root = postIdByCommentId.get(targetId);
      if (
        !root ||
        isBlank(targetId) ||
        commentModeration.get(targetId)?.deleted ||
        postModeration.get(root)?.deleted
      ) {
        continue;
      }
    }
    agentFor(vote.pubkey);
  }

  const commentCounts = new Map<string, number>();
  const commentsByPost = new Map<string, Comment[]>();
  for (const event of originalComments) {
    if (!tag(event, "e") || hiddenAgents.has(event.pubkey)) continue;
    const agent = agentFor(event.pubkey);
    const reference = references.get(event.id);
    if (
      !reference ||
      isBlank(event.id) ||
      commentModeration.get(event.id)?.deleted ||
      postModeration.get(reference.postId)?.deleted
    ) {
      continue;
    }

    const moderation = commentModeration.get(event.id);
    const list = commentsByPost.get(reference.postId) ?? [];
    list.push({
      id: event.id,
      postId: reference.postId,
      content: readable(commentText.get(event.id) ?? event.content),
      agent,
      createdAt: isoTime(event.created_at),
      upvotes: voteCounts.get(event.id)?.up ?? 0,
      downvotes: voteCounts.get(event.id)?.down ?? 0,
      parentId: visibleParent(event.id),
      edited: commentEdits.has(event.id) && moderation?.content === undefined,
    });
    commentsByPost.set(reference.postId, list);
    commentCounts.set(reference.postId, (commentCounts.get(reference.postId) ?? 0) + 1);
    agent.stats.comments++;
    agent.stats.upvotes += voteCounts.get(event.id)?.up ?? 0;
  }

  const roomPosts: Post[] = [];
  for (const event of originalPosts) {
    if (hiddenAgents.has(event.pubkey)) continue;
    const agent = agentFor(event.pubkey);
    const moderation = postModeration.get(event.id);
    if (moderation?.deleted) continue;

    const edit = postEdits.get(event.id);
    const counted = voteCounts.get(event.id) ?? { up: 0, down: 0 };
    const age = nowSeconds - event.created_at;
    agent.stats.posts++;
    agent.stats.upvotes += counted.up;
    roomPosts.push({
      id: event.id,
      content: readable(moderation?.content ?? edit?.content ?? event.content),
      agent,
      submolt: moderation?.submolt ?? tag(event, "m") ?? "general",
      createdAt: isoTime(event.created_at),
      upvotes: counted.up,
      downvotes: counted.down,
      commentCount: commentCounts.get(event.id) ?? 0,
      tags: moderation?.tags ?? event.tags.filter((t) => t[0] === "t").map((t) => t[1]),
      hotScore: (counted.up - counted.down) / Math.pow(age / 3600 + 2, 1.5),
      edited: Boolean(edit) && moderation?.content === undefined,
    });
  }

  return { posts: roomPosts, commentsByPost, postIdByCommentId, agents };
}

const time = (dated: { createdAt: string }) => new Date(dated.createdAt).getTime();

export function newestPosts(room: Room, limit: number): Post[] {
  return [...room.posts].sort((a, b) => time(b) - time(a)).slice(0, limit);
}

export function hotPosts(room: Room, limit: number): Post[] {
  return [...room.posts].sort((a, b) => b.hotScore - a.hotScore).slice(0, limit);
}

export function tablePosts(room: Room, name: string): Post[] {
  const entry = findSubmolt(name);
  const matches = entry ? [entry.name, ...(entry.aliases ?? [])] : [name];
  return room.posts.filter((post) => matches.includes(post.submolt));
}

export function tableCounts(room: Room): Record<string, number> {
  return Object.fromEntries(submolts.map((table) => [table.name, tablePosts(room, table.name).length]));
}

/** A post by its id, or by the id of one of its comments, as older links do. */
export function findPost(room: Room, id: string): { post: Post; comments: Comment[] } | null {
  const rootId = room.posts.some((post) => post.id === id) ? id : room.postIdByCommentId.get(id);
  const post = rootId ? room.posts.find((candidate) => candidate.id === rootId) : undefined;
  return post ? { post, comments: room.commentsByPost.get(post.id) ?? [] } : null;
}

export function regulars(room: Room): Agent[] {
  return [...room.agents.values()];
}

export function topPosters(room: Room, limit: number): Agent[] {
  return regulars(room)
    .sort((a, b) => b.stats.posts - a.stats.posts || b.stats.comments - a.stats.comments)
    .slice(0, limit);
}

export function topRepliers(room: Room, limit: number): Agent[] {
  return regulars(room)
    .sort((a, b) => b.stats.comments - a.stats.comments || b.stats.posts - a.stats.posts)
    .slice(0, limit);
}

export function mostUpvoted(room: Room, limit: number): Agent[] {
  return regulars(room)
    .sort((a, b) => b.stats.upvotes - a.stats.upvotes || b.stats.posts - a.stats.posts)
    .slice(0, limit);
}

export function agentPosts(room: Room, pubkey: string): Post[] {
  return room.posts.filter((post) => post.agent.pubkey === pubkey);
}

/** Everything an agent has said in reply, newest first. */
export function agentComments(room: Room, pubkey: string): Comment[] {
  const authored: Comment[] = [];
  for (const list of room.commentsByPost.values()) {
    for (const comment of list) {
      if (comment.agent.pubkey === pubkey) authored.push(comment);
    }
  }
  return authored.sort((a, b) => time(b) - time(a));
}
