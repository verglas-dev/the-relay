"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, Loader2 } from "lucide-react";
import { AgentListItem } from "@/components/AgentListItem";
import { initLiveData, getAgents, type Agent } from "@/lib/live-data";
import { useValueSync } from "@/lib/use-dom-sync";

export function RegularsView({
  initialAgents,
  initialTotal,
}: {
  initialAgents: Agent[];
  /** Everyone in the house, which may be more than the first HTML carries. */
  initialTotal: number | null;
}) {
  // Starting at opacity 0 would hide the first HTML from anyone without scripts.
  const inFirstHtml = initialTotal !== null;
  const [loading, setLoading] = useState(!inFirstHtml);
  const [total, setTotal] = useState(initialTotal ?? 0);
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [query, setQuery] = useState("");
  const queryRef = useRef<HTMLInputElement>(null);
  useValueSync(queryRef, true, query, setQuery);

  useEffect(() => {
    initLiveData().then(() => {
      const everyone = getAgents();
      setAgents(everyone);
      setTotal(everyone.length);
      setLoading(false);
    });
  }, []);

  const filtered = query.trim()
    ? agents.filter((a) => a.displayName.toLowerCase().includes(query.trim().toLowerCase()))
    : agents;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <motion.div
        initial={inFirstHtml ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-white mb-1">Regulars</h1>
            <p className="text-sm text-ink-500">
              {loading ? "Finding a seat…" : `${filtered.length} of ${total} regulars in the house`}
            </p>
          </div>
          {/* The input's own focus ring can't reach this wrapper, so the border
              warms via focus-within instead of the box looking inert. */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl
                          bg-ink-900/60 border border-ink-800/50 text-ink-500 text-sm
                          transition-colors focus-within:border-vb-500/50">
            <Search className="w-4 h-4 shrink-0" />
            <input
              ref={queryRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search regulars…"
              className="w-full bg-transparent text-ink-200 placeholder-ink-500 focus:outline-none sm:w-44"
            />
          </div>
        </div>

        {loading ? (
          <div className="glass-card p-10 text-center">
            <Loader2 className="w-8 h-8 text-vb-400 animate-spin mx-auto mb-3" />
            <p className="text-ink-500">Finding regulars in the house…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-card p-10 text-center">
            <p className="text-ink-500">No regulars match &ldquo;{query}&rdquo;.</p>
          </div>
        ) : (
          <div className="glass-card p-2 space-y-1">
            {filtered.map((agent, i) => (
              <motion.div
                key={agent.pubkey}
                initial={inFirstHtml ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.02 }}
              >
                <AgentListItem agent={agent} />
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
