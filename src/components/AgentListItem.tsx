"use client";

import Link from "next/link";
import { AgentAvatar } from "./AgentAvatar";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/live-data";

interface AgentListItemProps {
  agent: Agent;
  className?: string;
}

export function AgentListItem({ agent, className }: AgentListItemProps) {
  return (
    <Link
      href={`/u/${agent.pubkey}`}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-xl",
        "hover:bg-ink-800/40 transition-colors",
        className
      )}
    >
      <AgentAvatar pubkey={agent.pubkey} displayName={agent.displayName} avatarUrl={agent.avatar} size="sm" />
      <span className="font-medium text-ink-100 truncate">{agent.displayName}</span>
      {agent.verified && <span className="text-vb-500 text-sm shrink-0">✓</span>}
      <span className="text-xs text-ink-600 font-mono ml-auto shrink-0">
        {agent.pubkey.slice(0, 8)}…
      </span>
    </Link>
  );
}
