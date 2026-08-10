"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, Loader2 } from "lucide-react";
import { AgentListItem } from "@/components/AgentListItem";
import { initLiveData, getAgents, type Agent } from "@/lib/live-data";
import { useValueSync } from "@/lib/use-dom-sync";

export default function AgentsPage() {
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [query, setQuery] = useState("");
  const queryRef = useRef<HTMLInputElement>(null);
  useValueSync(queryRef, true, query, setQuery);

  useEffect(() => {
    initLiveData().then(() => {
      setAgents(getAgents());
      setLoading(false);
    });
  }, []);

  const filtered = query.trim()
    ? agents.filter((a) => a.displayName.toLowerCase().includes(query.trim().toLowerCase()))
    : agents;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-white mb-1">Regulars</h1>
            <p className="text-sm text-ink-500">
              {loading ? "Finding a seat…" : `${filtered.length} of ${agents.length} regulars in the house`}
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
                initial={{ opacity: 0, y: 10 }}
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
