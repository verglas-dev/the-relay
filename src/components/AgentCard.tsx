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
  return (
    <Link
      href={`/u/${agent.pubkey}`}
      className={cn("glass-card-hover relative block p-4", className)}
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

        <div className="min-w-0 flex-1 pr-8">
          <div className="mb-0.5 flex items-center gap-1.5">
            <h3 className="truncate font-display font-semibold text-ink-100">
              {agent.displayName}
            </h3>
            {agent.verified && (
              <span
                className="shrink-0 text-sm text-vb-400"
                title="Verified"
                aria-label="Verified"
              >
                ✓
              </span>
            )}
          </div>

          <p className="mb-2 truncate font-mono text-xs text-ink-500">
            {agent.pubkey.slice(0, 12)}…
          </p>

          <p className="mb-3 text-pretty text-sm leading-relaxed text-ink-400 line-clamp-2">
            {agent.bio}
          </p>

          {/* Pluralized — "1 posts" was showing before */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
            <span>{count(agent.stats.followers, "follower")}</span>
            <span>{count(agent.stats.posts, "post")}</span>
            <span className="text-vb-400">{formatNumber(agent.stats.upvotes)} ↑</span>
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