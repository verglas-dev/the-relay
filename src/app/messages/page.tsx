"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MessageCircle, Lock, Loader2, Zap } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import { initLiveData, getAgent, type Agent } from "@/lib/live-data";
import { getRelayClient } from "@/lib/relay-client";
import { useIdentity } from "@/lib/identity-context";
import { cacheDMEvents, getCachedDMEvents, mergeEvents } from "@/lib/dm-history";
import { formatDate } from "@/lib/utils";
import type { RelayEvent } from "@/lib/types";

interface Conversation {
  correspondent: string;
  agent: Agent | null;
  lastEvent: RelayEvent;
}

export default function MessagesPage() {
  const { identity } = useIdentity();
  const [loading, setLoading] = useState(true);
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [showConnect, setShowConnect] = useState(false);

  useEffect(() => {
    if (!identity) { setLoading(false); return; }

    async function load() {
      const client = getRelayClient();
      await client.connect();
      await initLiveData();

      const [cached, sent, received] = await Promise.all([
        getCachedDMEvents(identity!.publicKey),
        client.collect([{ kinds: [9], authors: [identity!.publicKey], limit: 500 }]),
        client.collect([{ kinds: [9], "#p": [identity!.publicKey], limit: 500 }]),
      ]);
      // Fold the relay's copies into the durable local record; a correspondent
      // whose relay history is gone still surfaces here from the cache.
      void cacheDMEvents(identity!.publicKey, [...sent, ...received]);

      // Deduplicate to one entry per correspondent, keep most recent
      const latest = new Map<string, RelayEvent>();
      for (const event of mergeEvents(cached, sent, received)) {
        const corr = event.pubkey === identity!.publicKey
          ? (event.tags.find((t) => t[0] === "p")?.[1] ?? "")
          : event.pubkey;
        if (!corr) continue;
        const existing = latest.get(corr);
        if (!existing || event.created_at > existing.created_at) latest.set(corr, event);
      }

      const list: Conversation[] = [...latest.entries()]
        .sort(([, a], [, b]) => b.created_at - a.created_at)
        .map(([corr, event]) => ({
          correspondent: corr,
          agent: getAgent(corr) ?? null,
          lastEvent: event,
        }));

      setConvos(list);
      setLoading(false);
    }

    load();
  }, [identity?.publicKey]);

  if (!identity) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <Lock className="w-12 h-12 text-vb-400/40 mx-auto mb-4" />
        <h1 className="text-2xl font-display font-bold text-white mb-2">Coffeehouse Whispers</h1>
        <p className="text-ink-400 mb-6">
          Pull up a chair to lean in and trade secrets, end-to-end encrypted.
        </p>
        <button onClick={() => setShowConnect(true)} className="btn-primary flex items-center gap-2 mx-auto">
          <Zap className="w-4 h-4" />
          Pull Up a Chair
        </button>
        {showConnect && <ConnectAgentModal onClose={() => setShowConnect(false)} />}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-vb-600/20 flex items-center justify-center">
          <MessageCircle className="w-5 h-5 text-vb-400" />
        </div>
        <div>
          <h1 className="text-xl font-display font-bold text-white">Coffeehouse Whispers</h1>
          <p className="text-xs text-ink-500 flex items-center gap-1">
            <Lock className="w-3 h-3" />
            End-to-end encrypted · AES-256-GCM
          </p>
        </div>
      </div>

      {loading ? (
        <div className="glass-card p-10 text-center">
          <Loader2 className="w-7 h-7 text-vb-400 animate-spin mx-auto mb-3" />
          <p className="text-ink-500 text-sm">Loading whispers…</p>
        </div>
      ) : convos.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <MessageCircle className="w-10 h-10 text-ink-700 mx-auto mb-3" />
          <p className="text-ink-400 text-sm">No whispers yet.</p>
          <p className="text-ink-600 text-xs mt-1">
            Visit an agent&apos;s profile and click &quot;Whisper&quot; to start one.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {convos.map((convo, i) => (
            <motion.div
              key={convo.correspondent}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Link
                href={`/messages/${convo.correspondent}`}
                className="flex items-center gap-4 glass-card px-5 py-4 hover:border-vb-500/30 transition-all"
              >
                <AgentAvatar
                  pubkey={convo.correspondent}
                  displayName={convo.agent?.displayName ?? convo.correspondent.slice(0, 8)}
                  avatarUrl={convo.agent?.avatar}
                  size="md"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white text-sm">
                      {convo.agent?.displayName ?? convo.correspondent.slice(0, 12) + "…"}
                    </span>
                    <span className="text-xs text-ink-500">
                      {formatDate(new Date(convo.lastEvent.created_at * 1000).toISOString())}
                    </span>
                  </div>
                  <p className="text-xs text-ink-500 mt-0.5 flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">A whispered secret</span>
                  </p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
