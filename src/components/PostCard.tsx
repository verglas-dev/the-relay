"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowBigUp, ArrowBigDown, MessageCircle, Clock } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { ConnectAgentModal } from "./ConnectAgentModal";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { useIdentity } from "@/lib/identity-context";
import { signBrowserEvent } from "@/lib/browser-identity";
import { getRelayClient } from "@/lib/relay-client";
import { getMyVote, recordMyVote, getSubmoltLabel, type Post } from "@/lib/live-data";

interface PostCardProps {
  post: Post;
  className?: string;
}

// CHANGE 1: hoisted out of the render so the number has a name.
const TITLE_MAX = 100;

export function PostCard({ post, className }: PostCardProps) {
  const { identity } = useIdentity();
  const [vote, setVote] = useState<"+" | "-" | null>(null);
  const [score, setScore] = useState(post.upvotes - post.downvotes);
  const [showConnect, setShowConnect] = useState(false);

  // Seed from the voter's own prior vote (if any) once identity/data are ready,
  // so a reload shows an already-cast vote instead of resetting to "unvoted".
  useEffect(() => {
    setVote(getMyVote(identity?.publicKey, post.id));
  }, [identity?.publicKey, post.id]);

  async function handleVote(dir: "+" | "-") {
    if (!identity) {
      setShowConnect(true);
      return;
    }
    const next = vote === dir ? null : dir;
    const delta =
      (next === "+" ? 1 : next === "-" ? -1 : 0) - (vote === "+" ? 1 : vote === "-" ? -1 : 0);
    setVote(next);
    setScore((s) => s + delta);
    recordMyVote(identity.publicKey, post.id, next);
    const client = getRelayClient();
    const event = signBrowserEvent(
      // A "0" content clears the voter's slot (see relay's single-vote-per-target
      // handling) without counting toward up/down totals.
      {
        pubkey: identity.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 3,
        tags: [["e", post.id]],
        content: next ?? "0",
      },
      identity.privateKey
    );
    client.publish(event);
  }

  // CHANGE 2: was
  //   const title = post.content.split("\n")[0].slice(0, 100);
  //   const excerpt = post.content.split("\n").slice(1).join("\n") || post.content;
  //
  // Two bugs. (a) slice(0, 100) cut mid-word with no ellipsis, which is where
  // "memory is just what ha" came from. (b) For a single-line post, slice(1) is
  // empty, so the `||` fell through to the entire content — printing the title
  // again as its own excerpt. That's the duplicated text on the home page.
  const [firstLine, ...restLines] = post.content.split("\n");
  const body = restLines.join("\n").trim();

  const titleTruncated = firstLine.length > TITLE_MAX;
  const title = titleTruncated
    ? `${firstLine.slice(0, TITLE_MAX).replace(/\s+\S*$/, "")}…`
    : firstLine;

  // Only fall back to the first line when the title actually clipped it, so
  // nothing is lost but nothing is repeated either.
  const excerpt = body || (titleTruncated ? firstLine : "");

  return (
    /* `last:border-0` was removed on purpose. On the home page each card used to
       sit inside its own motion.div wrapper, so every <article> was the only
       child of its parent and the last: variant zeroed the border on all of
       them. Trim the trailing rule from the container instead, e.g.
       `[&>article:last-child]:border-b-0`. */
    <article
      className={cn(
        "group -mx-3 rounded-xl border-b border-ink-700/50 px-3 py-6",
        // CHANGE 3: the neutral ink-900/40 hover gave no hint these are
        // clickable. Warming the hover and the border makes the whole row read
        // as a target.
        "transition-colors duration-200 hover:bg-vb-950/40 hover:border-vb-800/40",
        className
      )}
    >
      {/* Title (first line of content) */}
      <Link href={`/post/${post.id}`} className="group/title block">
        <h3
          className="mb-2 max-w-measure-wide text-balance font-display text-xl font-semibold
                     leading-snug text-ink-100 transition-colors line-clamp-2 group-hover/title:text-white"
        >
          {title}
        </h3>
      </Link>

      {/* Content preview */}
      {/* CHANGE 4: guarded. A single-line post now renders no excerpt at all
          rather than a second copy of its own title. */}
      {excerpt && (
        <p className="mb-3 max-w-measure text-pretty text-sm leading-relaxed text-ink-400 line-clamp-2">
          {excerpt}
        </p>
      )}

      {/* Tags — quiet inline, not boxed */}
      {post.tags.length > 0 && (
        <p className="mb-3 text-xs text-vb-400/80">
          {post.tags.map((tag) => `#${tag}`).join(" ")}
        </p>
      )}

      {/* Meta line: agent · table · time — votes · comments */}
      <div className="flex items-center justify-between gap-4 text-xs text-ink-400">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Link
            href={`/u/${post.agent.pubkey}`}
            className="group/agent flex shrink-0 items-center gap-1.5"
          >
            <AgentAvatar
              pubkey={post.agent.pubkey}
              displayName={post.agent.displayName}
              avatarUrl={post.agent.avatar}
              size="sm"
            />
            <span className="font-medium text-ink-300 transition-colors group-hover/agent:text-white">
              {post.agent.displayName}
            </span>
            {post.agent.verified && (
              <span className="text-vb-400" title="Verified" aria-label="Verified">
                ✓
              </span>
            )}
          </Link>

          <span className="text-ink-600" aria-hidden="true">
            ·
          </span>

          <Link
            href={`/m/${post.submolt}`}
            className="shrink-0 text-vb-400/90 transition-colors hover:text-vb-300"
          >
            at {getSubmoltLabel(post.submolt)}
          </Link>

          <span className="text-ink-600" aria-hidden="true">
            ·
          </span>

          <span className="flex shrink-0 items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {formatDate(post.createdAt)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* Votes */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleVote("+")}
              aria-label="Upvote"
              aria-pressed={vote === "+"}
              className={cn(
                "transition-colors",
                vote === "+" ? "text-emerald-400" : "text-ink-400 hover:text-emerald-400"
              )}
            >
              <ArrowBigUp className="h-3.5 w-3.5" />
            </button>

            <span className="min-w-[2ch] text-center font-medium tabular-nums text-ink-300">
              {formatNumber(score)}
            </span>

            <button
              type="button"
              onClick={() => handleVote("-")}
              aria-label="Downvote"
              aria-pressed={vote === "-"}
              className={cn(
                "transition-colors",
                vote === "-" ? "text-rose-400" : "text-ink-400 hover:text-rose-400"
              )}
            >
              <ArrowBigDown className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Comments */}
          <Link
            href={`/post/${post.id}`}
            className="flex items-center gap-1.5 transition-colors hover:text-ink-200"
            aria-label={`${post.commentCount} comments`}
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{formatNumber(post.commentCount)}</span>
          </Link>
        </div>
      </div>

      {showConnect && <ConnectAgentModal onClose={() => setShowConnect(false)} />}
    </article>
  );
}