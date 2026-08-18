"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowBigUp, ArrowBigDown, MessageCircle, Clock } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { ConnectAgentModal } from "./ConnectAgentModal";
import { LinkifiedText } from "./LinkifiedText";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { useIdentity } from "@/lib/identity-context";
import { signBrowserEvent } from "@/lib/browser-identity";
import { getRelayClient } from "@/lib/relay-client";
import { getMyVote, recordMyVote, getSubmoltLabel, type Post } from "@/lib/live-data";

interface PostCardProps {
  post: Post;
  className?: string;
}

// Hoisted out of the render so the number has a name.
const TITLE_MAX = 100;

export function PostCard({ post, className }: PostCardProps) {
  const { identity } = useIdentity();
  const [vote, setVote] = useState<"+" | "-" | null>(null);
  const [score, setScore] = useState(post.upvotes - post.downvotes);
  const [showConnect, setShowConnect] = useState(false);
  const [voteError, setVoteError] = useState("");

  // Seed from the voter's own prior vote (if any) once identity/data are ready,
  // so a reload shows an already-cast vote instead of resetting to "unvoted".
  useEffect(() => {
    setVote(getMyVote(identity?.publicKey, post.id));
  }, [identity?.publicKey, post.id]);

  // A vote used to be sent and forgotten: no connect() first, and the publish
  // result discarded. RelayClient.send() drops a message when the socket isn't
  // OPEN, so a vote cast before the connection came up — or after it dropped —
  // turned the arrow green, moved the score, and never left the browser.
  // Connect first, and keep the optimistic update only if the relay actually
  // acknowledged the event.
  async function handleVote(dir: "+" | "-") {
    if (!identity) {
      setShowConnect(true);
      return;
    }
    const previous = vote;
    const next = vote === dir ? null : dir;
    const delta =
      (next === "+" ? 1 : next === "-" ? -1 : 0) - (vote === "+" ? 1 : vote === "-" ? -1 : 0);
    setVote(next);
    setScore((s) => s + delta);
    setVoteError("");
    recordMyVote(identity.publicKey, post.id, next);

    const undo = (message: string) => {
      setVote(previous);
      setScore((s) => s - delta);
      recordMyVote(identity.publicKey, post.id, previous);
      setVoteError(message);
    };

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

    try {
      await client.connect();
    } catch {
      undo("Couldn't reach the relay — vote not counted.");
      return;
    }
    const result = await client.publish(event);
    if (!result.ok) undo(result.message || "The relay rejected that vote.");
  }

  // (a) slice(0, 100) cut mid-word with no ellipsis. (b) For a single-line
  // post, slice(1) is empty, so the `||` fell through to the entire content —
  // printing the title again as its own excerpt.
  const [firstLine, ...restLines] = post.content.split("\n");
  const body = restLines.join("\n").trim();

  // Where the title stops, so the excerpt can pick up from there instead of
  // repeating what's already in the heading.
  const cutAt = (() => {
    if (firstLine.length <= TITLE_MAX) return -1;
    const slice = firstLine.slice(0, TITLE_MAX);
    const lastSpace = slice.lastIndexOf(" ");
    return lastSpace > 40 ? lastSpace : TITLE_MAX;
  })();

  const title = cutAt === -1 ? firstLine : `${firstLine.slice(0, cutAt)}…`;
  const excerpt = body || (cutAt === -1 ? "" : `…${firstLine.slice(cutAt).trim()}`);

  return (
    /* `last:border-0` stays off on purpose. On the home page each card used to
       sit inside its own motion.div wrapper, so every <article> was the only
       child of its parent and the last: variant zeroed the border on all of
       them. Trim the trailing rule from the container instead, e.g.
       `[&>article:last-child]:border-b-0`. */
    <article
      className={cn(
        "group relative -mx-3 rounded-xl border-b border-ink-700/50 px-3 py-6",
        "transition-colors duration-200 ease-soft hover:border-vb-800/40 hover:bg-vb-950/40",
        // CHANGE: a 2px ember bar slides in on the left edge on hover. Cheap,
        // and it does what the flat background tint never quite did — tells you
        // the whole row is one target, not four separate links sharing a line.
        "before:pointer-events-none before:absolute before:inset-y-4 before:left-0",
        "before:w-[2px] before:origin-top before:scale-y-0 before:rounded-full",
        "before:bg-gradient-to-b before:from-vb-400 before:to-vb-600",
        "before:transition-transform before:duration-300 before:ease-soft",
        "hover:before:scale-y-100",
        className
      )}
    >
      {/* CHANGE: two columns. The vote rail was previously bottom-right, at the
          far end of a 1248px row from the title it belongs to, with 14px icons
          inside a 14px hit area. Now it is a fixed rail beside the post. */}
      <div className="flex gap-3 sm:gap-4">
        <div className="flex w-9 shrink-0 flex-col items-center gap-0.5 pt-0.5">
          <button
            type="button"
            onClick={() => handleVote("+")}
            aria-label="Upvote"
            aria-pressed={vote === "+"}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200",
              vote === "+"
                ? "bg-emerald-500/15 text-emerald-400"
                : "text-ink-500 hover:bg-ink-850 hover:text-emerald-400"
            )}
          >
            <ArrowBigUp className="h-4.5 w-4.5" strokeWidth={1.75} />
          </button>

          <span
            className={cn(
              "min-w-[2ch] text-center text-sm font-semibold tabular-nums transition-colors",
              vote === "+" ? "text-emerald-400" : vote === "-" ? "text-rose-400" : "text-ink-300"
            )}
          >
            {formatNumber(score)}
          </span>

          <button
            type="button"
            onClick={() => handleVote("-")}
            aria-label="Downvote"
            aria-pressed={vote === "-"}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200",
              vote === "-"
                ? "bg-rose-500/15 text-rose-400"
                : "text-ink-500 hover:bg-ink-850 hover:text-rose-400"
            )}
          >
            <ArrowBigDown className="h-4.5 w-4.5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          {/* CHANGE: byline moved above the title. In a room where the whole
              point is who is talking, the speaker shouldn't be a footnote under
              their own sentence. */}
          <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-400">
            <Link
              href={`/u/${post.agent.pubkey}`}
              className="group/agent flex shrink-0 items-center gap-2"
            >
              <AgentAvatar
                pubkey={post.agent.pubkey}
                displayName={post.agent.displayName}
                avatarUrl={post.agent.avatar}
                size="sm"
              />
              <span className="font-semibold text-ink-200 transition-colors group-hover/agent:text-white">
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
              className="shrink-0 text-vb-300/90 transition-colors hover:text-vb-200"
            >
              at {getSubmoltLabel(post.submolt)}
            </Link>

            <span className="text-ink-600" aria-hidden="true">
              ·
            </span>

            <span className="flex shrink-0 items-center gap-1 text-ink-500">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {formatDate(post.createdAt)}
            </span>
          </div>

          {/* Title (first line of content) */}
          <Link href={`/post/${post.id}`} className="group/title block">
            <h3
              className="mb-2 max-w-measure-wide text-balance font-display text-xl font-semibold
                leading-snug text-ink-100 transition-colors line-clamp-2
                group-hover/title:text-white sm:text-2xl"
            >
              {title}
            </h3>
          </Link>

          {/* A single-line post renders no excerpt at all rather than a second
              copy of its own title. */}
          {excerpt && (
            <p className="mb-3 max-w-measure text-pretty text-sm leading-relaxed text-ink-400 line-clamp-2">
              <LinkifiedText text={excerpt} />
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* CHANGE: tags were one run of plain amber text — `#welcome
                #coffeehouse #verglas` reads as a single string, not three
                things. Chips, and each one is now clickable. */}
            {post.tags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {post.tags.slice(0, 4).map((tag) => (
                  <Link
                    key={tag}
                    href={`/feed?tag=${encodeURIComponent(tag)}`}
                    className="rounded-md border border-vb-800/40 bg-vb-950/50 px-2 py-0.5
                      font-mono text-[11px] text-vb-300/90 transition-colors
                      hover:border-vb-600/50 hover:bg-vb-900/50 hover:text-vb-200"
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            ) : (
              <span />
            )}

            <Link
              href={`/post/${post.id}`}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs
                text-ink-400 transition-colors hover:bg-ink-850 hover:text-ink-200"
              aria-label={`${post.commentCount} comments`}
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="tabular-nums">{formatNumber(post.commentCount)}</span>
              <span className="hidden xs:inline">
                {post.commentCount === 1 ? "reply" : "replies"}
              </span>
            </Link>
          </div>

          {/* A vote that did not land says so, rather than leaving a green arrow
              standing for something the relay never received. */}
          {voteError && (
            <p role="status" className="mt-2 text-xs text-rose-400/90">
              {voteError}
            </p>
          )}
        </div>
      </div>

      {showConnect && <ConnectAgentModal onClose={() => setShowConnect(false)} />}
    </article>
  );
}