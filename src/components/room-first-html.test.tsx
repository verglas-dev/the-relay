import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { AgentCard } from "./AgentCard";
import { CommentThread } from "./CommentThread";
import { PostCard } from "./PostCard";
import type { Agent, Comment, Post } from "@/lib/live-data";

// These components only ever rendered in a browser until the room's pages began
// carrying posts in their first HTML. What can go wrong now is markup that renders
// and then fails to hydrate, or a component that reaches for the browser too early.

const agent: Agent = {
  pubkey: "a".repeat(64),
  displayName: "Alice",
  bio: "My site is https://example.com/alice and [this too](https://example.com/more).",
  model: "Unknown",
  verified: false,
  stats: { posts: 1, comments: 1, upvotes: 1, followers: 1, following: 0 },
  badges: [],
};

const post: Post = {
  id: "1".repeat(64),
  content: "The headline\nThe body, with **bold** and https://example.com/link in it.",
  agent,
  submolt: "general",
  createdAt: "2026-11-01T00:00:00.000Z",
  upvotes: 3,
  downvotes: 1,
  commentCount: 1,
  tags: ["hello"],
  hotScore: 0,
};

const comment: Comment = {
  id: "2".repeat(64),
  postId: post.id,
  content: "A comment, with https://example.com/comment in it.",
  agent,
  createdAt: "2026-11-02T00:00:00.000Z",
  upvotes: 2,
  downvotes: 0,
};

// The parser closes an open <a> when it meets another, so the page it builds no
// longer matches what React expects. Walk the tags to catch one inside another.
function nestedAnchors(html: string): number {
  let depth = 0;
  let nested = 0;
  for (const [tag] of html.matchAll(/<\/?a\b[^>]*>/g)) {
    if (tag.startsWith("</")) depth -= 1;
    else {
      if (depth > 0) nested += 1;
      depth += 1;
    }
  }
  return nested;
}

test("a post card carries the post and its score in the first HTML", () => {
  const html = renderToString(<PostCard post={post} />);
  assert.ok(html.includes("The headline"));
  assert.ok(html.includes("The body, with"));
  assert.ok(html.includes("Alice"));
  assert.match(html, />2<\/span>/, "the net score");
  assert.equal(nestedAnchors(html), 0);
});

test("a comment thread carries the comment and its anchor in the first HTML", () => {
  const html = renderToString(<CommentThread comments={[comment]} />);
  assert.ok(html.includes("A comment, with"));
  assert.ok(html.includes(`id="comment-${comment.id}"`));
  assert.equal(nestedAnchors(html), 0);
});

test("an agent card with a link in its bio does not nest one link in another", () => {
  const html = renderToString(<AgentCard agent={agent} rank={1} />);
  assert.equal(nestedAnchors(html), 0);
  assert.ok(html.includes("https://example.com/alice"), "the address stays, as words");
  assert.ok(html.includes("this too"));
  assert.ok(!html.includes('href="https://example.com/alice"'));
});
