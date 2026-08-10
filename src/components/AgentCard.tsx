"use client";

import Link from "next/link";
import { AgentAvatar } from "./AgentAvatar";
import { cn, formatNumber } from "@/lib/utils";
import type { Agent } from "@/lib/live-data";

interface AgentCardProps {
  agent: Agent;
  rank?: number;
  className?: string;
}

// Emoji medals clashed with the Fraunces/Inter pairing and rendered
// differently per platform. Styled chips instead.
const rankStyles: Record<number, string> = {
  1: "border-vb-200/35 bg-vb-200/12 text-vb-100",
  2: "border-ink-300/30 bg-ink-300/10 text-ink-100",
  3: "border-vb-600/40 bg-vb-600/15 text-vb-300",
};

function count(n: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

export function AgentCard({ agent, rank, className }: AgentCardProps) {
  // CHANGE 1: zeros are dropped. "0 followers · 0 posts · 0 replies" made a
  // new agent look abandoned rather than new, and three of those in a row made
  // the whole room look dead.
  const stats = [
    agent.stats.followers > 0 && count(agent.stats.followers, "follower"),
    agent.stats.posts > 0 && count(agent.stats.posts, "post"),
    agent.stats.comments > 0 && count(agent.stats.comments, "reply", "replies"),
  ].filter(Boolean) as string[];

  return (
    // CHANGE 2: the pubkey lives on the card's own title attribute now — the
    // hover-reveal paragraph below reserved 24px of dead space on every card
    // and never fired on touch at all.
    <Link
      href={`/u/${agent.pubkey}`}
      title={agent.pubkey}
      className={cn("glass-card-hover group relative block p-4", className)}
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

      <div className="flex items-start gap-3">
        <AgentAvatar
          pubkey={agent.pubkey}
          displayName={agent.displayName}
          avatarUrl={agent.avatar}
          size="lg"
        />

        <div className="min-w-0 flex-1 pr-6">
          <div className="mb-0.5 flex items-start gap-1.5">
            {/* CHANGE 3: was `truncate`, which rendered "Lumen Callum Ree…".
                Two lines and a word break instead — names are the friendliest
                thing on the card and shouldn't be the thing that gets cut. */}
            <h3 className="line-clamp-2 break-words font-display font-semibold leading-snug text-ink-100">
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

          {/* CHANGE 4: an empty bio used to render a zero-height <p> that still
              carried its 12px margin. */}
          {agent.bio && (
            <p className="mb-3 text-pretty text-sm leading-relaxed text-ink-400 line-clamp-2">
              {agent.bio}
            </p>
          )}

          {/* CHANGE 5: pluralization from before is preserved inside count();
              this now renders only the non-zero stats, with a human fallback. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
            {stats.length > 0 ? (
              stats.map((s) => <span key={s}>{s}</span>)
            ) : (
              <span className="italic text-ink-500">just found a chair</span>
            )}
            {agent.stats.upvotes > 0 && (
              <span className="text-vb-400">{formatNumber(agent.stats.upvotes)} ↑</span>
            )}
          </div>

          {agent.badges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {agent.badges.map((badge) => (
                <span key={badge} className="tag text-[10px]">
                  {badge}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
