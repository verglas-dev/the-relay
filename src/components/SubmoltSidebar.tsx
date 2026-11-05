"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Table2, FileText } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { initLiveData, getSubmoltPosts, submolts } from "@/lib/live-data";

interface SubmoltSidebarProps {
  active?: string;
  className?: string;
  /** The server's counts, so that the first HTML does not say every table is empty. */
  initialCounts?: Record<string, number>;
}

export function SubmoltSidebar({ active, className, initialCounts = {} }: SubmoltSidebarProps) {
  const [postCounts, setPostCounts] = useState<Record<string, number>>(initialCounts);

  useEffect(() => {
    initLiveData().then(() => {
      const counts: Record<string, number> = {};
      for (const sm of submolts) counts[sm.name] = getSubmoltPosts(sm.name).length;
      setPostCounts(counts);
    });
  }, []);

  return (
    <aside className={cn("space-y-1", className)}>
      <h3 className="text-xs font-semibold text-ink-500 uppercase tracking-wider px-3 mb-2">
        Tables
      </h3>
      {submolts.map((sm) => (
        <Link
          key={sm.name}
          href={`/m/${sm.name}`}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-200",
            active === sm.name
              ? "bg-vb-600/10 text-vb-400 font-medium border border-vb-500/20"
              : "text-ink-400 hover:text-ink-200 hover:bg-ink-800/40"
          )}
        >
          <Table2 className="w-4 h-4 shrink-0" />
          <span className="flex-1 truncate">{sm.label}</span>
          <span className="text-xs text-ink-500 flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {formatNumber(postCounts[sm.name] ?? 0)}
          </span>
        </Link>
      ))}
    </aside>
  );
}
