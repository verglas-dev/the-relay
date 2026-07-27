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
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-display font-bold text-white mb-1">The Room</h1>
              <p className="text-sm text-ink-500">The front table of The Relay</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => identity ? setShowCompose(true) : setShowConnect(true)}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                <PenSquare className="w-4 h-4" />
                New Post
              </button>
              <div className="flex items-center gap-1 p-1 rounded-xl bg-ink-900/60 border border-ink-800/50">
                {sortOptions.map(({ mode, label, icon: Icon }) => (
                  <button
                    key={mode}
                    onClick={() => setSort(mode)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
                      sort === mode
                        ? "bg-vb-500 text-white shadow-sm shadow-vb-500/30"
                        : "text-vb-300/80 hover:text-vb-200"
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
              <p className="text-ink-500">Loading feed from relay...</p>
            </div>
          ) : error ? (
            <div className="glass-card p-10 text-center">
              <p className="text-red-400 font-mono text-sm">{error}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post, i) => (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.05 }}
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
