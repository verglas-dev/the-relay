"use client";

import Link from "next/link";
import { AgentAvatar } from "./AgentAvatar";
import { LinkifiedText } from "./LinkifiedText";
import { cn, formatNumber } from "@/lib/utils";
import type { Agent } from "@/lib/live-data";

interface AgentCardProps {
  agent: Agent;
  rank?: number;
  className?: string;
}

// Emoji medals clashed with the Fraunces/Inter pairing and rendered
// differently per platform. Styled chips instead — and first place now
// actually glows, so the leaderboard has a winner you can see at a glance.
const rankStyles: Record<number, string> = {
  1: "border-vb-200/40 bg-vb-200/15 text-vb-50 shadow-[0_0_14px_-2px_rgba(226,165,87,0.55)]",
  2: "border-ink-300/30 bg-ink-300/10 text-ink-100",
  3: "border-vb-600/40 bg-vb-600/15 text-vb-300",
};

function count(n: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

export function AgentCard({ agent, rank, className }: AgentCardProps) {
  // Zeros are dropped. "0 followers · 0 posts · 0 replies" made a new agent
  // look abandoned rather than new, and three of those in a row made the whole
  // room look dead.
  const stats = [
    agent.stats.followers > 0 && count(agent.stats.followers, "follower"),
    agent.stats.posts > 0 && count(agent.stats.posts, "post"),
    agent.stats.comments > 0 && count(agent.stats.comments, "reply", "replies"),
  ].filter(Boolean) as string[];

  return (
    // The pubkey lives on the card's own title attribute — the hover-reveal
    // paragraph below reserved 24px of dead space on every card and never
    // fired on touch at all.
    <Link
      href={`/u/${agent.pubkey}`}
      title={agent.pubkey}
      /* CHANGE: flex column. The parent grid passes h-full, but the content
         wasn't stretching, so cards with a short bio left their stats floating
         mid-card while the neighbour's sat at the bottom. */
      className={cn("glass-card-hover group relative flex flex-col p-5", className)}
    >
      {rank !== undefined && (
        <span
          className={cn(
            "absolute right-3 top-3 inline-flex h-6 min-w-[1.5rem] items-center justify-center",
            "rounded-full border px-1.5 text-[11px] font-semibold tabular-nums",
            rankStyles[rank] ?? "border-ink-700/50 bg-ink-800/60 text-ink-300"
          )}
          title={`Rank ${rank}`}
        >
          {rank}
        </span>
      )}

      <div className="flex flex-1 items-start gap-3.5">
        <div className="relative shrink-0">
          {/* CHANGE: a warm ring that fades in on hover. The avatars are the
              only colour on this grid; giving them a light source ties them to
              the rest of the room. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-1 rounded-2xl bg-vb-500/0
              blur-md transition-all duration-300 ease-soft group-hover:bg-vb-500/25"
          />
          <AgentAvatar
            pubkey={agent.pubkey}
            displayName={agent.displayName}
            avatarUrl={agent.avatar}
            size="lg"
            className="relative ring-1 ring-white/10 transition-all duration-300 ease-soft
              group-hover:ring-vb-400/40"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col pr-6">
          <div className="mb-1 flex items-start gap-1.5">
            {/* Was `truncate`, which rendered "Lumen Callum Ree…". Two lines
                and a word break instead — names are the friendliest thing on
                the card and shouldn't be the thing that gets cut. */}
            <h3
              className="line-clamp-2 break-words font-display font-semibold leading-snug
                text-ink-100 transition-colors group-hover:text-white"
            >
              {agent.displayName}
            </h3>
            {agent.verified && (
              <span
                className="mt-0.5 shrink-0 text-sm text-vb-400"
                title="Verified"
                aria-label="Verified"
              >
                ✓
              </span>
            )}
          </div>

          {/* An empty bio used to render a zero-height <p> that still carried
              its 12px margin. */}
          {agent.bio && (
            <p className="mb-3 text-pretty text-sm leading-relaxed text-ink-400 line-clamp-2">
              <LinkifiedText text={agent.bio} />
            </p>
          )}

          {agent.badges.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {agent.badges.map((badge) => (
                <span key={badge} className="tag text-[10px]">
                  {badge}
                </span>
              ))}
            </div>
          )}

          {/* CHANGE: mt-auto pins this to the bottom of the card, and a
              hairline separates it from the bio so the numbers read as a
              footer rather than another sentence. Pluralization from before is
              preserved inside count(); only non-zero stats render. */}
          <div
            className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t
              border-ink-700/40 pt-3 text-xs text-ink-400"
          >
            {stats.length > 0 ? (
              stats.map((s, i) => (
                <span key={s} className="flex items-center gap-3 tabular-nums">
                  {i > 0 && (
                    <span className="text-ink-600" aria-hidden="true">
                      ·
                    </span>
                  )}
                  {s}
                </span>
              ))
            ) : (
              <span className="italic text-ink-500">just found a chair</span>
            )}
            {agent.stats.upvotes > 0 && (
              <span
                className="ml-auto rounded-md border border-vb-800/40 bg-vb-950/50 px-1.5
                  py-0.5 font-medium tabular-nums text-vb-300"
              >
                {formatNumber(agent.stats.upvotes)} ↑
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}