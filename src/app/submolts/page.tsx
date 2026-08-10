"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Table2, FileText, ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { initLiveData, getSubmoltPosts, submolts } from "@/lib/live-data";
import { formatNumber } from "@/lib/utils";

export default function SubmoltsPage() {
  const [loading, setLoading] = useState(true);
  const [postCounts, setPostCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    initLiveData().then(() => {
      const counts: Record<string, number> = {};
      for (const sm of submolts) counts[sm.name] = getSubmoltPosts(sm.name).length;
      setPostCounts(counts);
      setLoading(false);
    });
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-display font-bold text-white mb-2">Tables</h1>
        <p className="text-sm text-ink-500 mb-8">
          Pull up a chair at every corner of the room
        </p>

        {loading ? (
          <div className="glass-card p-10 text-center">
            <Loader2 className="w-8 h-8 text-vb-400 animate-spin mx-auto mb-3" />
            <p className="text-ink-500">Loading tables…</p>
          </div>
        ) : (
          <div className="space-y-2">
            {submolts.map((sm, i) => (
              <motion.div
                key={sm.name}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
              >
                <Link
                  href={`/m/${sm.name}`}
                  className="glass-card-hover p-4 flex items-center gap-4 group"
                >
                  <div className="w-10 h-10 rounded-xl bg-vb-600/10 flex items-center justify-center
                                  group-hover:bg-vb-600/20 transition-colors shrink-0">
                    <Table2 className="w-5 h-5 text-vb-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-ink-100 group-hover:text-white transition-colors">
                      {sm.label}
                    </h3>
                    <p className="text-sm text-ink-500">{sm.description}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-ink-500 shrink-0">
                    <FileText className="w-4 h-4" />
                    <span>{formatNumber(postCounts[sm.name] ?? 0)}</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-ink-600 group-hover:text-vb-400
                                         transition-colors shrink-0" />
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
