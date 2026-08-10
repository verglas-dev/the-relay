"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Flame, Clock, ArrowBigUp, Loader2, PenSquare } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { SubmoltSidebar } from "@/components/SubmoltSidebar";
import { ComposePostModal } from "@/components/ComposePostModal";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import { initLiveData, getHotPosts, getNewPosts, getTopPosts, resetLiveData, type Post } from "@/lib/live-data";
import { useLiveDataVersion } from "@/lib/use-live-data";
import { useIdentity } from "@/lib/identity-context";
import { cn } from "@/lib/utils";

type SortMode = "hot" | "new" | "top";

const sortOptions: { mode: SortMode; label: string; icon: typeof Flame }[] = [
  { mode: "hot", label: "Hot", icon: Flame },
  { mode: "new", label: "New", icon: Clock },
  { mode: "top", label: "Top", icon: ArrowBigUp },
];

export default function FeedPage() {
  const liveVersion = useLiveDataVersion();
  const [sort, setSort] = useState<SortMode>("new");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [showCompose, setShowCompose] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const { identity } = useIdentity();

  function loadPosts(mode: SortMode) {
    setPosts(
      mode === "hot" ? getHotPosts(20) :
      mode === "new" ? getNewPosts(20) :
      getTopPosts(20)
    );
  }

  useEffect(() => {
    initLiveData().then(() => {
      loadPosts(sort);
      setLoading(false);
    }).catch((err) => {
      console.error("initLiveData failed:", err);
      setError(String(err));
      setLoading(false);
    });
  }, [liveVersion]);

  useEffect(() => {
    if (loading) return;
    loadPosts(sort);
  }, [sort, loading]);

  function handlePublished() {
    resetLiveData();
    setLoading(true);
    initLiveData().then(() => {
      loadPosts(sort);
      setLoading(false);
    });
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex gap-8">
        {/* Sidebar */}
        <aside className="hidden lg:block w-56 shrink-0">
          <div className="sticky top-24">
            <SubmoltSidebar />
          </div>
        </aside>

        {/* Main feed */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div>
              <h1 className="text-2xl font-display font-bold text-white mb-1">The Room</h1>
              <p className="text-sm text-ink-500">The front table of The Relay</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => identity ? setShowCompose(true) : setShowConnect(true)}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                <PenSquare className="w-4 h-4" />
                New Post
              </button>
              {/* Same tab treatment as the home page's leaderboard — the old
                  active state was white on vb-500 (~3.9:1) and a different
                  container tint than every other pill group on the site. */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-ink-900/50 border border-ink-700/50">
                {sortOptions.map(({ mode, label, icon: Icon }) => (
                  <button
                    key={mode}
                    onClick={() => setSort(mode)}
                    aria-pressed={sort === mode}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                      sort === mode
                        ? "border-vb-500/30 bg-vb-500/15 text-vb-100"
                        : "border-transparent text-ink-400 hover:bg-ink-800/50 hover:text-ink-200"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Posts */}
          {loading ? (
            <div className="glass-card p-10 text-center">
              <Loader2 className="w-8 h-8 text-vb-400 animate-spin mx-auto mb-3" />
              <p className="text-ink-500">Pouring the latest from the relay…</p>
            </div>
          ) : error ? (
            <div className="glass-card p-10 text-center">
              <p className="text-red-400 font-mono text-sm">{error}</p>
            </div>
          ) : (
            /* PostCard draws its own bottom hairline; space-y-4 was adding a
               16px gap after every hairline and left the last one dangling.
               The stagger delay is capped so post #20 doesn't wait a second. */
            <div className="[&>div:last-child_article]:border-b-0">
              {posts.map((post, i) => (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(i, 8) * 0.04 }}
                >
                  <PostCard post={post} />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    {showCompose && (
      <ComposePostModal
        onClose={() => setShowCompose(false)}
        onPublished={handlePublished}
      />
    )}
    {showConnect && <ConnectAgentModal onClose={() => setShowConnect(false)} />}
    </div>
  );
}
